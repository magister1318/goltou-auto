import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, createFakeApi, type ApiRoutes, type FetchLike } from '../src/index';
const login = { loginId: 'manager', password: 'demo', device: { kind: 'android', model: 'test', appVersion: '0.1.0' } };
describe('API envelope and credentials', () => {
  it('sends JSON POST, unwraps data, and never sends a bearer token to login', async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { token: 'demo', user: {} } }) });
    const api = createApiClient('https://example.invalid/', fetcher);
    expect(await api.request('/auto/login', login, 'old-token')).toHaveProperty('token', 'demo');
    expect(fetcher).toHaveBeenLastCalledWith('https://example.invalid/auto/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(login), signal: expect.any(AbortSignal), redirect: 'error', credentials: 'omit' });
  });
  it('passes the caller token to every protected path without retaining it', async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: {} }) });
    const api = createApiClient('', fetcher);
    const paths: Exclude<keyof ApiRoutes, '/auto/login'>[] = ['/auto/logout', '/auto/me', '/auto/products/list', '/auto/products/get', '/auto/posts/start', '/auto/posts/update', '/auto/posts/list', '/auto/settings/save'];
    for (const path of paths) {
      await api.request(path, {} as never, 'caller-token');
      expect(fetcher.mock.calls.at(-1)?.[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer caller-token' });
    }
    await expect(api.request('/auto/me', {})).rejects.toMatchObject({ code: 'auth' });
    expect(fetcher).toHaveBeenCalledTimes(paths.length);
  });
  it.each(['auth', 'forbidden', 'invalid', 'not_found', 'conflict', 'server'])('keeps the %s error code and Korean message', async code => {
    const api = createApiClient('', async () => ({ ok: false, json: async () => ({ ok: false, code, message: '사용자 안내' }) }));
    await expect(api.request('/auto/me', {}, 'x')).rejects.toMatchObject({ name: 'ApiError', code, message: '사용자 안내' });
  });
  it.each([null, {}, { ok: true }, { ok: false, code: 'unexpected' }])('normalizes malformed envelopes: %j', async envelope => {
    const api = createApiClient('', async () => ({ ok: true, json: async () => envelope }));
    await expect(api.request('/auto/me', {}, 'x')).rejects.toMatchObject({ code: 'server' });
  });
  it('normalizes network, JSON and HTTP failures into the same exception', async () => {
    for (const fetcher of [async () => { throw new Error('network'); }, async () => ({ ok: true, json: async () => { throw new Error('JSON'); } }), async () => ({ ok: false, json: async () => ({ ok: true, data: {} }) })]) {
      await expect(createApiClient('', fetcher).request('/auto/me', {}, 'x')).rejects.toBeInstanceOf(ApiError);
    }
  });
});
describe('memory API contract', () => {
  it('enforces the configured daily limit for the same person and band', async () => {
    const api = createFakeApi();
    const { token } = await api.request('/auto/login', { ...login, loginId: 'admin' });
    await api.request('/auto/settings/save', { closingText: '', defaultHashtags: [], bandDailyLimit: 1 }, token);
    const product = await api.request('/auto/products/get', { productNo: 1237 }, token);
    const post = { productNo: product.productNo, contentHash: product.contentHash, channel: 'band' as const, mode: 'draft' as const, target: { name: '시험 밴드', key: 'new-band' }, options: { polish: false, closing: false, linkCard: false } };
    await api.request('/auto/posts/start', post, token);
    await expect(api.request('/auto/posts/start', post, token)).rejects.toMatchObject({ code: 'conflict' });
    await expect(api.request('/auto/posts/start', { ...post, target: { name: '다른 밴드', key: 'other-band' } }, token)).resolves.toHaveProperty('postNo');
  });
  it('supports three roles, blocks ordinary members and revokes logout', async () => {
    const api = createFakeApi();
    for (const role of ['manager', 'staff', 'admin'] as const) {
      const { token, user } = await api.request('/auto/login', { ...login, loginId: role });
      expect(user.role).toBe(role); expect((await api.request('/auto/me', {}, token)).user).toEqual(user);
      if (role === 'manager') await expect(api.request('/auto/posts/list', { scope: 'all' }, token)).rejects.toMatchObject({ code: 'forbidden' });
      else expect((await api.request('/auto/posts/list', { scope: 'all' }, token)).total).toBe(7);
      const settings = { closingText: '문의', defaultHashtags: ['골투'], bandDailyLimit: 2 };
      if (role !== 'admin') await expect(api.request('/auto/settings/save', settings, token)).rejects.toMatchObject({ code: 'forbidden' });
      else { await api.request('/auto/settings/save', settings, token); expect((await api.request('/auto/me', {}, token)).settings).toEqual(settings); }
      await api.request('/auto/logout', {}, token); await expect(api.request('/auto/me', {}, token)).rejects.toMatchObject({ code: 'auth' });
    }
    for (const loginId of ['member', '0', '1', '2']) await expect(api.request('/auto/login', { ...login, loginId })).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('paginates and filters products, saves per-channel history and enforces ownership', async () => {
    const api = createFakeApi(); const { token } = await api.request('/auto/login', login);
    const list = await api.request('/auto/products/list', { pageSize: 8 }, token);
    expect(list.total).toBeGreaterThanOrEqual(12); expect(list.items).toHaveLength(8);
    expect((await api.request('/auto/products/list', { q: '다낭' }, token)).items[0]?.title).toContain('다낭');
    expect((await api.request('/auto/products/list', { month: '2027-01' }, token)).total).toBe(4);
    expect((await api.request('/auto/products/list', { onlyUnposted: true }, token)).total).toBe(list.total - 3);
    const product = await api.request('/auto/products/get', { productNo: 1237 }, token);
    const { postNo } = await api.request('/auto/posts/start', { productNo: product.productNo, contentHash: product.contentHash, channel: 'blog', mode: 'draft', target: { name: '해외골프', key: '' }, options: { polish: false, closing: false, linkCard: false } }, token);
    const update = { postNo, status: 'draft_saved' as const, step: 7, failReason: '', postUrl: '' };
    const staff = await api.request('/auto/login', { ...login, loginId: 'staff' });
    await expect(api.request('/auto/posts/update', update, staff.token)).rejects.toMatchObject({ code: 'forbidden' });
    await api.request('/auto/posts/update', update, token);
    await expect(api.request('/auto/posts/update', { ...update, status: 'running' }, token)).rejects.toMatchObject({ code: 'conflict' });
    expect((await api.request('/auto/products/list', { onlyUnposted: true }, token)).total).toBe(list.total - 4);
    expect((await api.request('/auto/posts/list', { scope: 'mine' }, token)).items.some(p => p.productChanged)).toBe(true);
  });
});
