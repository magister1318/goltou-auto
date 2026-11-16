import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient, Post, PostUpdate } from '@goltou/api-client';
import type { SurfaceHost } from '@goltou/surface';
import { bandText, type RecordedBandReadback } from '../../sites/src/index';
import { makePreview } from '../src/preparation';
import { fixtureProduct } from './fixtures/catalog';
import { verifyInterruptedBandPublish, type BandPublishRecovery } from '../../../apps/android/bridge/band-publish-recovery';
const readPost = vi.hoisted(() => vi.fn());
vi.mock('../../sites/src/index', async original => ({ ...await original<object>(), readRecordedBandPost: readPost }));
beforeEach(() => readPost.mockReset());
function fixture() {
  const product = fixtureProduct('<p>합성 본문</p><img src="http://127.0.0.1:19004/photo-1.png"><img src="http://127.0.0.1:19004/photo-2.png">', 2);
  const preview = makePreview(product, { closing: false, linkCard: false, hashtags: ['합성'] });
  const context: BandPublishRecovery = { postNo: 1, productNo: product.productNo, startedAt: 'synthetic', title: product.title,
    url: 'https://band.us/band/111/post/9001', contentHash: product.contentHash, submittedAt: 1700000000000,
    uploadedPhotos: ['https://example.invalid/upload/one.jpg', 'https://example.invalid/upload/two.jpg'] };
  let record: Post = { postNo: 1, productNo: product.productNo, startedAt: context.startedAt, productTitle: context.title, channel: 'band', mode: 'publish', targetName: '합성',
    status: 'failed', step: 6, failReason: 'BAND_POST_UNCONFIRMED', postUrl: '', userName: '합성', finishedAt: '', productChanged: false };
  const actual: RecordedBandReadback = { url: context.url, body: bandText(preview.band), createdAt: context.submittedAt, owned: true,
    photos: [{ path: '/upload/one.jpg', width: 100, height: 80 }] };
  readPost.mockResolvedValue(actual);
  const updates: PostUpdate[] = [];
  let lists = 0, race = false;
  const api = { request: async (route: string, value: unknown) => {
    if (route === '/auto/posts/list') { if (++lists === 2 && race) record = { ...record, postUrl: 'https://band.us/band/111/post/9002' }; return { total: 1, items: [record] }; }
    if (route === '/auto/products/get') return product;
    if (route === '/auto/me') return { settings: { defaultHashtags: ['합성'] } };
    if (route === '/auto/posts/update') { updates.push(value as PostUpdate); record = { ...record, ...value as PostUpdate }; return {}; }
    throw Error('UNEXPECTED_API');
  } } as ApiClient;
  return { context, actual, updates, setRecord: (x: Partial<Post>) => { record = { ...record, ...x }; }, race: () => { race = true; },
    run: () => verifyInterruptedBandPublish(context, api, 'synthetic-token', {} as SurfaceHost, async () => {}) };
}
describe('interrupted Band receipt recovery without a submit path', () => {
  it('stores only the original owned record and labels feed photos as a partial prefix', async () => {
    const f = fixture();
    expect(await f.run()).toEqual({ verified: true, recorded: true, feedPhotos: 1, plannedPhotos: 2, feedPhotosPartial: true });
    expect(f.updates).toEqual([{ postNo: 1, status: 'published', step: 7, failReason: 'BAND_PUBLISHED_FEED_PHOTOS_PARTIAL', postUrl: f.context.url }]);
    expect(readPost).toHaveBeenCalledOnce();
  });
  it.each(['owner', 'body', 'time', 'photo', 'url', 'hash', 'record', 'race'])('refuses changed %s evidence without updating any record', async mode => {
    const f = fixture();
    if (mode === 'owner') f.actual.owned = false;
    if (mode === 'body') f.actual.body += '다른 내용';
    if (mode === 'time') f.actual.createdAt += 6000;
    if (mode === 'photo') f.actual.photos[0]!.path = '/other.jpg';
    if (mode === 'url') f.actual.url = 'https://band.us/band/111/post/9002';
    if (mode === 'hash') f.context.contentHash = 'changed';
    if (mode === 'record') f.setRecord({ postNo: 2 });
    if (mode === 'race') f.race();
    await expect(f.run()).rejects.toThrow('BAND_PUBLISH_RECOVERY_REFUSED');
    expect(f.updates).toEqual([]);
  });
});
