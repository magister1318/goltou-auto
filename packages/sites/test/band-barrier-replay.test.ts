import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { CdpConnection, CdpSurface } from '@goltou/surface/cdp';
import type { SurfaceHost } from '@goltou/surface';
import { BandDirectory } from '../src/band/plan';

// Evidence proves this route and a client block, not the missing payload or
// pre-create sequence. Bodies/order below are explicitly synthetic, never a
// claimed capture. Replay runs the production CDP -> BandDirectory path offline.
const createUrl = 'https://api-kr.band.us/v2.0.2/create_post';
const target = 'synthetic-target';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(staticBlock = false, failBlock = false) {
  const commands: { method: string; params: Record<string, unknown> }[] = [];
  const bodies = new Map<string, string>();
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  server.on('connection', socket => socket.on('message', raw => {
    const command = JSON.parse(String(raw)); commands.push(command);
    let result: unknown = {};
    let error: { message: string } | undefined;
    if (command.method === 'Network.getRequestPostData') {
      const postData = bodies.get(command.params.requestId);
      if (postData === undefined) error = { message: 'unavailable' };
      else result = { postData };
    }
    if (command.method === 'Fetch.failRequest' && failBlock) error = { message: 'Invalid InterceptionId.' };
    if (command.method === 'Fetch.getResponseBody') result = { body: '{}' };
    socket.send(JSON.stringify({ id: command.id, ...(error ? { error } : { result }) }));
  }));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('FIXTURE_PORT');
  const cdp = await CdpConnection.connect(`ws://127.0.0.1:${address.port}`);
  cleanup.push(async () => { cdp.close(); for (const s of server.clients) s.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const surface = new CdpSurface('band', cdp, { setVisible: async () => {}, close: async () => {} }, 0);
  if (staticBlock) await surface.blockRequests([{ hostname: 'api-kr.band.us', pathname: '/v2.0.2/create_post' }]);
  const record = vi.fn();
  const directory = new BandDirectory({ create: async () => surface } as unknown as SurfaceHost, undefined, false, false, undefined, record);
  await directory.getSurface();
  let serial = 0;
  const emit = (params: Record<string, unknown>) => { for (const s of server.clients) s.send(JSON.stringify({ method: 'Fetch.requestPaused', params })); };
  const request = async (raw: Record<string, unknown>, options: { fetchedBody?: string; noNetworkId?: boolean; concurrent?: boolean } = {}) => {
    const requestId = `synthetic-${++serial}`, networkId = `network-${serial}`;
    if (options.fetchedBody !== undefined) bodies.set(networkId, options.fetchedBody);
    emit({ requestId, ...(!options.noNetworkId ? { networkId } : {}), request: { url: createUrl, method: 'POST', ...raw } });
    if (options.concurrent) return requestId;
    await vi.waitFor(() => expect(commands.some(c => ['Fetch.continueRequest', 'Fetch.failRequest'].includes(c.method) && c.params.requestId === requestId)).toBe(true));
    // Allow the protocol acknowledgement and diagnostic callback to settle.
    await new Promise(resolve => setTimeout(resolve, 10));
    return requestId;
  };
  const method = (id: string) => commands.find(c => ['Fetch.continueRequest', 'Fetch.failRequest'].includes(c.method) && c.params.requestId === id)?.method;
  return { directory, commands, record, request, method, emit };
}

it.each(['json', 'form', 'multipart'] as const)('passes the observed route exactly once through the production barrier (%s, synthetic payload/sequence)', async encoding => {
  const f = await fixture();
  const body = encoding === 'json' ? JSON.stringify({ band_key: target }) : encoding === 'form' ? `band_key=${target}`
    : `--synthetic\r\nContent-Disposition: form-data; name="band_key"\r\n\r\n${target}\r\n--synthetic--\r\n`;
  const contentType = encoding === 'json' ? 'application/json; charset=UTF-8' : encoding === 'form' ? 'application/x-www-form-urlencoded; charset=UTF-8' : 'multipart/form-data; boundary=synthetic';
  f.directory.arm(target);
  for (const raw of [
    { method: 'OPTIONS' },
    { url: 'https://api-kr.band.us/v2.3.0/get_band_list', postData: '' },
    { url: 'https://up.band.us/v3/upload_photo', postData: '' },
  ]) expect(f.method(await f.request(raw))).toBe('Fetch.continueRequest');
  expect(f.directory.decisionCodes).not.toContain('CREATE_ALLOWED');
  // Fetch's inline body can be absent on mobile; recover it via networkId.
  const raw = { url: `${createUrl}?synthetic=1`, hasPostData: true, headers: { 'Content-Type': contentType, 'Content-Length': String(Buffer.byteLength(body)) } };
  expect(f.method(await f.request(raw, { fetchedBody: body }))).toBe('Fetch.continueRequest');
  expect(f.method(await f.request(raw, { fetchedBody: body }))).toBe('Fetch.failRequest');
  expect(f.directory.decisionCodes.filter(c => c === 'CREATE_ALLOWED')).toHaveLength(1);
  expect(f.directory.blockedBeforeSend(target)).toBeUndefined(); // a denied duplicate never proves the first wasn't sent
  expect(f.directory.submitted(target)).toBe(false); // no response/readback proof
  expect(JSON.stringify(f.record.mock.calls)).not.toContain(target);
  expect(JSON.stringify(f.record.mock.calls)).not.toMatch(/https:|band_key|Content-Type/);
});

it.each([
  ['TARGET_MISSING', '{}', 'application/json'],
  ['TARGET_DUPLICATE', '{"band_key":"synthetic-target","band_key":"synthetic-target"}', 'application/json'],
  ['TARGET_DUPLICATE', 'band_key=synthetic-target&band_key=synthetic-target', 'application/x-www-form-urlencoded'],
  ['TARGET_TYPE', '{"band_key":["synthetic-target"]}', 'application/json'],
  ['TARGET_MISMATCH', '{"band_key":"other-synthetic-target"}', 'application/json'],
  ['BODY_PARSE', '{', 'application/json'],
  ['BODY_ENCODING', 'band_key=synthetic-target', 'text/plain'],
] as const)('records %s and closes the approval without silently accepting an editor retry', async (code, postData, contentType) => {
  const f = await fixture(); f.directory.arm(target);
  expect(f.method(await f.request({ postData, headers: { 'Content-Type': contentType } }))).toBe('Fetch.failRequest');
  expect(f.directory.blockedBeforeSend(target)).toBe(`BAND_POST_BLOCKED:${code}`);
  expect(f.method(await f.request({ postData: JSON.stringify({ band_key: target }), headers: { 'Content-Type': 'application/json' } }))).toBe('Fetch.failRequest');
  expect(f.directory.blockedBeforeSend(target)).toBe(`BAND_POST_BLOCKED:${code}`);
  expect(f.directory.decisionCodes).not.toContain('CREATE_ALLOWED');
});

it.each(['MISSING', 'NETWORK_ID_MISSING', 'FETCH_FAILED', 'LENGTH_MISMATCH'] as const)('distinguishes incomplete body reason %s', async code => {
  const f = await fixture(); f.directory.arm(target);
  const raw = code === 'MISSING' ? {} : { hasPostData: true, headers: { 'Content-Length': '999' } };
  await f.request(raw, { noNetworkId: code === 'NETWORK_ID_MISSING', ...(code === 'LENGTH_MISMATCH' ? { fetchedBody: '{}' } : {}) });
  expect(f.directory.blockedBeforeSend(target)).toBe(`BAND_POST_BLOCKED:BODY_${code}`);
});

it('diagnoses an unknown pre-create write without consuming the one create slot', async () => {
  const f = await fixture(); f.directory.arm(target);
  expect(f.method(await f.request({ url: 'https://api-kr.band.us/synthetic-pre-create' }))).toBe('Fetch.failRequest');
  expect(f.directory.blockedBeforeSend(target)).toBeUndefined();
  expect(f.method(await f.request({ postData: `band_key=${target}` }))).toBe('Fetch.continueRequest');
  expect(f.method(await f.request({ postData: `band_key=${target}` }))).toBe('Fetch.failRequest');
  expect(f.directory.decisionCodes.filter(c => c === 'CREATE_ALLOWED')).toHaveLength(1);
});

it('retains the native surface static block and reports its exact layer', async () => {
  const f = await fixture(true); f.directory.arm(target);
  await f.request({ postData: `band_key=${target}` });
  expect(f.directory.blockedBeforeSend(target)).toBe('BAND_POST_BLOCKED:SURFACE_STATIC_BLOCK');
});

it('never claims nothing was sent when Fetch did not acknowledge the block', async () => {
  const f = await fixture(false, true); f.directory.arm(target);
  await f.request({ postData: '{}' });
  expect(f.directory.blockedBeforeSend(target)).toBeUndefined();
  expect(f.directory.decisionCodes).toContain('TARGET_MISSING');
});

it('serializes the one-shot state even when two creates arrive before body retrieval finishes', async () => {
  const f = await fixture(); f.directory.arm(target);
  const raw = { hasPostData: true }, options = { fetchedBody: `band_key=${target}`, concurrent: true };
  const ids = [await f.request(raw, options), await f.request(raw, options)];
  await vi.waitFor(() => expect(ids.map(f.method).sort()).toEqual(['Fetch.continueRequest', 'Fetch.failRequest']));
  expect(f.directory.decisionCodes.filter(c => c === 'CREATE_ALLOWED')).toHaveLength(1);
});

it.each([
  ['http://api-kr.band.us/v2.0.2/create_post', 'ORIGIN_BLOCKED'],
  ['https://other.band.us/v2.0.2/create_post', 'ROUTE_BLOCKED'],
  ['https://api-kr.band.us:444/v2.0.2/create_post', 'ROUTE_BLOCKED'],
  ['https://api-kr.band.us/v2.0.3/create_post', 'ROUTE_BLOCKED'],
  ['https://api-kr.band.us/v2.0.2/create_post/extra', 'ROUTE_BLOCKED'],
] as const)('rejects an altered origin/route through the real barrier (%s)', async (url, code) => {
  const f = await fixture(); f.directory.arm(target);
  await f.request({ url, postData: `band_key=${target}` });
  expect(f.directory.blockedBeforeSend(target)).toBe(`BAND_POST_BLOCKED:${code}`);
});

it('blocks a redirect replay and never labels the admitted first create as not posted', async () => {
  const f = await fixture(); f.directory.arm(target);
  const id = await f.request({ postData: `band_key=${target}` });
  f.emit({ requestId: id, responseStatusCode: 307, request: { url: createUrl, method: 'POST' } });
  await vi.waitFor(() => expect(f.commands.filter(c => c.method === 'Fetch.continueRequest' && c.params.requestId === id)).toHaveLength(2));
  await f.request({ postData: `band_key=${target}` });
  expect(f.directory.decisionCodes.filter(c => c === 'CREATE_ALLOWED')).toHaveLength(1);
  expect(f.directory.decisionCodes).toContain('ALREADY_SENT');
  expect(f.directory.blockedBeforeSend(target)).toBeUndefined();
});
