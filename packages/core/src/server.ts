// Reference: ../refs/DAF/daf3/apps/mobile/src/core/main.ts (loopback HTTP/WebSocket routing only).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { SurfaceHost, SurfaceState } from '@goltou/surface';
import { NativeBridge } from './native';
import { AppCore } from './app';
import type { AppRequest } from './protocol';
import type { Experiments } from './experiments';

export interface CoreOptions {
  host: SurfaceHost;
  uiDir: string;
  native?: NativeBridge;
  /** Shell generates this once per process launch; omitted in PC simulation. */
  token?: string;
  port?: number;
  app?: AppCore;
  experiments?: Experiments;
}

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
};
const desktopUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export async function startCore(options: CoreOptions) {
  const token = options.token ?? randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{48,}$/.test(token)) throw new Error('CORE_TOKEN_TOO_WEAK');
  const native = options.native ?? new NativeBridge();
  const uiDir = await realpath(options.uiDir);
  let origin = '';
  let diagnosing = false;
  const app = options.app ?? new AppCore();

  function validToken(value: string | undefined | null): boolean {
    if (!value) return false;
    const actual = Buffer.from(value);
    const expected = Buffer.from(token);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  function authorized(req: http.IncomingMessage, url: URL, cookies = true): boolean {
    return validToken(url.searchParams.get('token')) || (cookies && (req.headers.cookie ?? '')
      .split(';').some(value => value.trim().startsWith('goltou_ui=') && validToken(value.trim().slice(10))));
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
      if (!authorized(req, url)) { res.writeHead(403).end(); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, node: process.version }));
        return;
      }
      if (!url.pathname.startsWith('/ui/')) { res.writeHead(404).end(); return; }
      const decoded = decodeURIComponent(url.pathname.slice(4) || 'index.html');
      if (decoded.includes('\\') || decoded.includes('\0')) { res.writeHead(404).end(); return; }
      const file = await realpath(path.resolve(uiDir, decoded)).catch(() => '');
      const relative = path.relative(uiDir, file);
      if (!file || relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(404).end(); return; }
      const data = await readFile(file).catch(() => null);
      if (!data) { res.writeHead(404).end(); return; }
      res.writeHead(200, {
        'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
        'set-cookie': `goltou_ui=${token}; Path=/; HttpOnly; SameSite=Strict`,
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    })().catch(() => { if (!res.headersSent) res.writeHead(400); res.end(); });
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://127.0.0.1'); }
    catch { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    const nativeRoute = url.pathname === '/native';
    const uiRoute = url.pathname === '/ui-socket';
    if (req.headers.host !== new URL(origin).host || (!nativeRoute && !uiRoute)
      || !authorized(req, url, !nativeRoute)
      || (req.headers.origin !== undefined && req.headers.origin !== origin)
      || (uiRoute && req.headers.origin !== origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req, socket, head, ws => {
      ws.on('error', () => {});
      if (nativeRoute) { native.attach(ws); return; }
      ws.send(JSON.stringify({ type: 'ready', ...(options.experiments ? { debug: true } : {}) }));
      const unsubscribe = app.subscribe(snapshot => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'snapshot', snapshot })); });
      ws.once('close', unsubscribe);
      ws.on('message', raw => {
        void (async () => {
          let id: unknown;
          let ownsDiagnostic = false;
          try {
            const msg = JSON.parse(String(raw)) as { id?: unknown; type?: string; url?: unknown; command?: string; input?: Record<string, unknown> };
            id = msg.id;
            if (typeof id === 'number' && msg.type === 'experiment') {
              if (!options.experiments) throw new Error('DEBUG_ONLY');
              if (diagnosing) throw new Error('DIAGNOSTIC_BUSY');
              const data = await options.experiments.handle(msg.command ?? '', msg.input);
              if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id, type: 'reply', data }));
              return;
            }
            if (typeof id === 'number' && msg.type === 'app') {
              const data = await app.handle(msg as unknown as AppRequest);
              if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id, type: 'reply', data }));
              return;
            }
            if (typeof id !== 'number' || msg.type !== 'diagnose' || typeof msg.url !== 'string') throw new Error('BAD_DIAGNOSTIC_REQUEST');
            const url = new URL(msg.url);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('HTTP_URL_REQUIRED');
            if (diagnosing || options.experiments?.busy) throw new Error('DIAGNOSTIC_BUSY');
            diagnosing = true;
            ownsDiagnostic = true;
            const surface = await options.host.create('ai');
            let state: SurfaceState;
            try {
              await surface.open({ url: url.href, width: 1280, height: 900, userAgent: desktopUA, session: 'ai' });
              state = await surface.readState();
            } finally { await options.host.destroy(surface); }
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id, type: 'result', state }));
          } catch (error) {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id, type: 'error', code: error && typeof error === 'object' && 'code' in error ? error.code : 'server', message: error instanceof Error ? error.message : 'DIAGNOSTIC_FAILED' }));
          } finally { if (ownsDiagnostic) diagnosing = false; }
        })();
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('CORE_LISTEN_FAILED');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin, token, uiUrl: `${origin}/ui/?token=${token}`, native,
    close: async () => {
      app.dispose();
      await options.experiments?.close();
      native.detach();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
