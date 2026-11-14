import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createFakeApi, fakeAccounts, type ApiClient, type ApiRoutes, type PostUpdate, type Product } from '@goltou/api-client';
import type { SurfaceHost } from '@goltou/surface';
import { AppCore, MemoryTokenStore } from '../src/app';
import { ChannelRegistrationRunner } from '../src/band-runner';
import { BlogRegistrationRunner } from '../src/blog-runner';
import { makePreview } from '../src/preparation';
import type { AppRequest, JobInput } from '../src/protocol';
const site = vi.hoisted(() => ({ blog: { ensureReady: vi.fn(), write: vi.fn(), saveAndVerify: vi.fn(), publish: vi.fn(), dialog: vi.fn(async () => null), close: vi.fn(), show: vi.fn(), hide: vi.fn(), readbackTimings: [], publishedIdentitySources: ['result-url', 'title'], tableModes: [], linkCard: 'off', publishedPost: { postId: '9001', url: 'https://example.invalid/9001' } as { postId: string; url: string } | undefined } }));
vi.mock('../src/blog', async original => ({ ...await original<object>(), createBlogExecution: () => site.blog }));
const cleanup: (() => void)[] = [];
beforeEach(() => { vi.clearAllMocks(); site.blog.publishedPost = { postId: '9001', url: 'https://example.invalid/9001' }; site.blog.publish.mockResolvedValue('https://example.invalid/9001'); });
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
async function fixture(kind: 'blog' | 'channel', failStatus?: string, probe = false) {
  const product: Product = { productNo: 1, title: '[골투오토 실험] 합성 상품', contentsHtml: '<p>합성 안내</p>', images: [], departures: [], golfCourses: [], productUrl: 'https://example.invalid/product', contentHash: 'fixture', country: '', region: '', updatedAt: '' };
  const fake = createFakeApi({ token: 'synthetic', user: fakeAccounts.manager! });
  const updates: PostUpdate[] = []; let failure = failStatus;
  const api: ApiClient = { request: async <P extends keyof ApiRoutes>(path: P, value: ApiRoutes[P]['input'], token?: string): Promise<ApiRoutes[P]['output']> => {
    if (path === '/auto/products/get') return product as ApiRoutes[P]['output'];
    if (path === '/auto/posts/start') return { postNo: 91 } as ApiRoutes[P]['output'];
    if (path === '/auto/posts/update') { const update = value as PostUpdate; updates.push(structuredClone(update)); if (failure === update.status) throw new ApiError('server', '기록 저장 실패'); return {} as ApiRoutes[P]['output']; }
    return fake.request(path, value, token);
  } };
  const tokens = new MemoryTokenStore(); await tokens.write('synthetic');
  const host: SurfaceHost = { create: vi.fn(), destroy: vi.fn(), clearSession: vi.fn() };
  const preview = makePreview(product, {}), work = { preview, prepared: { preview, files: [] }, download: vi.fn(), arrange: vi.fn(), cleanup: vi.fn() };
  let runner!: ChannelRegistrationRunner | BlogRegistrationRunner;
  const app = new AppCore(api, tokens, (checkpoint, notify) => {
    const services = { host, publishEnabled: true, ...(probe ? { publishProbe: { visibility: 'private' as const, record: async () => {} } } : {}) };
    runner = kind === 'blog' ? new BlogRegistrationRunner(services, checkpoint, notify) : new ChannelRegistrationRunner({ band: { host }, blog: services }, checkpoint, notify);
    const start = runner.start.bind(runner); runner.start = (input, title, count) => start(input, title, count, work); return runner;
  });
  cleanup.push(() => app.dispose()); await app.restoreSession();
  const call = (command: AppRequest['command'], input: unknown = {}) => app.handle({ id: 1, type: 'app', command, input } as AppRequest);
  const input: JobInput = { productNo: 1, mode: 'publish', blogVisibility: 'private', publishConfirmed: true, targets: [{ channel: 'blog', key: 'local', name: '합성' }], options: { polish: false, closing: false, linkCard: false } };
  if (probe) site.blog.publish.mockRejectedValue(new Error('BLOG_PUBLISH_PROBE_BLOCKED'));
  if (failStatus === 'unconfirmed') { site.blog.publishedPost = undefined; site.blog.publish.mockRejectedValue(new Error('BLOG_PUBLISH_RESPONSE_UNCONFIRMED')); }
  await call('job.start', input);
  await vi.waitFor(() => expect(runner.job?.status).toBe(probe ? 'stopped' : failStatus === 'unconfirmed' ? 'failed' : failStatus === 'published' ? 'record_failed' : 'published'));
  return { app, runner, call, updates, repair: () => { failure = undefined; } };
}
describe('verified publish API recording', () => {
  it('records only confirmed cleanup on the original failed record, even without a response identity', async () => {
    const f = await fixture('channel', 'unconfirmed');
    const remove = vi.fn(async () => { throw new Error('BLOG_TEST_DELETE_REFUSED'); });
    await expect(f.app.cleanupTestPost(remove)).rejects.toThrow('BLOG_TEST_DELETE_REFUSED');
    expect(f.runner.job?.testPostDeleted).toBeUndefined();
    expect(f.updates.at(-1)?.failReason).toBe('BLOG_PUBLISH_RESPONSE_UNCONFIRMED');
    await f.app.cleanupTestPost(async () => {});
    expect(f.updates.at(-1)).toMatchObject({ postNo: 91, status: 'stopped', failReason: 'BLOG_TEST_POST_DELETED', postUrl: '' });
    expect(site.blog.publish).toHaveBeenCalledTimes(1);
  });
  it('records a blocked probe as stopped, with no published URL or completion claim', async () => {
    const f = await fixture('channel', undefined, true);
    expect(f.runner.job).toMatchObject({ publishProbe: true, status: 'stopped', targetResults: [{ status: 'stopped', reason: 'BLOG_PUBLISH_PROBE_BLOCKED' }] });
    expect(f.updates.some(update => update.status === 'published' || update.postUrl)).toBe(false);
    expect(f.updates.at(-1)).toMatchObject({ status: 'stopped', failReason: 'BLOG_PUBLISH_PROBE_BLOCKED', postUrl: '' });
    expect(site.blog.publish).toHaveBeenCalledTimes(1);
  });
  it.each(['blog', 'channel'] as const)('%s records published with the returned URL and retries only the identical API update', async kind => {
    const f = await fixture(kind, 'published');
    expect(f.runner.job?.blogVisibility).toBe('private');
    expect(f.runner.job?.blogIdentitySources).toEqual(['result-url', 'title']);
    expect(f.updates.filter(update => update.status === 'published')).toEqual([{ postNo: 91, status: 'published', step: 6, failReason: '', postUrl: 'https://example.invalid/9001' }]);
    expect(site.blog.publish).toHaveBeenCalledTimes(1);
    f.repair(); await f.call('job.retryRecord');
    expect(f.updates.filter(update => update.status === 'published')).toHaveLength(2);
    expect(site.blog.publish).toHaveBeenCalledTimes(1);
  });
  it('records confirmed test deletion as stopped on the same record and keeps record-only retry available', async () => {
    const f = await fixture('channel', 'stopped'); const remove = vi.fn(async () => {});
    await expect(f.app.cleanupTestPost(remove)).rejects.toThrow('기록 저장 실패');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(f.runner.job).toMatchObject({ status: 'record_failed', testPostDeleted: true });
    f.repair(); await f.call('job.retryRecord');
    expect(f.runner.job?.status).toBe('stopped');
    expect(f.updates.at(-1)).toMatchObject({ postNo: 91, status: 'stopped', failReason: 'BLOG_TEST_POST_DELETED', postUrl: '' });
    expect(remove).toHaveBeenCalledTimes(1); expect(site.blog.publish).toHaveBeenCalledTimes(1);
    await expect(f.app.cleanupTestPost(remove)).rejects.toMatchObject({ code: 'invalid' });
  });
});
