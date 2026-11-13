import { describe, expect, it, vi } from 'vitest';
import { createFakeApi, type ApiClient } from '@goltou/api-client';
import { AppCore } from '../src/app';
import type { AppRequest } from '../src/protocol';
import type { PreparedPreview, PreparationServices } from '../src/preparation';
import { fixtureProduct } from './fixtures/catalog';

function preparation(): PreparationServices {
  return { ai: { show: vi.fn(async () => {}), hide: vi.fn(async () => {}), clear: vi.fn(async () => {}) }, media: { storage: { createWorkDirectory: async () => '', write: async () => '', removeWorkDirectory: async () => {} } } };
}
describe('AI surface and explicit retry', () => {
  it('opens the isolated owner surface without Goltou credentials and never claims authentication from a button click', async () => {
    const api: ApiClient = { request: vi.fn(async () => { throw Error('NO_API'); }) };
    const services = preparation(), app = new AppCore(api, undefined, undefined, services);
    const call = (command: AppRequest['command'], input = {}) => app.handle({ id: 1, type: 'app', command, input } as AppRequest);
    try {
      await call('service.show', { service: 'ai' }); expect(services.ai!.show).toHaveBeenCalledOnce();
      expect(app.snapshot().visibleService).toBe('ai');
      await call('service.check', { service: 'ai' }); expect(app.snapshot().services.ai).toBe('unknown');
      await call('service.hide'); expect(services.ai!.hide).toHaveBeenCalledOnce();
      expect(app.snapshot().visibleService).toBeNull();
      await call('service.clear', { service: 'ai' }); expect(services.ai!.clear).toHaveBeenCalledOnce();
      expect(api.request).not.toHaveBeenCalled();
    } finally { app.dispose(); }
  });
  it('reuses reviewed results until explicit retry, locks owner controls during polishing, and never starts a post', async () => {
    const fake = createFakeApi(), product = fixtureProduct('<p>소개 문장을 다듬습니다.</p>', 0), calls: string[] = [];
    const api: ApiClient = { async request(route, input, token) { calls.push(route); return route === '/auto/products/get' ? product as never : fake.request(route, input, token); } };
    const services = preparation(); let finish: (() => void) | undefined;
    const polish = vi.fn(async () => { if (polish.mock.calls.length === 1) await new Promise<void>(resolve => { finish = resolve; }); return '1. 소개 문장을 다듬습니다.'; });
    services.polish = polish;
    const app = new AppCore(api, undefined, undefined, services);
    const call = (command: AppRequest['command'], input = {}) => app.handle({ id: 1, type: 'app', command, input } as AppRequest);
    try {
      await call('login', { loginId: 'manager', password: 'demo', device: { kind: 'test', model: 'synthetic', appVersion: '0' } });
      const input = { productNo: product.productNo, options: { polish: true, closing: false, linkCard: false } };
      const first = call('preview.prepare', input);
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      await expect(call('service.show', { service: 'ai' })).rejects.toMatchObject({ code: 'conflict' });
      await expect(call('preview.prepare', input)).rejects.toMatchObject({ code: 'conflict' });
      finish!(); await first;
      await call('preview.revert', { productNo: product.productNo, paragraphId: 'p1' });
      const reused = await call('preview.prepare', input) as PreparedPreview;
      expect(reused.polish?.paragraphs[0]?.reverted).toBe(true); expect(polish).toHaveBeenCalledOnce();
      const retried = await call('preview.prepare', { ...input, retryPolish: true }) as PreparedPreview;
      expect(polish).toHaveBeenCalledTimes(2); expect(retried.polish?.paragraphs[0]?.reverted).toBe(false);
      expect(calls).not.toContain('/auto/posts/start'); expect(app.snapshot().job).toBeNull();
    } finally { finish?.(); app.dispose(); }
  });
});
