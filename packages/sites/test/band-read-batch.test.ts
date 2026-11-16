import { describe, expect, it, vi } from 'vitest';
import type { GuardedRequest, Surface, SurfaceHost } from '@goltou/surface';
import { bandReadBatchTarget } from '../src/band/read-batch';
import { BandDirectory } from '../src/band/plan';
const items = () => [
  { path: '/v2.0.0/get_post?band_no=111&post_no=9001&resolution_type=synthetic&token=synthetic-session', svc_id: 'synthetic-read', method: 'GET' },
  { path: '/v2.0.0/get_emotions?band_no=111&content_key=synthetic&token=synthetic-session&post_no=9001', svc_id: 'synthetic-read', method: 'GET' },
];
const request = (payload = items()): GuardedRequest => ({ url: 'https://bapi-kr.band.us/v2.0.0/batch', method: 'POST', contentType: 'application/x-www-form-urlencoded', postDataComplete: true, postData: new URLSearchParams({ payload: JSON.stringify(payload) }).toString() });
describe('observed two-GET Band read batch', () => {
  it('accepts only the observed envelope and one common numeric post identity', () => expect(bandReadBatchTarget(request())).toEqual({ band: '111', post: '9001' }));
  it('rejects duplicate envelope keys even when JSON.parse would hide them', () => {
    const payload = JSON.stringify(items()).replace('"method":"GET"', '"method":"POST","method":"GET"');
    expect(bandReadBatchTarget({ ...request(), postData: new URLSearchParams({ payload }).toString() })).toBeNull();
    expect(bandReadBatchTarget({ ...request(), postData: request().postData + '&payload=%5B%5D' })).toBeNull();
  });
  it.each(['write', 'path', 'band', 'post', 'duplicate', 'extra', 'absolute', 'param', 'missing'])('refuses changed %s batches', mode => {
    const p = items();
    if (mode === 'write') p[0]!.method = 'POST';
    if (mode === 'path') p[0]!.path = p[0]!.path.replace('get_post', 'delete_post');
    if (mode === 'band') p[1]!.path = p[1]!.path.replace('band_no=111', 'band_no=222');
    if (mode === 'post') p[1]!.path = p[1]!.path.replace('post_no=9001', 'post_no=9002');
    if (mode === 'duplicate') p[1] = p[0]!;
    if (mode === 'extra') Object.assign(p[0]!, { body: 'synthetic' });
    if (mode === 'absolute') p[0]!.path = `https://other.invalid${p[0]!.path}`;
    if (mode === 'param') p[0]!.path += '&post_no=9002';
    if (mode === 'missing') p.pop();
    expect(bandReadBatchTarget(request(p))).toBeNull();
  });
  it.each([{ postDataComplete: false }, { contentType: 'application/json' }, { url: 'https://other.band.us/v2.0.0/batch' }, { url: 'http://bapi-kr.band.us/v2.0.0/batch' }, { url: 'https://bapi-kr.band.us/v2.0.0/batch/extra' }])('rejects changed transport %#', change => expect(bandReadBatchTarget({ ...request(), ...change })).toBeNull());
  it('requires the owned current band and never arms or spends a publication allowance', async () => {
    let inspect!: (r: GuardedRequest) => boolean | Promise<boolean>;
    let current = 'https://band.us/band/111/post';
    const surface = { guardRequests: vi.fn(async (_r, i) => { inspect = i; }), readState: async () => ({ url: current }) } as unknown as Surface;
    const directory = new BandDirectory({ create: async () => surface } as unknown as SurfaceHost);
    await directory.getSurface();
    expect(await inspect(request())).toBe(false);
    directory.choices = [{ key: '111', name: '합성', photoLimit: null, observedAt: null }];
    expect(await inspect(request())).toBe(true);
    expect(directory.decisionCodes).toContain('READ_BATCH_ALLOWED');
    current = 'https://band.us/band/222/post'; expect(await inspect(request())).toBe(false);
    current = 'https://band.us/band/111/post/9002'; expect(await inspect(request())).toBe(false);
    expect(directory.decisionCodes).not.toContain('ARMED'); expect(directory.decisionCodes).not.toContain('ALLOWANCE_CONSUMED');
  });
});
