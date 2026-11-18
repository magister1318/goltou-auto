import { describe, expect, it, vi } from 'vitest';
import { createApiClient, latest, type FetchLike } from '../src/index';
const release = { ready: true, version: '1.0.5 (9)', code: 9, date: '2026-11-20', size: 56124432,
  sha256: 'a'.repeat(64), url: 'auto_app/get/synthetic-download-token', expiresIn: 900 };
describe('optional app update endpoint', () => {
  it.each([{ ready: false }, release])('parses data and uses normal /auto auth: %j', async data => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data }) });
    const api = createApiClient('https://example.invalid', fetcher);
    expect(await latest(api, 'synthetic-auth')).toEqual(data);
    expect(fetcher).toHaveBeenCalledWith('https://example.invalid/auto/app/latest', expect.objectContaining({ body: '{}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-auth' }, credentials: 'omit', redirect: 'error' }));
  });
  it.each([
    async () => ({ ok: false, json: async () => ({ ok: false, code: 'not_found', message: 'unknown route synthetic-download-token' }) }),
    async () => ({ ok: false, json: async () => { throw new SyntaxError('HTML 404 synthetic-download-token'); } }),
    async () => { throw new Error('offline synthetic-download-token'); },
    async () => ({ ok: false, json: async () => ({ ok: false, code: 'auth', message: 'expired' }) }),
  ])('turns old server / transport errors into no update with safe log code', async fetcher => {
    const log = vi.fn();
    await expect(latest(createApiClient('https://example.invalid', fetcher), 'auth', log)).resolves.toEqual({ ready: false });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-download-token');
    expect(log.mock.calls[0]?.[0]).toMatch(/^UPDATE_CHECK_[A-Z_]+$/);
  });
  it.each([{ ...release, sha256: 'bad' }, { ...release, url: 'https://other.invalid/token' }, { ...release, code: '9' },
    { ...release, size: -1 }, { ...release, url: 'auto_app/get/token?secret=x' }, { ...release, version: '<bad>' }, null])('rejects malformed metadata: %j', async data => {
    const api = createApiClient('', async () => ({ ok: true, json: async () => ({ ok: true, data }) }));
    expect(await latest(api, 'auth')).toEqual({ ready: false });
  });
});
