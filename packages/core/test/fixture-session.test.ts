import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createFakeApi, fakeAccounts, type ApiClient } from '@goltou/api-client';
import { AppCore, MemoryTokenStore } from '../src/app';

it('restores an explicitly seeded fake session without login or credentials; default remains anonymous', async () => {
  const token = randomUUID();
  const productTitle = '[골투오토 실험] 같은 예시 상품';
  const api = createFakeApi({ token, user: fakeAccounts.manager!, productTitle });
  const calls: string[] = [];
  const checked: ApiClient = { request: (route, input, value) => { calls.push(route); return api.request(route, input, value); } };
  const store = new MemoryTokenStore(); await store.write(token);
  const app = new AppCore(checked, store);
  try {
    await app.restoreSession();
    expect(app.snapshot().user?.role).toBe('manager');
    expect(calls).toEqual(['/auto/me']);
    expect((await api.request('/auto/products/get', { productNo: 1234 }, token)).title).toBe(productTitle);
    expect((await app.handle({ id: 1, type: 'app', command: 'products.list', input: {} }) as { total: number }).total).toBeGreaterThan(0);
    await expect(createFakeApi().request('/auto/me', {}, token)).rejects.toMatchObject({ code: 'auth' });
    const anonymous = new AppCore();
    await expect(anonymous.restoreSession()).rejects.toMatchObject({ code: 'auth' });
    expect(anonymous.snapshot().user).toBeNull(); anonymous.dispose();
  } finally { app.dispose(); }
});
