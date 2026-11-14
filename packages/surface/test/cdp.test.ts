import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { CdpConnection, CdpSurface } from '../src/cdp';

interface Command { id: number; method: string; params: Record<string, unknown> }
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function fixture(handler?: (command: Command, socket: WebSocket) => boolean) {
  const commands: Command[] = [];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  server.on('connection', socket => socket.on('message', raw => {
    const command = JSON.parse(String(raw)) as Command;
    commands.push(command);
    if (handler?.(command, socket)) return;
    let result: unknown = {};
    if (command.method === 'Page.navigate') {
      result = { loaderId: 'new-loader' };
      socket.send(JSON.stringify({ method: 'Page.lifecycleEvent', params: { name: 'load', loaderId: 'new-loader' } }));
    }
    if (command.method === 'Runtime.evaluate') result = { result: { value: { url: 'https://example.com/', title: 'Example', loading: false } } };
    if (command.method === 'DOM.getDocument') result = { root: { nodeId: 1 } };
    if (command.method === 'DOM.querySelector') result = { nodeId: 2 };
    socket.send(JSON.stringify({ id: command.id, result }));
  }));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('NO_PORT');
  const connection = await CdpConnection.connect(`ws://127.0.0.1:${address.port}`);
  let visible = false;
  let closed = 0;
  const surface = new CdpSurface('naver', connection, {
    setVisible: async value => { visible = value; }, close: async () => { closed++; },
  }, 0);
  cleanup.push(async () => {
    connection.close();
    for (const client of server.clients) client.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return { surface, connection, commands, visibility: () => visible, closed: () => closed,
    event: (method: string, params: Record<string, unknown>) => { for (const socket of server.clients) socket.send(JSON.stringify({ method, params })); } };
}

describe('CDP Surface', () => {
  it('runs the final read-back after hovering and sends no press if the condition changed', async () => {
    const f = await fixture();
    await expect(f.surface.click(10, 20, async () => { throw new Error('BLOG_VISIBILITY_NOT_PRIVATE'); })).rejects.toThrow('BLOG_VISIBILITY_NOT_PRIVATE');
    expect(f.commands).toEqual([expect.objectContaining({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10, y: 20 } })]);
  });
  it('allows one inspected job request, rejects repeats/updates, and reads only its response in memory', async () => {
    let armed = true;
    const inspect = vi.fn(request => { const allow = armed && request.method === 'POST' && request.postData === 'openType=0'; armed = false; return allow; });
    const response = vi.fn();
    const f = await fixture((command, socket) => {
      if (command.method !== 'Fetch.getResponseBody') return false;
      socket.send(JSON.stringify({ id: command.id, result: { body: '{"result":{"logNo":9001}}' } })); return true;
    });
    await f.surface.guardRequests([{ hostname: 'blog.naver.com', pathname: '/RabbitWrite.naver' }], inspect, response);
    for (const id of ['one', 'two']) f.event('Fetch.requestPaused', { requestId: id, request: { url: 'https://blog.naver.com/RabbitWrite.naver', method: 'POST', postData: 'openType=0' } });
    await vi.waitFor(() => expect(f.commands).toHaveLength(3));
    expect(f.commands[1]).toMatchObject({ method: 'Fetch.continueRequest', params: { requestId: 'one' } });
    expect(f.commands[2]).toMatchObject({ method: 'Fetch.failRequest', params: { requestId: 'two' } });
    f.event('Fetch.requestPaused', { requestId: 'one', responseStatusCode: 200, request: { url: 'https://blog.naver.com/RabbitWrite.naver' } });
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ status: 200, body: '{"result":{"logNo":9001}}' }));
    expect(JSON.stringify(f.commands)).not.toContain('openType=0');
  });
  it('blocks when the request inspector throws and retains a pre-existing draft barrier', async () => {
    const f = await fixture();
    await f.surface.blockRequests([{ hostname: 'blog.naver.com', pathname: '/RabbitUpdate.naver' }]);
    await f.surface.guardRequests([{ hostname: 'blog.naver.com', pathname: '/RabbitWrite.naver' }], () => { throw new Error('unknown'); }, () => {});
    for (const path of ['RabbitWrite', 'RabbitUpdate']) f.event('Fetch.requestPaused', { requestId: path, request: { url: `https://blog.naver.com/${path}.naver` } });
    await vi.waitFor(() => expect(f.commands.filter(c => c.method === 'Fetch.failRequest')).toHaveLength(2));
  });
  it('fails real submission at Fetch while allowing the distinct draft-save paths and preserving request privacy', async () => {
    const f = await fixture();
    await f.surface.blockRequests(['/RabbitWrite.naver', '/RabbitUpdate.naver'].map(pathname => ({ hostname: 'blog.naver.com', pathname })));
    expect(f.commands[0]).toMatchObject({ method: 'Fetch.enable', params: { patterns: [
      { urlPattern: '*://blog.naver.com/RabbitWrite.naver*', requestStage: 'Request' },
      { urlPattern: '*://blog.naver.com/RabbitUpdate.naver*', requestStage: 'Request' },
    ] } });
    // Events simulate requests before transport; no actual Naver requests occur.
    for (const [i, path] of ['/RabbitWrite.naver?local=1', '/RabbitUpdate.naver', '/RabbitTempPostWrite.naver', '/RabbitTempPostUpdate.naver'].entries()) {
      f.event('Fetch.requestPaused', { requestId: String(i), request: { url: `https://blog.naver.com${path}`, postData: 'PRIVATE_CONTENT_NEVER_RECORDED' } });
    }
    await vi.waitFor(() => expect(f.commands).toHaveLength(5));
    expect(f.commands.slice(1)).toEqual([
      expect.objectContaining({ method: 'Fetch.failRequest', params: { requestId: '0', errorReason: 'BlockedByClient' } }),
      expect.objectContaining({ method: 'Fetch.failRequest', params: { requestId: '1', errorReason: 'BlockedByClient' } }),
      expect.objectContaining({ method: 'Fetch.continueRequest', params: { requestId: '2' } }),
      expect.objectContaining({ method: 'Fetch.continueRequest', params: { requestId: '3' } }),
    ]);
    expect(JSON.stringify(f.commands)).not.toContain('PRIVATE_CONTENT');
  });
  it('retries one unanswered viewport capture without native-density fallback or editor input', async () => {
    let attempts = 0;
    const f = await fixture((command, socket) => {
      if (command.method !== 'Page.captureScreenshot') return false;
      if (++attempts === 1) return true;
      if (command.params.fromSurface !== true) socket.send(JSON.stringify({ id: command.id, error: { message: 'WRONG_PIXEL_GEOMETRY' } }));
      else socket.send(JSON.stringify({ id: command.id, result: { data: 'viewport-snapshot' } }));
      return true;
    });
    await expect(f.surface.captureViewport()).resolves.toBe('viewport-snapshot');
    expect(attempts).toBe(2);
    expect(f.commands.some(c => c.method.startsWith('Input.') || c.method === 'Runtime.evaluate')).toBe(false);
  });
  it('opens the requested session, UA and viewport then reads the loaded title', async () => {
    const f = await fixture();
    await f.surface.open({ url: 'https://example.com/', width: 1280, height: 900, userAgent: 'test-desktop', session: 'naver' });
    expect(await f.surface.readState()).toEqual({ url: 'https://example.com/', title: 'Example', loading: false });
    expect(f.commands.find(c => c.method === 'Network.setUserAgentOverride')?.params).toEqual({ userAgent: 'test-desktop' });
    expect(f.commands.find(c => c.method === 'Emulation.setDeviceMetricsOverride')?.params).toMatchObject({ width: 1280, height: 900, mobile: false });
    expect(f.commands.filter(c => c.method === 'Runtime.evaluate').every(c => c.params.throwOnSideEffect === true)).toBe(true);
  });

  it('does not accept an old document as the new navigation', async () => {
    let loaded = false;
    const f = await fixture((command, socket) => {
      if (command.method !== 'Page.navigate') return false;
      socket.send(JSON.stringify({ id: command.id, result: { loaderId: 'delayed' } }));
      setTimeout(() => { loaded = true; socket.send(JSON.stringify({ method: 'Page.lifecycleEvent', params: { name: 'load', loaderId: 'delayed' } })); }, 80);
      return true;
    });
    await f.surface.open({ url: 'https://example.com/', width: 1280, height: 900, userAgent: 'test', session: 'naver' });
    expect(loaded).toBe(true);
  });

  it('accepts the loaded main document after a client-side redirect', async () => {
    const f = await fixture((command, socket) => {
      if (command.method !== 'Page.navigate') return false;
      socket.send(JSON.stringify({ id: command.id, result: { loaderId: 'redirect-start' } }));
      socket.send(JSON.stringify({ method: 'Page.frameNavigated', params: { frame: { id: 'main', loaderId: 'redirect-final' } } }));
      socket.send(JSON.stringify({ method: 'Page.lifecycleEvent', params: { name: 'load', loaderId: 'redirect-final' } }));
      return true;
    });
    await expect(f.surface.open({ url: 'https://example.com/', width: 1280, height: 900, userAgent: 'test', session: 'naver' })).resolves.toBeUndefined();
  });

  it('uses mouse, text and key input commands, preserving Unicode characters', async () => {
    const f = await fixture();
    await f.surface.click(20, 30);
    await f.surface.typeText('한😀');
    await f.surface.pressKey({ key: 'Enter' });
    await f.surface.pressKey({ key: 'a', modifiers: 2 });
    expect(f.commands.map(c => c.method)).toEqual([
      'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent',
      'Input.insertText', 'Input.insertText', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent',
    ]);
    expect(f.commands.slice(3, 5).map(c => c.params.text)).toEqual(['한', '😀']);
    expect(f.commands[7]?.params).toMatchObject({ type: 'keyDown', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  });

  it('attaches files through the file input CDP command', async () => {
    const f = await fixture();
    await f.surface.attachFiles('input[type=file]', ['C:/test/photo.jpg']);
    expect(f.commands.at(-1)).toMatchObject({ method: 'DOM.setFileInputFiles', params: { nodeId: 2, files: ['C:/test/photo.jpg'] } });
  });
  it('keeps variation selectors, joined emoji and combining marks in one text input event', async () => {
    const f = await fixture();
    vi.stubGlobal('Intl', undefined);
    try {
      await f.surface.typeText('한✈️👨‍👩‍👧‍👦e\u0301👍🏽🇰🇷');
      expect(f.commands.map(c => c.method)).toEqual(Array(6).fill('Input.insertText'));
      expect(f.commands.map(c => c.params.text)).toEqual(['한', '✈️', '👨‍👩‍👧‍👦', 'e\u0301', '👍🏽', '🇰🇷']);
    } finally { vi.unstubAllGlobals(); }
  });

  it('finds a file input inside the editor frame', async () => {
    const f = await fixture((command, socket) => {
      if (command.method === 'DOM.getDocument') {
        socket.send(JSON.stringify({ id: command.id, result: { root: { nodeId: 1, children: [{ nodeId: 2, contentDocument: { nodeId: 3 } }] } } })); return true;
      }
      if (command.method === 'DOM.querySelector') {
        socket.send(JSON.stringify({ id: command.id, result: { nodeId: command.params.nodeId === 3 ? 4 : 0 } })); return true;
      }
      return false;
    });
    await f.surface.attachFiles('input[type=file]', ['/app/sample.png']);
    expect(f.commands.at(-1)).toMatchObject({ method: 'DOM.setFileInputFiles', params: { nodeId: 4 } });
  });

  it('switches desktop metrics off when visible and restores them when hidden', async () => {
    const f = await fixture();
    await f.surface.open({ url: 'https://example.com/', width: 1280, height: 900, userAgent: 'desktop', session: 'naver' });
    await f.surface.show();
    expect(f.commands.at(-2)?.method).toBe('Emulation.clearDeviceMetricsOverride');
    await f.surface.hide();
    expect(f.commands.at(-2)).toMatchObject({ method: 'Emulation.setDeviceMetricsOverride', params: { width: 1280, height: 900 } });
  });

  it('fails when the file input is missing', async () => {
    const f = await fixture((command, socket) => {
      if (command.method !== 'DOM.querySelector') return false;
      socket.send(JSON.stringify({ id: command.id, result: { nodeId: 0 } })); return true;
    });
    await expect(f.surface.attachFiles('#missing', [])).rejects.toThrow('SURFACE_FILE_INPUT_NOT_FOUND');
  });

  it('delegates show/hide and closes once', async () => {
    const f = await fixture();
    await f.surface.show(); expect(f.visibility()).toBe(true);
    await f.surface.hide(); expect(f.visibility()).toBe(false);
    await f.surface.close(); await f.surface.close(); expect(f.closed()).toBe(1);
    await expect(f.surface.readState()).rejects.toThrow('CDP_CLOSED');
  });

  it('rejects script side effects and failed page navigation', async () => {
    const f = await fixture((command, socket) => {
      if (command.method === 'Runtime.evaluate') socket.send(JSON.stringify({ id: command.id, result: { exceptionDetails: { text: 'EvalError' } } }));
      else if (command.method === 'Page.navigate') socket.send(JSON.stringify({ id: command.id, result: { errorText: 'net::ERR_NAME_NOT_RESOLVED' } }));
      else return false;
      return true;
    });
    await expect(f.surface.evaluateReadOnly('document.title = "changed"')).rejects.toThrow('SURFACE_READ_FAILED_OR_SIDE_EFFECT');
    await expect(f.surface.open({ url: 'https://invalid.example/', width: 1280, height: 900, userAgent: 'test', session: 'naver' })).rejects.toThrow('ERR_NAME_NOT_RESOLVED');
  });

  it('bounds navigation waits and validates session and URL', async () => {
    const f = await fixture();
    await expect(f.surface.waitForNavigation({ url: 'https://other.example/', timeoutMs: 20 })).rejects.toThrow('SURFACE_NAVIGATION_TIMEOUT');
    await expect(f.surface.open({ url: 'file:///tmp/a', width: 1280, height: 900, userAgent: 'test', session: 'naver' })).rejects.toThrow('SURFACE_HTTP_URL_REQUIRED');
    await expect(f.surface.open({ url: 'https://example.com/', width: 1280, height: 900, userAgent: 'test', session: 'band' })).rejects.toThrow('SURFACE_SESSION_MISMATCH');
  });

  it('correlates out-of-order replies and propagates CDP errors', async () => {
    let first: Command | undefined;
    const f = await fixture((command, socket) => {
      if (!first) { first = command; return true; }
      socket.send(JSON.stringify({ id: command.id, error: { message: 'protocol failure' } }));
      socket.send(JSON.stringify({ id: first.id, result: { first: true } })); return true;
    });
    const a = f.connection.send('First');
    const b = f.connection.send('Second');
    await expect(b).rejects.toThrow('protocol failure');
    await expect(a).resolves.toEqual({ first: true });
  });

  it('rejects pending calls on timeout and disconnect', async () => {
    const f = await fixture(() => true);
    await expect(f.connection.send('Never', {}, 20)).rejects.toThrow('CDP_TIMEOUT');
    const pending = f.connection.send('Pending');
    f.connection.close();
    await expect(pending).rejects.toThrow('CDP_CLOSED');
  });
});
