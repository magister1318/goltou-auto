import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import type { SurfaceHost } from '@goltou/surface';
import { startCore } from '../src/server';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function fixture() {
  await mkdir('tmp', { recursive: true });
  const dir = await mkdtemp(path.resolve('tmp/core-test-'));
  await mkdir(path.join(dir, 'ui'));
  await writeFile(path.join(dir, 'ui/index.html'), '<!doctype html><title>진단 UI</title>');
  await writeFile(path.join(dir, 'outside.txt'), 'private');
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const host: SurfaceHost = { create: async () => { throw new Error('NOT_NEEDED'); }, destroy: async () => {}, clearSession: async () => {} };
  const core = await startCore({ host, uiDir: path.join(dir, 'ui') });
  cleanup.push(() => core.close());
  return core;
}

function rejectedSocket(url: string, options: WebSocket.ClientOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once('open', () => { socket.terminate(); reject(new Error('Unexpected authorized socket')); });
    socket.once('unexpected-response', (_req, response) => { response.resume(); socket.terminate(); resolve(response.statusCode ?? 0); });
    socket.on('error', () => {});
  });
}

describe('core launch token', () => {
  it('binds loopback and requires the current launch token for health and UI', async () => {
    const core = await fixture();
    expect(core.origin).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect((await fetch(`${core.origin}/health`)).status).toBe(403);
    expect((await fetch(`${core.origin}/health?token=wrong`)).status).toBe(403);
    expect((await fetch(`${core.origin}/ui/`)).status).toBe(403);
    expect((await fetch(`${core.origin}/health?token=${core.token}`)).status).toBe(200);
    const page = await fetch(core.uiUrl);
    expect(await page.text()).toContain('진단 UI');
    expect(page.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect((await fetch(`${core.origin}/ui/`, { headers: { cookie: `goltou_ui=${core.token}` } })).status).toBe(200);
  });

  it('generates a different token on every start', async () => {
    const a = await fixture(); const b = await fixture();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[a-f0-9]{64}$/);
    expect((await fetch(`${b.origin}/health?token=${a.token}`)).status).toBe(403);
  });

  it('rejects unauthorized socket routes, origins and cookie-only native access', async () => {
    const core = await fixture();
    const ws = core.origin.replace('http:', 'ws:');
    expect(await rejectedSocket(`${ws}/native`)).toBe(403);
    expect(await rejectedSocket(`${ws}/native`, { headers: { Cookie: `goltou_ui=${core.token}` } })).toBe(403);
    expect(await rejectedSocket(`${ws}/ui-socket?token=${core.token}`, { origin: 'https://untrusted.example' })).toBe(403);
    expect(await rejectedSocket(`${ws}/other?token=${core.token}`)).toBe(403);
    const socket = new WebSocket(`${ws}/ui-socket`, { origin: core.origin, headers: { Cookie: `goltou_ui=${core.token}` } });
    const message = await new Promise<string>((resolve, reject) => { socket.once('message', raw => resolve(String(raw))); socket.once('error', reject); });
    expect(JSON.parse(message)).toEqual({ type: 'ready' });
    socket.close();
  });

  it('serves only files inside uiDir and blocks DNS rebinding hosts', async () => {
    const core = await fixture();
    expect((await fetch(`${core.origin}/ui/%2e%2e%2foutside.txt?token=${core.token}`)).status).toBe(404);
    expect((await fetch(`${core.origin}/ui/%5c..%5coutside.txt?token=${core.token}`)).status).toBe(404);
    expect((await fetch(`${core.origin}/ui/missing?token=${core.token}`)).status).toBe(404);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      http.get(`${core.origin}/health?token=${core.token}`, { headers: { Host: 'untrusted.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    expect(status).toBe(403);
  });

  it('routes native replies and rejects pending calls after disconnect', async () => {
    const core = await fixture();
    const socket = new WebSocket(`${core.origin.replace('http:', 'ws:')}/native?token=${core.token}`);
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.once('message', raw => {
      const msg = JSON.parse(String(raw)) as { id: number };
      socket.send(JSON.stringify({ id: msg.id, ok: true, result: { value: 42 } }));
    });
    await expect(core.native.call('surface.test')).resolves.toEqual({ value: 42 });
    const pending = core.native.call('surface.pending');
    socket.close();
    await expect(pending).rejects.toThrow('NATIVE_DISCONNECTED');
  });
});
