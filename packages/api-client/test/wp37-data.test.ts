import { expect, it } from 'vitest';
import { createApiClient, createFakeApi, fakeAccounts } from '../src';

it('exposes product owners, my changed flags and all users’ successful posts independently', async () => {
  const api = createFakeApi({ token: 'fixture', user: fakeAccounts.manager! });
  const list = await api.request('/auto/products/list', {}, 'fixture');
  expect(list.items.find(item => item.productNo === 1236)).toMatchObject({ ownerNickname: '골프매니저', changed: { blog: true, band: true } });
  expect(list.items.find(item => item.productNo === 1235)?.ownerNickname).toBeNull();
  const product = await api.request('/auto/products/get', { productNo: 1238 }, 'fixture');
  expect(product.posts).toEqual([expect.objectContaining({ channel: 'blog', status: 'published', nickname: '이직원', targetKey: '', changed: false })]);
  const old = createApiClient('https://example.invalid', async () => ({ ok: true, json: async () => ({ ok: true, data: { productNo: 5 } }) }));
  expect(await old.request('/auto/products/get', { productNo: 5 }, 'fixture')).toEqual({ productNo: 5 });
});
it('treats an older server’s HTTP 404 as an absent log route even without JSON', async () => {
  const client = createApiClient('https://example.invalid', async () => ({ ok: false, status: 404, json: async () => { throw Error('not JSON'); } }));
  await expect(client.request('/auto/posts/log', { postNo: 1, log: '' }, 'fixture')).rejects.toMatchObject({ code: 'not_found', network: false });
});
