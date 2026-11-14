import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { ApiError, createApiClient, createFakeApi, fakeAccounts, type ApiClient, type ApiRoutes, type Product } from '@goltou/api-client';
import type { SurfaceHost } from '@goltou/surface';
import { AppCore, MemoryTokenStore } from '../src/app';
import { ChannelRegistrationRunner } from '../src/band-runner';
import { BlogRegistrationRunner } from '../src/blog-runner';
import { makePreview } from '../src/preparation';
import { RecordError } from '../src/record-checkpoint';
import type { AppRequest, Job, JobInput } from '../src/protocol';

const site = vi.hoisted(() => ({
  band: { write: vi.fn(), observe: vi.fn(async () => ({})), stopBeforePost: vi.fn(), detectPublished: vi.fn(async () => null), publish: vi.fn(async () => 'http://127.0.0.1/band/111/post/1001'), dialog: vi.fn(async () => null), show: vi.fn(), hide: vi.fn(), discard: vi.fn() },
  blog: { ensureReady: vi.fn(), write: vi.fn(), saveAndVerify: vi.fn(), publish: vi.fn(), dialog: vi.fn(async () => null), show: vi.fn(), hide: vi.fn(), close: vi.fn(), readbackTimings: [], publishedIdentitySources: [], tableModes: [], linkCard: 'off' },
}));
vi.mock('../src/band', async original => ({ ...await original<object>(), createBandExecution: () => site.band }));
vi.mock('../src/blog', async original => ({ ...await original<object>(), createBlogExecution: () => site.blog }));
const cleanup: (() => Promise<void> | void)[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const token = 'synthetic-private-token';
const product: Product = { productNo: 77, title: '비공개 상품제목', contentsHtml: '<p>비공개 상품본문</p>', images: [], departures: [], golfCourses: [], productUrl: 'https://example.invalid/private', contentHash: 'fixture', country: '', region: '', updatedAt: '' };
const host: SurfaceHost = { create: vi.fn(), destroy: vi.fn(), clearSession: vi.fn() };
type Kind = 'band' | 'channel-blog' | 'blog';
async function fixture(kind: Kind, transport: 'fake' | 'http', failure: 'invalid' | 'network') {
  const channel = kind === 'band' ? 'band' : 'blog';
  const input: JobInput = { productNo: 77, mode: channel === 'band' ? 'publish' : 'draft', publishConfirmed: channel === 'band', targets: [{ channel, name: '로컬', key: '111' }], options: { polish: false, closing: false, linkCard: false } };
  const states: Job[] = [], calls: { route: string; input: unknown }[] = [];
  let failed = true, apiMessage = '등록 상태를 확인해 주세요.';
  const fake = createFakeApi({ token, user: fakeAccounts.manager! });
  const route: ApiClient['request'] = async <P extends keyof ApiRoutes>(path: P, value: ApiRoutes[P]['input'], bearer?: string): Promise<ApiRoutes[P]['output']> => {
    calls.push({ route: path, input: structuredClone(value) });
    if (path === '/auto/products/get') return product as ApiRoutes[P]['output'];
    if (path === '/auto/posts/start') return { postNo: 91 } as ApiRoutes[P]['output'];
    if (path === '/auto/posts/update') {
      const update = value as ApiRoutes['/auto/posts/update']['input'];
      if (failed && update.status === (channel === 'band' ? 'published' : 'draft_saved')) {
        if (failure === 'invalid') throw new ApiError('invalid', apiMessage);
        throw new Error(`private transport ${token} ${product.title}`);
      }
      return {} as ApiRoutes[P]['output'];
    }
    return fake.request(path, value, bearer);
  };
  let api: ApiClient = { request: route };
  if (transport === 'http') {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += String(chunk); });
      req.on('end', () => {
        void route(req.url as keyof ApiRoutes, JSON.parse(body), token).then(data => {
          res.writeHead(200).end(JSON.stringify({ ok: true, data }));
        }).catch(error => {
          if (error instanceof ApiError) res.writeHead(400).end(JSON.stringify({ ok: false, code: error.code, message: error.message }));
          else req.socket.destroy();
        });
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
    api = createApiClient(`http://127.0.0.1:${(server.address() as { port: number }).port}`, fetch);
  }
  const tokens = new MemoryTokenStore(); await tokens.write(token);
  const preview = makePreview(product, {});
  const work = { preview, prepared: { preview, files: [] }, download: vi.fn(async () => {}), arrange: vi.fn(async () => {}), cleanup: vi.fn(async () => {}) };
  const recordFailure = vi.fn(async () => {});
  let runner!: ChannelRegistrationRunner | BlogRegistrationRunner;
  const app = new AppCore(api, tokens, (checkpoint, notify) => {
    const services = { host, localPublish: true, editorUrl: 'http://127.0.0.1/blog', recordFailure };
    runner = kind === 'blog' ? new BlogRegistrationRunner(services, checkpoint, notify)
      : new ChannelRegistrationRunner({ band: { host, baseUrl: 'http://127.0.0.1', localPublish: true }, blog: services }, checkpoint, notify);
    if (runner instanceof ChannelRegistrationRunner) runner.directory.choices = [{ key: '111', name: '로컬', photoLimit: null, observedAt: null }];
    const start = runner.start.bind(runner);
    runner.start = (input, title, photos) => start(input, title, photos, work);
    return runner;
  });
  cleanup.push(() => app.dispose());
  app.subscribe(state => { if (state.job) states.push(state.job); });
  await app.restoreSession();
  const call = (command: AppRequest['command'], value: unknown = {}) => app.handle({ id: 1, type: 'app', command, input: value } as AppRequest);
  await call('job.start', input);
  await vi.waitFor(() => expect(runner.job?.status).toBe('record_failed'));
  const updates = () => calls.filter(c => c.route === '/auto/posts/update');
  return { app, runner, call, updates, states, work, recordFailure, input, calls, repair: () => { failed = false; }, message: (value: string) => { apiMessage = value; } };
}

describe('record failures preserve site outcomes and require a record-only retry', () => {
  for (const kind of ['band', 'channel-blog', 'blog'] as const) for (const transport of ['fake', 'http'] as const) it.each(['invalid', 'network'] as const)(`${kind}/${transport}: %s`, async failure => {
    const f = await fixture(kind, transport, failure);
    const code = `RECORD_FAILED:${failure === 'invalid' ? 'invalid' : 'server'}`;
    const outcome = kind === 'band' ? 'published' : 'draft_saved';
    expect(f.runner.job).toMatchObject({ status: 'record_failed', failureCode: code, targetResults: [{ status: outcome }], message: '기록하지 못함' });
    if (failure === 'invalid') expect(f.runner.job?.recordFailure?.message).toBe('등록 상태를 확인해 주세요.');
    else expect(f.runner.job?.recordFailure?.message).toMatch(/연결/);
    expect(f.recordFailure).not.toHaveBeenCalled();
    const diagnostics = JSON.stringify({ code: f.runner.job?.failureCode, record: f.runner.job?.recordFailure, message: f.runner.job?.message });
    expect(diagnostics).not.toMatch(/비공개|synthetic|private transport/);
    const before = structuredClone(f.updates());
    await f.call('session.get'); await f.call('job.stop');
    await expect(f.call('job.resume')).rejects.toMatchObject({ code: 'conflict' });
    await expect(f.call('job.start', f.input)).rejects.toMatchObject({ code: 'conflict' });
    expect(f.updates()).toEqual(before);
    if (kind === 'band') { await expect(f.call('band.show', { key: '111' })).rejects.toMatchObject({ code: 'invalid' }); expect(site.band.show).not.toHaveBeenCalled(); }
    // Another failed explicit attempt sends one identical update and stays pending.
    await f.call('job.retryRecord');
    expect(f.updates().slice(before.length)).toEqual([before.at(-1)]);
    expect(f.runner.job?.status).toBe('record_failed');
    f.repair();
    await f.call('job.retryRecord');
    expect(f.updates().slice(before.length)).toEqual([before.at(-1), before.at(-1)]);
    expect(f.runner.job?.targetResults?.[0]?.status).toBe(outcome);
    expect(f.runner.job?.recordFailure).toBeUndefined();
    expect(f.runner.job?.failureCode).toBeUndefined();
    expect(f.runner.job?.status).toBe('user_paused');
    await expect(f.call('job.retryRecord')).rejects.toMatchObject({ code: 'conflict' });
    expect(f.calls.filter(c => c.route === '/auto/posts/start')).toHaveLength(1);
    expect(f.work.download).toHaveBeenCalledTimes(1);
    expect(f.work.arrange).toHaveBeenCalledTimes(1);
    expect(kind === 'band' ? site.band.write : site.blog.write).toHaveBeenCalledTimes(1);
    if (kind !== 'band') expect(site.blog.saveAndVerify).toHaveBeenCalledTimes(1);
    expect(site.band.publish).toHaveBeenCalledTimes(kind === 'band' ? 1 : 0); expect(site.blog.publish).not.toHaveBeenCalled();
  });
  it.each(['invalid', 'network'] as const)('never discards an already published Band post when its %s record failed', async failure => {
    const f = await fixture('band', 'http', failure);
    const before = structuredClone(f.updates());
    await expect(f.call('band.discard')).rejects.toMatchObject({ code: 'conflict' });
    expect(site.band.discard).not.toHaveBeenCalled();
    expect(f.runner.job?.targetResults?.[0]?.status).toBe('published');
    expect(f.updates()).toEqual(before);
    f.repair(); await f.call('job.retryRecord');
    expect(site.band.publish).toHaveBeenCalledTimes(1);
  });
  it('rejects concurrent retry clicks without issuing another update', async () => {
    const f = await fixture('band', 'http', 'invalid'); f.repair();
    const before = f.updates().length;
    const results = await Promise.allSettled([f.call('job.retryRecord'), f.call('job.retryRecord')]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(f.updates()).toHaveLength(before + 1);
  });
  it.each(['비공개 상품제목 상태 오류', '비공개 상품본문 오류', `요청 오류 ${token}`])('redacts echoed API payload: %s', async message => {
    const f = await fixture('band', 'http', 'invalid'); f.message(message);
    await f.call('job.retryRecord');
    expect(f.runner.job?.recordFailure?.message).toBe('기록을 저장하지 못했습니다. 연결과 등록 기록을 확인해 주세요.');
    expect(f.runner.job?.failureCode).toBe('RECORD_FAILED:invalid');
  });
  it('never exposes an arbitrary exception as a diagnostic', () => {
    const error = new RecordError(new Error(`private ${token}`));
    expect(error.code).toBe('RECORD_FAILED:server'); expect(error.message).not.toContain(token);
  });
});
