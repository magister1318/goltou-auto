import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApiClient, Post, Product } from '@goltou/api-client';
import type { SurfaceHost } from '@goltou/surface';
import { configureTrace } from '@goltou/surface/telemetry';
import { JobLogStore } from '../src/job-logs';
import { makePreview } from '../src/preparation';
import { bandText } from '@goltou/sites';
import { linkUncertainBandForDeletion } from '../../../apps/android/bridge/band-delete-recovery';
import { canDeletePost } from '../src/post-delete-policy';
const readPost = vi.hoisted(() => vi.fn());
vi.mock('@goltou/sites', async original => ({ ...await original<object>(), readRecordedBandPost: readPost }));
const dirs: string[] = [];
afterEach(() => { configureTrace(undefined); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(change = '') {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'band-cleanup-receipt-')); dirs.push(directory);
  const logs = new JobLogStore(directory); configureTrace(logs);
  const now = Date.now();
  const product: Product = { productNo: 1, title: '합성 제목', country: '', region: '', updatedAt: '', contentHash: 'synthetic-hash', contentsHtml: '<p>합성 본문</p>', images: [], departures: [], golfCourses: [], productUrl: 'https://example.invalid/product' };
  let post: Post = { postNo: 1, productNo: 1, productTitle: product.title, channel: 'band', mode: 'publish', status: 'failed', failReason: 'BAND_POST_UNCONFIRMED', postUrl: '', targetName: '합성', step: 6, userName: '', startedAt: new Date(now - 1000).toISOString(), finishedAt: new Date(now + 1000).toISOString(), productChanged: false };
  const receipt = logs.begin('band_post', 'band');
  logs.run(receipt, () => logs.associate('1'));
  if (change !== 'no-create') receipt.line('barrier', 'ok', { reason: 'CREATE_ALLOWED' });
  if (change === 'duplicate') receipt.line('barrier', 'ok', { reason: 'CREATE_ALLOWED' });
  receipt.line('barrier', 'ok', { reason: 'BAND_PUBLISH_RESPONSE_OK' }); receipt.end('uncertain', 'BAND_POST_UNCONFIRMED');
  const url = 'https://band.us/band/111/post/9001';
  readPost.mockResolvedValue({ url, owned: change !== 'foreign-owner', body: bandText(makePreview(product, {}).band) + (change === 'body' ? '변경' : ''), createdAt: now + (change === 'time' ? 100000 : 0), photos: [] });
  const updates: unknown[] = [];
  const api = { request: async (route: string, input: unknown) => {
    if (route === '/auto/posts/list') return { items: [post], total: 1 };
    if (route === '/auto/products/get') return change === 'changed' ? { ...product, contentHash: 'changed' } : product;
    if (route === '/auto/me') return { settings: { defaultHashtags: [] } };
    if (route === '/auto/posts/update') { updates.push(input); post = { ...post, ...input as object }; return {}; }
    throw Error('UNEXPECTED_ROUTE');
  } } as ApiClient;
  const context = { postNo: 1, productNo: 1, startedAt: post.startedAt, contentHash: product.contentHash, url };
  return { run: () => linkUncertainBandForDeletion(context, api, 'synthetic-session', {} as SurfaceHost, logs, async () => {}), logs, updates, post: () => post };
}
describe('receipt-only repair preserves uncertain publication and enables safe cleanup', () => {
  it('links only an acknowledged app-created identity without claiming publication or submitting', async () => {
    const f = fixture(); expect(await f.run()).toMatchObject({ publicationVerified: false, cleanupAvailable: true });
    expect(f.updates).toHaveLength(1); expect(f.post()).toMatchObject({ status: 'failed', failReason: 'BAND_POST_UNCONFIRMED' });
    expect(canDeletePost(f.post(), 'mine')).toBe(true); expect(canDeletePost(f.post(), 'all')).toBe(false);
    expect(f.logs.list()[0]).toMatchObject({ result: 'uncertain', reason: 'BAND_POST_UNCONFIRMED' });
  });
  it.each(['no-create', 'duplicate', 'foreign-owner', 'body', 'time', 'changed'])('refuses %s without changing a record', async change => {
    const f = fixture(change); await expect(f.run()).rejects.toThrow('BAND_CLEANUP_RECEIPT_REFUSED'); expect(f.updates).toHaveLength(0);
  });
});
