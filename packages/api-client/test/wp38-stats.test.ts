import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, createFakeApi } from '../src';

describe('today statistics', () => {
  it.each([404, 405])('treats a legacy HTTP %s response as a missing route before decoding it', async status => {
    const api = createApiClient('https://example.invalid', async () => ({
      ok: false, status, json: async () => { throw Error('not JSON'); },
    }));
    await expect(api.request('/auto/stats/today', {}, 'fixture')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('returns per-user fixture counts to admins only', async () => {
    const api = createFakeApi();
    const login = (loginId: string) => api.request('/auto/login', { loginId, password: 'demo', device: { kind: 'test', model: 'fixture', appVersion: '1.0.5' } });
    const { token: manager } = await login('manager');
    const { token: admin } = await login('admin');
    await expect(api.request('/auto/stats/today', {}, manager)).rejects.toMatchObject({ code: 'forbidden' });
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    const product = await api.request('/auto/products/get', { productNo: 1234 }, manager);
    for (const status of ['draft_saved', 'published', 'failed', 'stopped'] as const) {
      const { postNo } = await api.request('/auto/posts/start', {
        productNo: product.productNo, contentHash: product.contentHash, channel: 'blog', mode: status === 'draft_saved' ? 'draft' : 'publish',
        target: { key: 'blog', name: '블로그' }, options: { polish: false, closing: false, linkCard: false },
      }, manager);
      await api.request('/auto/posts/update', { postNo, status, step: 7, failReason: '', postUrl: '' }, manager);
    }
    expect(await api.request('/auto/stats/today', {}, admin)).toMatchObject({
      date: today, rows: expect.arrayContaining([{ userNo: 12, nickname: '골프매니저', published: 1, drafts: 1, failed: 1, stopped: 1, lastAt: `${today}T12:00:00+09:00` }]),
    });
    await expect(api.request('/auto/stats/today', {}, 'no-session')).rejects.toBeInstanceOf(ApiError);
  });
});
