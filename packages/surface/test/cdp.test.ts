import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { WebSocketServer, type WebSocket } from 'ws';
import { CdpConnection, CdpSurface, type SurfaceLifecycle } from '../src/cdp';
import { configureTrace, type TraceDetail, type TraceJob } from '../src/telemetry';

interface Command { id: number; method: string; params: Record<string, unknown> }
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));

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
  const lifecycle: SurfaceLifecycle = {
    setVisible: async value => { visible = value; }, close: async () => { closed++; },
  };
  const surface = new CdpSurface('naver', connection, lifecycle, 0);
  cleanup.push(async () => {
    connection.close();
    for (const client of server.clients) client.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return { surface, lifecycle, connection, commands, visibility: () => visible, closed: () => closed,
    event: (method: string, params: Record<string, unknown>) => { for (const socket of server.clients) socket.send(JSON.stringify({ method, params })); } };
}

describe('CDP Surface', () => {
  it.each(['guard-first', 'block-first'])('retains the delete inspector when static write blocks are composed %s', async order => {
    const f = await fixture(), inspect = vi.fn(() => false), response = vi.fn();
    const guard = () => f.surface.guardRequests([{ hostname: 'blog.naver.com', pathname: '/PostDelete.naver' }], inspect, response);
    const block = () => f.surface.blockRequests([{ hostname: 'blog.naver.com', pathname: '/RabbitWrite.naver' }]);
    if (order === 'guard-first') { await guard(); await block(); } else { await block(); await guard(); }
    const patterns = f.commands.filter(c => c.method === 'Fetch.enable').at(-1)!.params.patterns;
    expect(patterns).toEqual(expect.arrayContaining([
      { urlPattern: '*://blog.naver.com/PostDelete.naver*', requestStage: 'Request' },
      { urlPattern: '*://blog.naver.com/PostDelete.naver*', requestStage: 'Response' },
      { urlPattern: '*://blog.naver.com/RabbitWrite.naver*', requestStage: 'Request' },
    ]));
    for (const path of ['/PostDelete.naver', '/RabbitWrite.naver']) f.event('Fetch.requestPaused', { requestId: path, request: { url: 'https://blog.naver.com' + path, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, postData: 'blogId=synthetic&logNo=9001' } });
    await vi.waitFor(() => expect(f.commands.filter(c => c.method === 'Fetch.failRequest')).toHaveLength(2));
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://blog.naver.com/PostDelete.naver', postDataComplete: true }));
    expect(response).not.toHaveBeenCalled();
  });
  it('explains static and inspector-error blocks with field names and no body values', async () => {
    const lines: TraceDetail[] = [];
    const job: TraceJob = { id: 'synthetic', decisionReason: undefined, line: (_step, _event, detail) => { if (detail) lines.push(detail); }, end() {} };
    configureTrace({ begin: () => job, current: () => job, run: (_job, work) => work(), bind: work => work });
    try {
      const f = await fixture();
      await f.surface.blockRequests([{hostname:'blog.naver.com',pathname:'/RabbitUpdate.naver'}]);
      await f.surface.guardRequests([{hostname:'blog.naver.com',pathname:'/RabbitWrite.naver'}], () => { throw Error('PRIVATE_ERROR'); }, () => {});
      for (const path of ['/RabbitUpdate.naver','/RabbitWrite.naver']) f.event('Fetch.requestPaused', { requestId: path, request: {url:'https://blog.naver.com'+path,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},postData:'blogId=PRIVATE_ACCOUNT&documentModel=PRIVATE_BODY'} });
      await vi.waitFor(() => expect(f.commands.filter(c => c.method === 'Fetch.failRequest')).toHaveLength(2));
      expect(lines).toContainEqual(expect.objectContaining({reason:'STATIC_BLOCK',network:expect.objectContaining({path:'/RabbitUpdate.naver',bodyFields:['blogId','documentModel'],decision:'blocked'})}));
      expect(lines).toContainEqual(expect.objectContaining({reason:'INSPECTOR_ERROR',network:expect.objectContaining({path:'/RabbitWrite.naver',bodyFields:['blogId','documentModel'],decision:'blocked'})}));
      expect(JSON.stringify(lines)).not.toMatch(/PRIVATE_/);
    } finally { configureTrace(undefined); }
  });
  it('rechecks keyboard authorization immediately before keydown and sends no key after refusal', async () => {
    const f = await fixture();
    await expect(f.surface.pressKey({ key: 'Enter' }, async () => { throw Error('CHANGED'); })).rejects.toThrow('CHANGED');
    expect(f.commands.some(c => c.method === 'Input.dispatchKeyEvent')).toBe(false);
    await f.surface.pressKey({ key: 'Enter' }, async () => {});
    expect(f.commands.filter(c => c.method === 'Input.dispatchKeyEvent').map(c => c.params.type)).toEqual(['keyDown', 'keyUp']);
  });
  it('reads an explicitly selected GET receipt, excluding preflight and unrelated reads', async () => {
    const f = await fixture((command, socket) => {
      if (command.method !== 'Fetch.getResponseBody') return false;
      socket.send(JSON.stringify({ id: command.id, result: { body: '{"result_code":1}' } })); return true;
    });
    const response = vi.fn();
    await f.surface.guardRequests([{ hostname: '*', pathname: '/', prefix: true }], () => true, response,
      r => r.method === 'GET' && new URL(r.url).pathname === '/receipt');
    for (const [id, method, path] of [['preflight', 'OPTIONS', '/receipt'], ['other', 'GET', '/other'], ['selected', 'GET', '/receipt']]) {
      f.event('Fetch.requestPaused', { requestId: id, request: { url: `https://example.invalid${path}`, method } });
      await vi.waitFor(() => expect(f.commands.some(c => c.method === 'Fetch.continueRequest' && c.params.requestId === id)).toBe(true));
      f.event('Fetch.requestPaused', { requestId: id, responseStatusCode: 200 });
    }
    await vi.waitFor(() => expect(response).toHaveBeenCalledOnce());
    expect(response).toHaveBeenCalledWith({ status: 200, body: '{"result_code":1}', method: 'GET', url: 'https://example.invalid/receipt' });
    expect(f.commands.filter(c => c.method === 'Fetch.getResponseBody')).toHaveLength(1);
  });
  it('reports an inspector exception as a fixed reason only after the blocking command is acknowledged', async () => {
    const f = await fixture();
    const blocked = vi.fn();
    await f.surface.guardRequests([{ hostname: '*', pathname: '/', prefix: true }], () => { throw Error('PRIVATE_EXCEPTION'); }, () => {}, undefined, blocked);
    f.event('Fetch.requestPaused', { requestId: 'synthetic-block', request: { url: 'https://example.invalid/create', method: 'POST', postData: 'PRIVATE_BODY' } });
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledWith({ url: 'https://example.invalid/create', method: 'POST' }, 'INSPECTOR_ERROR'));
    expect(JSON.stringify(blocked.mock.calls)).not.toMatch(/PRIVATE_/);
  });
  it('does not read a membership response body, but keeps armed publication response failures closed', async () => {
    const f = await fixture((command, socket) => {
      if(command.method === 'Fetch.continueRequest' && command.params.requestId === 'cancelled') {
        socket.send(JSON.stringify({ id: command.id, error: { message: 'Invalid InterceptionId.' } })); return true;
      }
      if(command.method !== 'Fetch.getResponseBody')return false;
      socket.send(JSON.stringify({ id: command.id, error: { message: 'RESPONSE_BODY_UNAVAILABLE' } })); return true;
    });
    const inspect = vi.fn(() => true);
    await f.surface.guardRequests([{hostname:'*',pathname:'/',prefix:true}], inspect, () => {}, request => request.url.endsWith('/post/create'));
    const emit = async (id: string, url: string, failed = false) => {
      f.event('Fetch.requestPaused',{requestId:id,request:{url,method:'POST'}});
      await vi.waitFor(()=>expect(f.commands.some(c=>c.method==='Fetch.continueRequest'&&c.params.requestId===id)).toBe(true));
      f.event('Fetch.requestPaused',{requestId:id,...(failed?{responseErrorReason:'Failed'}:{responseStatusCode:200}),request:{url,method:'POST'}});
      await vi.waitFor(()=>expect(f.commands.filter(c=>c.method==='Fetch.continueRequest'&&c.params.requestId===id)).toHaveLength(2));
    };
    await emit('read','https://api-kr.band.us/v2.3.0/get_band_list');
    await emit('read-error','https://api-kr.band.us/v2.3.0/get_band_list',true);
    expect(inspect).toHaveBeenCalledTimes(2); // an error response is not a second outgoing request
    expect(f.commands.some(c=>c.method==='Fetch.getResponseBody')).toBe(false);
    await expect(f.surface.click(10,10)).resolves.toBeUndefined();
    f.event('Fetch.requestPaused',{requestId:'cancelled',request:{url:'https://band.us/cancelled-read',method:'GET'}});
    await vi.waitFor(()=>expect(f.commands.some(c=>c.method==='Fetch.continueRequest'&&c.params.requestId==='cancelled')).toBe(true));
    await expect(f.surface.click(10,10)).resolves.toBeUndefined();
    await emit('publish','https://api-kr.band.us/v2.3.0/band/post/create');
    expect(f.commands.filter(c=>c.method==='Fetch.getResponseBody')).toHaveLength(1);
    await expect(f.surface.click(10,10)).rejects.toThrow('SURFACE_DRAFT_BARRIER_FAILED');
  });
  it('requires native navigation enforcement and delegates only policy and hide events, without request interception', async () => {
    const f = await fixture();
    const policy = { allowed: [{ hostname: 'nid.naver.com', pathname: '/nidlogin.login' }], landing: [], fallbackUrl: 'https://nid.naver.com/nidlogin.login' };
    await expect(f.surface.restrictNavigation(policy)).rejects.toThrow('SURFACE_NAVIGATION_GUARD_REQUIRED');
    f.lifecycle.restrictNavigation = vi.fn(async () => {});
    const cancel = vi.fn(), landing = vi.fn(), unsubscribe = vi.fn();
    f.lifecycle.onUserHidden = fn => { fn(); return unsubscribe; };
    f.lifecycle.onNavigationHidden = fn => { fn(); return unsubscribe; };
    await f.surface.restrictNavigation(policy); expect(f.lifecycle.restrictNavigation).toHaveBeenCalledWith(policy);
    f.surface.onUserHidden(cancel)(); f.surface.onNavigationHidden(landing)();
    expect(cancel).toHaveBeenCalledOnce(); expect(landing).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(f.commands).toEqual([]);
  });
  it('rejects a canceled navigation without accepting a complete previous page', async () => {
    const f = await fixture((command, socket) => {
      if (command.method !== 'Page.navigate') return false;
      socket.send(JSON.stringify({ id: command.id, result: { errorText: 'net::ERR_ABORTED' } }));
      return true;
    });
    await expect(f.surface.open({ url: 'https://example.com/', session: 'naver', width: 412, height: 800, userAgent: 'fixture' })).rejects.toThrow('net::ERR_ABORTED');
    expect(f.visibility()).toBe(false);
  });
  it.each([{ x: 490, y: 895 }, { x: 12.25, y: 340.75 }])('tests the unrounded viewport point in the root frame isolated world (%j)', async ({ x, y }) => {
    const f = await fixture((command, socket) => {
      let result: unknown;
      if (command.method === 'Page.getFrameTree') result = { frameTree: { frame: { id: 'outer' }, childFrames: [{ frame: { id: 'editor' } }] } };
      else if (command.method === 'Page.createIsolatedWorld') result = { executionContextId: 19 };
      else if (command.method === 'Runtime.evaluate') result = { result: { value: true } };
      else return false;
      socket.send(JSON.stringify({ id: command.id, result })); return true;
    });
    expect(await f.surface.readClickTarget(x, y, 'body')).toBe(true);
    expect(f.commands.map(c => c.method)).toEqual(['Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.evaluate']);
    expect(f.commands[1]?.params).toEqual({ frameId: 'outer', worldName: 'goltou-click-target' });
    expect(f.commands[2]?.params).toMatchObject({ contextId: 19, returnByValue: true });
    expect(f.commands[2]?.params.expression).toContain(`)(${x},${y},"body",null,false,null)`);
  });
  it.each(['missing', 'truncated', 'unavailable'] as const)('obtains omitted/full paused POST data or fails closed (%s)', async mode => {
    const inspect = vi.fn(request => request.postDataComplete === true && request.postData === 'openType=0');
    const f = await fixture((command, socket) => {
      if (command.method !== 'Network.getRequestPostData') return false;
      socket.send(JSON.stringify({ id: command.id, ...(mode === 'unavailable' ? { error: { message: 'unavailable' } } : { result: { postData: 'openType=0' } }) })); return true;
    });
    await f.surface.guardRequests([{ hostname: 'blog.naver.com', pathname: '/RabbitWrite.naver' }], inspect, () => {});
    f.event('Fetch.requestPaused', { requestId: 'fetch-one', networkId: 'network-one', request: { url: 'https://blog.naver.com/RabbitWrite.naver', method: 'POST', hasPostData: true,
      ...(mode === 'truncated' ? { postData: 'openType=' } : {}), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '10' } } });
    await vi.waitFor(() => expect(f.commands).toHaveLength(4));
    expect(f.commands[2]).toMatchObject({ method: 'Network.getRequestPostData', params: { requestId: 'network-one' } });
    expect(f.commands[3]!.method).toBe(mode === 'unavailable' ? 'Fetch.failRequest' : 'Fetch.continueRequest');
    expect(inspect.mock.calls[0]![0]).toMatchObject({ postDataInline: mode === 'truncated', postDataFetched: mode !== 'unavailable', postDataComplete: mode !== 'unavailable' });
  });
  it('blocks async probe requests, including updates, even when evidence throws', async () => {
    const f = await fixture();
    await f.surface.guardRequests(['/RabbitWrite.naver', '/RabbitUpdate.naver'].map(pathname => ({ hostname: 'blog.naver.com', pathname })), async () => { await Promise.resolve(); throw new Error('DISK_FAILED'); }, () => { throw new Error('UNEXPECTED_RESPONSE'); });
    for (const path of ['RabbitWrite', 'RabbitUpdate']) f.event('Fetch.requestPaused', { requestId: path, request: { url: `https://blog.naver.com/${path}.naver`, method: 'POST' } });
    await vi.waitFor(() => expect(f.commands.filter(c => c.method === 'Fetch.failRequest')).toHaveLength(2));
  });
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
    await vi.waitFor(() => expect(f.commands).toHaveLength(4));
    expect(f.commands[2]).toMatchObject({ method: 'Fetch.continueRequest', params: { requestId: 'one' } });
    expect(f.commands[3]).toMatchObject({ method: 'Fetch.failRequest', params: { requestId: 'two' } });
    f.event('Fetch.requestPaused', { requestId: 'one', responseStatusCode: 200, request: { url: 'https://blog.naver.com/RabbitWrite.naver' } });
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ status: 200, body: '{"result":{"logNo":9001}}', url: 'https://blog.naver.com/RabbitWrite.naver', method: 'POST' }));
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

  it('sends a native vertical wheel event at the requested viewport point', async () => {
    const f = await fixture();
    await f.surface.wheel(20, 30, 85);
    expect(f.commands).toEqual([expect.objectContaining({ method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseWheel', x: 20, y: 30, deltaX: 0, deltaY: 85 } })]);
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

it.runIf(Boolean(executablePath))('hits a scrolled same-origin editor frame and rejects parent overlays and opaque frames', async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking'] });
  cleanup.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  const cdp = await page.context().newCDPSession(page);
  const connection = {
    on: () => {},
    send: (method: string, params: object) => cdp.send(method as never, params as never),
  } as unknown as CdpConnection;
  const surface = new CdpSurface('naver', connection, { setVisible: async () => {}, close: async () => {} }, 0);
  await page.setContent(`
    <style>body{margin:0;height:1800px}iframe{position:fixed;top:40px;left:30px;border:8px solid;padding:4px}
    #overlay{position:fixed;top:80px;left:60px;width:80px;height:60px}</style>
    <iframe srcdoc="<style>body{margin:0;height:800px}button{position:absolute;left:20px;top:230px;width:80px;height:36px}span{display:block}</style>
      <button id='target'><span>저장</span></button>"></iframe>
    <button id="overlay" hidden>다른 제어</button>
    <script>document.elementFromPoint = () => document.querySelector('#overlay')</script>`);
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.frameLocator('iframe').locator('#target').evaluate(e => {
    e.ownerDocument.defaultView!.scrollTo(0, 180);
    e.ownerDocument.elementFromPoint = () => e.ownerDocument.body;
  });
  const { x, y } = (await page.frameLocator('iframe').locator('#target span').boundingBox())!;
  const report = vi.fn();
  const onMiss = { classes: [], ariaLabels: [], report };
  await expect(surface.readClickTarget(x + 4, y + 4, '#target', { exactText: '저장' })).resolves.toBe(true);
  await expect(surface.readClickTarget(x + 4, y + 4, '#target', { exactText: '발행', onMiss })).resolves.toBe(false);
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ scrollY: 300, rejectedHit: expect.objectContaining({ tag: 'span', relation: 'descendant' }) }));
  await page.locator('#overlay').evaluate(e => { (e as HTMLElement).hidden = false; });
  await expect(surface.readClickTarget(x + 4, y + 4, '#target', { onMiss })).resolves.toBe(false);
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ rejectedHit: expect.objectContaining({ tag: 'button', relation: 'unrelated' }) }));
  await page.locator('#overlay').evaluate(e => { (e as HTMLElement).hidden = true; });
  await page.locator('iframe').evaluate(e => { e.setAttribute('sandbox', ''); e.setAttribute('srcdoc', '<button id="target" style="width:100%;height:100%">저장</button>'); });
  await page.frameLocator('iframe').locator('#target').waitFor();
  await expect(surface.readClickTarget(x + 4, y + 4, '#target', { onMiss })).resolves.toBe(false);
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ rejectedHit: expect.objectContaining({ tag: 'iframe' }) }));
});
