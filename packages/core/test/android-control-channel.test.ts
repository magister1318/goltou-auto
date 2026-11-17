import { expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { chromium, type CDPSession, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { NativeBridge } from '../src/native';
import type { AndroidSurfaceHost } from '../../../apps/android/bridge/host';

// PC Chromium supplies real CDP/input/Fetch behavior. The Kotlin WebView/relay
// boundary is represented by an HTTP+WS private socket, not an Android emulator.
it('attaches a release-compiled host through /json/list and blocks a real local POST after keyboard input', async () => {
  const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p));
  if (!executablePath) throw Error('LOCAL_CHROMIUM_REQUIRED');
  await mkdir('tmp', { recursive: true });
  const directory = await mkdtemp(path.resolve('tmp/android-release-control-'));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
  const context = await browser.newContext();
  // No external service may be contacted by this test.
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  let posts = 0;
  const pageServer = http.createServer((request, response) => {
    if (request.method === 'POST') posts++;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><meta charset="utf-8"><input id="entry"><button id="send" onclick="fetch(\'/blocked\',{method:\'POST\',body:document.querySelector(\'input\').value}).catch(()=>{})">로컬 요청</button>');
  });
  let page: Page | undefined, session: CDPSession | undefined;
  const relay = http.createServer((request, response) => {
    if (request.url !== '/json/list' || !page) { response.writeHead(404).end(); return; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify([{ url: page.url(), webSocketDebuggerUrl: 'ws://localhost/devtools/page/local' }]));
  });
  const sockets = new WebSocketServer({ server: relay });
  const methods: string[] = [];
  sockets.on('connection', socket => {
    const cdp = session!;
    for (const event of ['Page.lifecycleEvent', 'Page.frameNavigated', 'Fetch.requestPaused', 'Page.javascriptDialogOpening', 'Page.javascriptDialogClosed'] as const) {
      cdp.on(event, data => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ method: event, params: data })); });
    }
    socket.on('message', async raw => {
      const command = JSON.parse(String(raw)) as { id: number; method: string; params: Record<string, unknown> };
      methods.push(command.method);
      try {
        const send = cdp.send.bind(cdp) as (method: string, params: Record<string, unknown>) => Promise<unknown>;
        const result = await send(command.method, command.params);
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ id: command.id, result }));
      } catch { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ id: command.id, error: { message: 'LOCAL_CDP_ERROR' } })); }
    });
  });
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\goltou-control-${randomUUID()}` : path.join(directory, 'relay.sock');
  let host: AndroidSurfaceHost | undefined;
  let surface: Awaited<ReturnType<AndroidSurfaceHost['create']>> | undefined;
  try {
    const compiled = path.join(directory, 'host.cjs');
    await build({ entryPoints: ['apps/android/bridge/host.ts'], outfile: compiled, bundle: true, minifySyntax: true,
      platform: 'node', target: 'node18', format: 'cjs', external: ['bufferutil', 'utf-8-validate'], define: { __GOLTOU_DEBUG__: 'false' } });
    const CompiledHost = createRequire(import.meta.url)(compiled).AndroidSurfaceHost as typeof AndroidSurfaceHost;
    const native = new NativeBridge();
    vi.spyOn(native, 'call').mockImplementation(async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
      if (op === 'surface.create') {
        page = await context.newPage();
        await page.goto(`about:blank#${String(args.marker)}`);
        session = await context.newCDPSession(page);
      } else if (op === 'surface.destroy') await page?.close();
      else throw Error('UNEXPECTED_NATIVE_OPERATION');
      return {} as T;
    });
    await new Promise<void>(resolve => pageServer.listen(0, '127.0.0.1', resolve));
    await new Promise<void>(resolve => relay.listen(pipe, resolve));
    host = new CompiledHost(native, pipe);
    surface = await host.create('ai');
    const origin = `http://127.0.0.1:${(pageServer.address() as import('node:net').AddressInfo).port}`;
    const inspect = vi.fn(() => false);
    await surface.guardRequests!([{ hostname: '127.0.0.1', pathname: '/blocked' }], inspect, () => {});
    await surface.open({ url: origin + '/', session: 'ai', width: 800, height: 600, userAgent: 'GoltouLocalFixture' });
    const click = async (selector: string) => {
      const point = await surface!.evaluateReadOnly<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await surface!.click(point.x, point.y);
    };
    await click('#entry');
    await surface.typeText('로컬 입력');
    expect(await surface.evaluateReadOnly('document.querySelector("input").value')).toBe('로컬 입력');
    await click('#send');
    await vi.waitFor(() => expect(methods).toContain('Fetch.failRequest'));
    expect(inspect).toHaveBeenCalledOnce();
    expect(posts).toBe(0);
    expect(methods).toContain('Fetch.enable');
    expect(methods).toContain('Input.insertText');
    expect(methods).toContain('Input.dispatchMouseEvent');
  } finally {
    if (host && surface) await host.destroy(surface);
    for (const socket of sockets.clients) socket.terminate();
    await browser.close();
    await Promise.all([new Promise<void>(resolve => relay.close(() => resolve())), new Promise<void>(resolve => pageServer.close(() => resolve()))]);
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
