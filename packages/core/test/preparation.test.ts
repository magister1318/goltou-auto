import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRegistrationRunner } from '../src/runner';
import { makePreview, preparationWork, type PreparationWork } from '../src/preparation';
import { AppCore } from '../src/app';
import type { AppRequest, JobInput } from '../src/protocol';
import type { MediaStorage } from '../src/media';
import { createFakeApi, type ApiClient } from '@goltou/api-client';
import { fixtureProduct } from './fixtures/catalog';

beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
const input: JobInput = { productNo: 4, mode: 'draft', targets: [{ channel: 'blog', name: '예시', key: 'sample' }], options: { polish: false, closing: false, linkCard: false } };
describe('WP4 real preparation before simulated sites', () => {
  it('downloads, arranges and cleans exactly once in stages 2/3 before sites run', async () => {
    const product = fixtureProduct('<p>원문 안내입니다.</p>', 2), preview = makePreview(product, {});
    const order: string[] = [];
    const storage: MediaStorage = { createWorkDirectory: async () => 'owned', write: async (_, name) => { order.push(`write:${name}`); return `/owned/${name}`; }, removeWorkDirectory: async () => { order.push('cleanup'); } };
    const work = preparationWork(product, preview, { media: { storage, fetcher: async url => { order.push(`download:${url}`); return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }; } } });
    const arrange = vi.spyOn(work, 'arrange');
    const runner = new FakeRegistrationRunner(() => ({ tickMs: 10, loginAt: null, failAt: null }), async () => {}, job => { if (job.step === 4) expect(order.filter(s => s.startsWith('write:'))).toHaveLength(2); });
    await runner.start(input, product.title, 2, work); await vi.advanceTimersByTimeAsync(600);
    expect(runner.job?.status).toBe('draft_saved'); expect(arrange).toHaveBeenCalledTimes(1); expect(order.filter(v => v === 'cleanup')).toHaveLength(1); runner.dispose();
  });
  it('stops before site steps on failed download and supports a fresh preparation retry', async () => {
    let first = true;
    const work: PreparationWork = { download: vi.fn(async () => { if (first) { first = false; throw new Error('PHOTO_DOWNLOAD_FAILED'); } }), arrange: vi.fn(async () => {}), cleanup: vi.fn(async () => {}) };
    const runner = new FakeRegistrationRunner(() => ({ tickMs: 10, loginAt: null, failAt: null }), async () => {}, () => {});
    await runner.start(input, '예시', 1, work); await vi.advanceTimersByTimeAsync(100);
    expect(runner.job).toMatchObject({ status: 'failed', step: 2, completedSteps: [1] }); expect(work.arrange).not.toHaveBeenCalled();
    await runner.resume(); await vi.advanceTimersByTimeAsync(500);
    expect(work.download).toHaveBeenCalledTimes(2); expect(runner.job?.status).toBe('draft_saved'); runner.dispose();
  });
  it('cancels an in-flight download before resuming it, without racing another preparation', async () => {
    let first = true;
    const work: PreparationWork = {
      download: vi.fn(async signal => {
        if (!first) return;
        first = false;
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true }));
      }), arrange: vi.fn(async () => {}), cleanup: vi.fn(async () => {}),
    };
    const runner = new FakeRegistrationRunner(() => ({ tickMs: 10, loginAt: null, failAt: null }), async () => {}, () => {});
    await runner.start(input, '예시', 1, work); await vi.advanceTimersByTimeAsync(30);
    expect(runner.job?.step).toBe(2); await runner.stop(); expect(runner.job).toMatchObject({ status: 'user_paused', step: 2, current: 0 });
    await runner.resume(); await vi.advanceTimersByTimeAsync(500);
    expect(work.download).toHaveBeenCalledTimes(2); expect(work.arrange).toHaveBeenCalledTimes(1); expect(runner.job?.status).toBe('draft_saved'); runner.dispose();
  });
  it('records a failed outcome when temporary photo cleanup fails', async () => {
    const checkpoint = vi.fn(async () => {});
    const work: PreparationWork = { download: async () => {}, arrange: async () => {}, cleanup: async () => { throw new Error('DISK_ERROR'); } };
    const runner = new FakeRegistrationRunner(() => ({ tickMs: 10, loginAt: null, failAt: null }), checkpoint, () => {});
    await runner.start(input, '예시', 0, work); await vi.advanceTimersByTimeAsync(500);
    expect(runner.job).toMatchObject({ status: 'failed', message: 'PHOTO_CLEANUP_FAILED' }); runner.dispose();
  });
  it('blocks changed API image order at the core boundary before any post record', async () => {
    const fake = createFakeApi(), product = fixtureProduct('<img src="http://127.0.0.1:19004/photo-2.png"><p>소개</p><img src="http://127.0.0.1:19004/photo-1.png">', 2);
    const posts = vi.fn();
    const api: ApiClient = { async request(route, value, token) {
      if (route === '/auto/products/get') return product as never;
      if (route === '/auto/posts/start') posts();
      return fake.request(route, value, token);
    } };
    const app = new AppCore(api); const call = (command: AppRequest['command'], value: unknown) => app.handle({ id: 1, type: 'app', command, input: value } as AppRequest);
    await call('login', { loginId: 'manager', password: 'demo', device: { kind: 'test', model: 'synthetic', appVersion: '0' } });
    const preview = await call('preview.prepare', { productNo: 4, options: input.options }) as ReturnType<typeof makePreview>;
    expect(preview.verification.blog.matches).toBe(false);
    await expect(call('job.start', input)).rejects.toMatchObject({ code: 'invalid' }); expect(posts).not.toHaveBeenCalled(); app.dispose();
  });
  it('retains a reviewed paragraph revert when only optional assembly settings change', async () => {
    const fake = createFakeApi(), product = fixtureProduct('<p>예시CC에서 조용히 쉬어 갑니다.</p>', 0);
    const api: ApiClient = { async request(route, value, token) { return route === '/auto/products/get' ? product as never : fake.request(route, value, token); } };
    const polish = vi.fn(async () => '1. 예시CC에서 조용히 쉬어갑니다.');
    const app = new AppCore(api, undefined, undefined, { polish, media: { storage: { createWorkDirectory: async () => 'owned', write: async () => 'file', removeWorkDirectory: async () => {} } } });
    const call = (command: AppRequest['command'], value: unknown) => app.handle({ id: 1, type: 'app', command, input: value } as AppRequest);
    await call('login', { loginId: 'manager', password: 'demo', device: { kind: 'test', model: 'synthetic', appVersion: '0' } });
    const options = { ...input.options, polish: true };
    await call('preview.prepare', { productNo: 4, options });
    await call('preview.revert', { productNo: 4, paragraphId: 'p1' });
    const next = await call('preview.prepare', { productNo: 4, options: { ...options, linkCard: true } }) as ReturnType<typeof makePreview>;
    expect(next.polish?.paragraphs[0]?.reverted).toBe(true); expect(polish).toHaveBeenCalledTimes(1);
    expect(next.blog.steps.some(s => s.kind === 'text' && s.text === '예시CC에서 조용히 쉬어 갑니다.')).toBe(true);
    await expect(call('job.start', { ...input, options, previewHash: 'changed-source' })).rejects.toMatchObject({ code: 'invalid' }); app.dispose();
  });
});
