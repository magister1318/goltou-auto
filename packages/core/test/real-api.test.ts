import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { build } from 'esbuild';
import { ApiError, createApiClient, type ApiClient, type LoginInput, type Product } from '@goltou/api-client';
import { observePlan } from '../src/verify';
import { AppCore, MemoryTokenStore } from '../src/app';
import type { AppRequest, Job } from '../src/protocol';
import { conversionMetric, auditConversions, type ConversionAudit } from '../src/conversion-audit';
import { downloadPhotos, goltouPhotoUrl } from '../src/media';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const user = { userNo: 1, name: 'local-user', userType: 4, role: 'manager' };
const settings = { closingText: '', defaultHashtags: [], bandDailyLimit: 3 };
const credentials = (): LoginInput => ({ loginId: 'local-id', password: 'local-password', device: { kind: 'android', model: 'ignored', appVersion: 'ignored' } });
const product: Product = { productNo: 77, title: 'PRIVATE-TITLE', contentsHtml: '<table><tr><td>PRIVATE-BODY 1,190,000원 2026-12-03<img src="https://api.goltou.kr/private.png"></td></tr></table><p><em>지원하지 않는 서식</em></p>', country: '', region: '', images: [{ order: 1, url: 'https://api.goltou.kr/private.png' }], departures: [{ date: '2026-12-03', price: 1190000 }], golfCourses: ['PRIVATE-COURSE'], productUrl: 'https://goltou.kr/private', updatedAt: '', contentHash: 'private-hash' };
async function fixture(timeout = 15000) {
  let failure = '';
  const calls: { route: string; input: unknown; bearer: string | undefined }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => {
      const input = JSON.parse(body); calls.push({ route: req.url!, input, bearer: req.headers.authorization });
      if (failure === 'disconnect') { req.socket.destroy(); return; }
      if (failure === 'timeout') return;
      if (failure === 'body-timeout') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); return; }
      if (failure === 'redirect') { res.writeHead(307, { location: '/unexpected' }).end(); return; }
      if (failure) { res.writeHead(403).end(JSON.stringify({ ok: false, code: failure, message: '로컬 오류 안내' })); return; }
      const data = req.url === '/auto/login' ? { token: 'local-bearer', user } : req.url === '/auto/me' ? { user, settings } : req.url === '/auto/products/get' ? product : req.url === '/auto/posts/start' ? { postNo: 91 } : { total: 1, items: [] };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, data }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('LOOPBACK_REQUIRED');
  const tokens = new MemoryTokenStore();
  const api = createApiClient(`http://127.0.0.1:${address.port}`, fetch, timeout);
  const app = new AppCore(api, tokens, undefined, undefined, { device: async () => ({ kind: 'android', model: 'local-model', appVersion: '0.1.0' }) });
  cleanup.push(() => app.dispose());
  const call = (command: AppRequest['command'], input: unknown = {}) => app.handle({ type: 'app', id: 1, command, input } as AppRequest);
  return { api, tokens, app, call, calls, fail: (value: string) => { failure = value; } };
}

describe('production client over a local contract HTTP server', () => {
  it('submits credentials once, clears the input, uses shell device data, retains only a token and logs out', async () => {
    const f = await fixture(); const input = credentials();
    await f.call('login', input);
    expect(input.password).toBe(''); expect(input.loginId).toBe('');
    expect(f.calls.map(c => c.route)).toEqual(['/auto/login', '/auto/me']);
    expect(f.calls[0]).toMatchObject({ bearer: undefined, input: { device: { kind: 'android', model: 'local-model', appVersion: '0.1.0' } } });
    expect(await f.tokens.read()).toBe('local-bearer');
    expect(JSON.stringify(f.app.snapshot())).not.toMatch(/local-bearer|local-password|local-id/);
    await f.call('logout'); expect(await f.tokens.read()).toBeNull(); expect(f.app.snapshot().user).toBeNull();
    expect(f.calls.map(c => c.route)).toEqual(['/auto/login', '/auto/me', '/auto/logout']);
  });
  it.each(['auth', 'forbidden'])('clears stored session on %s without repeating a request, then allows manual login', async code => {
    const f = await fixture(); await f.call('login', credentials()); f.fail(code);
    await expect(f.call('products.list')).rejects.toMatchObject({ code });
    expect(await f.tokens.read()).toBeNull(); expect(f.app.snapshot().user).toBeNull();
    expect(f.calls.filter(c => c.route === '/auto/products/list')).toHaveLength(1);
    f.fail(''); await f.call('login', credentials()); expect(f.app.snapshot().user).toMatchObject(user);
  });
  it.each(['disconnect', 'timeout', 'body-timeout', 'server', 'redirect'])('shows Korean error for %s without retrying login or retaining its password', async failure => {
    const f = await fixture(150); f.fail(failure); const input = credentials();
    await expect(f.call('login', input)).rejects.toMatchObject({ code: 'server', message: expect.stringMatching(/[가-힣]/) });
    expect(input.password).toBe(''); expect(await f.tokens.read()).toBeNull(); expect(f.calls).toHaveLength(1);
  });
  it('rejects duplicate login while the first call is in flight and deletes token even if logout fails', async () => {
    const f = await fixture(150); f.fail('timeout');
    const first = expect(f.call('login', credentials())).rejects.toHaveProperty('code', 'server');
    const second = credentials(); await expect(f.call('login', second)).rejects.toHaveProperty('code', 'conflict');
    expect(second.password).toBe(''); await first; expect(f.calls).toHaveLength(1);
    f.fail(''); await f.call('login', credentials()); f.fail('disconnect');
    await expect(f.call('logout')).rejects.toHaveProperty('code', 'server'); expect(await f.tokens.read()).toBeNull();
  });
  it('restores a stored token once, removes an expired token on startup and never returns it in a snapshot', async () => {
    const f = await fixture(); await f.tokens.write('stored-token'); f.fail('auth');
    await expect(f.call('session.get')).rejects.toHaveProperty('code', 'auth');
    await f.call('session.get'); expect(f.calls).toHaveLength(1); expect(await f.tokens.read()).toBeNull();
  });
  it('uses a 15-second default deadline even for an unresponsive fetch and aborts once', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetcher = vi.fn((_url: string, init: { signal: AbortSignal }) => { signal = init.signal; return new Promise<never>(() => {}); });
      const promise = expect(createApiClient('http://127.0.0.1', fetcher).request('/auto/me', {}, 'local')).rejects.toHaveProperty('code', 'server');
      await vi.advanceTimersByTimeAsync(14999); expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1); await promise; expect(signal?.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it.each([false, true])('prefixes the registration title only with explicit experiment opt-in (%s)', async experimentTitle => {
    const f = await fixture(); await f.call('login', credentials());
    const app = new AppCore(f.api, f.tokens, undefined, undefined, { device: async () => credentials().device, experimentTitle }); cleanup.push(() => app.dispose());
    await app.restoreSession();
    const preview = await app.handle({ type: 'app', id: 2, command: 'preview.prepare', input: { productNo: 77, options: { polish: false, closing: false, linkCard: true } } }) as import('../src/preparation').PreparedPreview;
    expect(observePlan(preview.blog)).toMatchObject({ title: experimentTitle ? `[골투오토 실험] ${product.title}` : product.title, prices: ['1190000'], departures: ['2026-12-03'], golfCourses: product.golfCourses });
    expect(preview.blog.steps).toContainEqual(expect.objectContaining({ kind: 'text', role: 'linkCard', text: product.productUrl }));
    expect(preview.contentHash).toBe(product.contentHash); expect(product.title).toBe('PRIVATE-TITLE');
  });
  it('never repeats an ambiguous posts/start on another start button press', async () => {
    const f = await fixture(); await f.call('login', credentials());
    const api: ApiClient = { request: (route, input, token) => route === '/auto/posts/start' ? Promise.reject(new ApiError('server', '시간 초과')) : f.api.request(route, input, token) };
    const start = vi.spyOn(api, 'request'); const app = new AppCore(api, f.tokens); cleanup.push(() => app.dispose());
    await app.restoreSession();
    const request: AppRequest = { type: 'app', id: 2, command: 'job.start', input: { productNo: 77, mode: 'draft', targets: [{ channel: 'blog', name: 'local', key: '' }], options: { polish: false, closing: false, linkCard: false } } };
    await expect(app.handle(request)).rejects.toHaveProperty('code', 'server');
    await expect(app.handle(request)).rejects.toHaveProperty('code', 'conflict');
    expect(start.mock.calls.filter(c => c[0] === '/auto/posts/start')).toHaveLength(1);
  });
  it('does not resend an identical posts/update after a lost reply', async () => {
    const f = await fixture(); await f.call('login', credentials());
    let checkpoint!: (job: Job) => Promise<void>;
    const app = new AppCore(f.api, f.tokens, save => { checkpoint = save; return { job: null, start: async () => {}, stop: async () => {}, resume: async () => {}, dispose() {} }; }); cleanup.push(() => app.dispose());
    await app.restoreSession();
    const input = { productNo: 77, mode: 'draft' as const, targets: [{ channel: 'blog' as const, name: 'local', key: '' }], options: { polish: false, closing: false, linkCard: false } };
    await app.handle({ type: 'app', id: 2, command: 'job.start', input });
    f.fail('disconnect');
    const job: Job = { ...input, id: 1, title: 'local', status: 'running', step: 2, current: 1, total: 2, completedSteps: [1], service: null, message: '' };
    await expect(checkpoint(job)).rejects.toHaveProperty('code', 'RECORD_FAILED:server');
    await expect(checkpoint(job)).rejects.toHaveProperty('code', 'RECORD_FAILED:server');
    expect(f.calls.filter(c => c.route === '/auto/posts/update')).toHaveLength(1);
  });
});

describe('conversion metrics and production media restrictions', () => {
  it('keeps numeric strike counts while omitting struck contents from conversion', () => {
    const source = { ...product, contentsHtml: '<p><del>이전 123<s>45</s></del><s>문자만</s><strike>날짜 2026-12-03</strike>유효 999</p><del><script>123456</script></del>' };
    const metric = conversionMetric(source);
    expect(metric.struckNumericCharacters).toBe(13);
    expect(metric.droppedStruckCharacters).toBe(24);
    expect(metric.blog?.numbersPreserved).toBe(true);
    expect(metric.band?.numbersPreserved).toBe(true);
    expect(JSON.stringify(metric)).not.toMatch(/123|2026|999|이전|날짜|유효/);
    expect(conversionMetric({ ...source, contentsHtml: '<p><del>문자만</del>123</p>' }).struckNumericCharacters).toBe(0);
  });
  it('keeps counts, fallback types and numeric preservation, while excluding every source field', () => {
    const metric = conversionMetric(product, { text: 10, photos: 0 });
    expect(metric).toMatchObject({ productNo: 77, tables: 1, tablesWithImages: 1, photos: 1, textFallbackElements: ['em'], failureCode: null });
    expect(metric.blog).toMatchObject({ numbersPreserved: true, pricesPreserved: true, datesPreserved: true, sourceMatches: true });
    expect(metric.band).toMatchObject({ textLimitExceeded: true, photoLimitExceeded: true });
    const json = JSON.stringify(metric);
    for (const value of [product.title, 'PRIVATE-BODY', 'PRIVATE-COURSE', product.images[0]!.url, product.productUrl, product.contentHash, '1,190,000', '2026-12-03']) expect(json).not.toContain(value);
    expect(conversionMetric(product).band).toMatchObject({ textLimitExceeded: null, photoLimitExceeded: null });
  });
  it('caps at 60, uses recent pagination and a one-second gap between every read; never calls a write route', async () => {
    const routes: string[] = [], waits: number[] = [];
    const api = { request: vi.fn(async (route: string, input: { page?: number; pageSize?: number; sort?: string; productNo?: number }) => {
      routes.push(route);
      if (route.endsWith('/list')) { expect(input).toMatchObject({ sort: 'recent', pageSize: 30 }); return { total: 100, items: Array.from({ length: 30 }, (_, i) => ({ productNo: ((input.page ?? 1) - 1) * 30 + i + 1 })) }; }
      return { ...product, productNo: input.productNo };
    }) } as unknown as ApiClient;
    let saved = ''; const result = await auditConversions(api, 'private-token', async value => { saved = JSON.stringify(value); }, () => {}, async ms => { waits.push(ms); });
    expect(result.items).toHaveLength(60); expect(result.completed).toBe(true); expect(waits).toEqual(Array(61).fill(1000));
    expect(routes).toHaveLength(62); expect(new Set(routes)).toEqual(new Set(['/auto/products/list', '/auto/products/get']));
    expect(saved).not.toMatch(/PRIVATE|private-token|https:|contentsHtml|productTitle/);
  });
  it('stops and persists only a fixed code on API failure or user cancellation without retrying', async () => {
    const api = { request: vi.fn().mockRejectedValue(new ApiError('auth', 'PRIVATE-TOKEN')) } as unknown as ApiClient;
    let saved: ConversionAudit | undefined;
    await expect(auditConversions(api, 'secret', async value => { saved = structuredClone(value); }, () => {})).rejects.toHaveProperty('code', 'auth');
    expect(api.request).toHaveBeenCalledTimes(1); expect(saved).toEqual({ items: [], completed: false, failureCode: 'API_FAILED' });
    await expect(auditConversions(api, 'secret', async value => { saved = structuredClone(value); }, () => { throw Error('PRIVATE'); })).rejects.toThrow('PRIVATE');
    expect(api.request).toHaveBeenCalledTimes(1); expect(saved?.failureCode).toBe('AUDIT_STOPPED');
  });
  it('accepts only Goltou family HTTPS URLs and fails before fetching/writing any disallowed photo', async () => {
    for (const host of ['goltou.kr', 'api.goltou.kr', 'images.goltou.kr']) expect(goltouPhotoUrl(new URL(`https://${host}/image.png`))).toBe(true);
    const storage = { createWorkDirectory: vi.fn(), write: vi.fn(), removeWorkDirectory: vi.fn() }, fetcher = vi.fn();
    for (const url of ['https://goltou.kr.evil.test/a.png', 'https://evilgoltou.kr/a.png', 'https://other.test/a.png', 'http://api.goltou.kr/a.png', 'https://api.goltou.kr:8443/a.png']) {
      await expect(downloadPhotos([url], [url], { storage, fetcher, allowUrl: goltouPhotoUrl })).rejects.toThrow('PHOTO_HOST_NOT_ALLOWED');
    }
    expect(fetcher).not.toHaveBeenCalled(); expect(storage.createWorkDirectory).not.toHaveBeenCalled();
  });
  it.each([false, true])('keeps ordinary titles by default and the one-save limit only in the debug engine (%s)', async debug => {
    const result = await build({ entryPoints: ['apps/android/bridge/main.ts'], bundle: true, minifySyntax: true, platform: 'node', target: 'node18', format: 'cjs', write: false, external: ['bufferutil', 'utf-8-validate'], define: { __GOLTOU_API_ORIGIN__: JSON.stringify('https://local.invalid'), __GOLTOU_DEBUG__: String(debug) } });
    const source = result.outputFiles[0]!.text;
    expect(/draftSaveLimit:\s*1\b/.test(source)).toBe(debug);
    expect(/experimentTitle:\s*(?:!1|false)\b/.test(source)).toBe(debug);
    expect(/experimentTitle:\s*(?:!0|true)\b/.test(source)).toBe(false);
    expect(source.includes('runtime.experimentTitle = visibility !== "off"')).toBe(debug);
  });
  it('builds the actual release engine without fake API, seeded sessions, examples or debug audit code', async () => {
    const result = await build({ entryPoints: ['apps/android/bridge/main.ts'], bundle: true, minifySyntax: true, platform: 'node', target: 'node18', format: 'cjs', write: false, external: ['bufferutil', 'utf-8-validate'], define: { __GOLTOU_API_ORIGIN__: JSON.stringify('https://local.invalid'), __GOLTOU_DEBUG__: 'false' } });
    const source = result.outputFiles[0]!.text;
    expect(source).toContain('https://local.invalid');
    for (const marker of ['createFakeApi', 'fakeAccounts', 'verification-fixture', 'SYNTHETIC_PHOTO_REQUIRED', 'auditConversions', 'exampleArticle', 'class Experiments']) expect(source.includes(marker), marker).toBe(false);
    expect(source).toContain('AndroidTokenStore'); expect(source).toContain('session.device');
  });
});
