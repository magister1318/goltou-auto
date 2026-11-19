import { describe, expect, it } from 'vitest';
import { bandBodyHash, bandCreateIdentity, matchesBandCreation } from '../src/band/publish-confirmation';
import type { RecordedBandReadback } from '../src/band/record-read';
import type { Surface, SurfaceHost, GuardedRequest, GuardedResponse } from '@goltou/surface';
import { BandDirectory } from '../src/band/plan';
import { bandPhotoEvidence } from '../src/band/photo-path';

describe('Band create receipt and independent identity match', () => {
  // Values are synthetic. The saved create observation proves result_code=1
  // and no post_key; it did not retain the other result_data field names.
  it.each([{ post_key: '9001' }, { post_no: 9001 }, { post: { post_no: '9001', band: { band_no: 111 } } }])('recognizes explicit response identity %j', result_data => {
    expect(bandCreateIdentity(JSON.stringify({ result_code: 1, result_data }), '111')).toEqual({ succeeded: true, post: '9001' });
  });
  it.each([{}, { post_key: 9001, post_no: 9002 }, { post_no: 9001, band_no: 222 }, { post_no: true }, { post_no: Number.MAX_SAFE_INTEGER + 1 }, { other_id: 9001 }])('requires a feed read for missing/ambiguous identity %j', result_data => {
    expect(bandCreateIdentity(JSON.stringify({ result_code: 1, result_data }), '111')).toEqual({ succeeded: true });
  });
  it('does not mistake service rejection for success', () => expect(bandCreateIdentity('{"result_code":0,"result_data":{"post_no":9001}}', '111')).toEqual({ succeeded: false }));
  it.each([false, true])('observes the primary identity independently of feed order (feed first=%s)', async feedFirst => {
    let inspect!: (r: GuardedRequest) => boolean | Promise<boolean>, response!: (r: GuardedResponse) => void;
    const surface = { guardRequests: async (_rules: unknown, i: typeof inspect, r: typeof response) => { inspect = i; response = r; } } as Surface;
    const directory = new BandDirectory({ create: async () => surface, destroy: async () => {}, clearSession: async () => {} } as SurfaceHost);
    await directory.getSurface();
    const receipts: string[] = []; directory.arm('111', url => { receipts.push(url); });
    expect(await inspect({ method: 'POST', url: 'https://api-kr.band.us/v2.0.2/create_post', postDataComplete: true, contentType: 'application/x-www-form-urlencoded', postData: 'band_no=111' })).toBe(true);
    const readFeed = () => response({ method: 'GET', url: 'https://api-kr.band.us/v2.0.0/get_posts_and_announcements?band_no=111', status: 200, body: '{"result_code":1,"result_data":{"items":[]}}' });
    if (feedFirst) readFeed();
    response({ method: 'POST', url: 'https://api-kr.band.us/v2.0.2/create_post', status: 200, body: '{"result_code":1,"result_data":{"post_no":9001}}' });
    if (!feedFirst) readFeed();
    expect(receipts).toEqual(['https://band.us/band/111/post/9001']);
    expect(directory.createdReceipt('111')).toBe(receipts[0]);
    directory.disarm();
  });
  const match = { band: '111', title: '합성 제목', body: '합성 제목\n\n내용', uploaded: ['/one.jpg', '/two.jpg'], after: 1000, before: 2000 };
  const photo = { ...bandPhotoEvidence('https://photos.invalid/one.jpg')!, width: 160, height: 90 };
  const post: RecordedBandReadback = { url: 'https://band.us/band/111/post/9001', body: '합성 제목\n내용', createdAt: 1500, owned: true, photos: [photo] };
  it('matches the observed collapsed feed body and photo prefix, without accepting a hash alone', () => {
    expect(bandBodyHash(match.body)).toBe(bandBodyHash(post.body));
    expect(matchesBandCreation(post, match)).toBe(true);
    for (const changed of [{ ...post, owned: false }, { ...post, createdAt: 999 }, { ...post, createdAt: 2001 }, { ...post, body: post.body + '다름' }, { ...post, photos: [] }, { ...post, photos: [{ ...photo, path: '/two.jpg' }] }]) expect(matchesBandCreation(changed, match)).toBe(false);
  });
});
