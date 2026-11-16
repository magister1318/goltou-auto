import { describe, expect, it } from 'vitest';
import type { GuardedRequest } from '@goltou/surface';
import { bandDeleteRequestAllowed, bandDeleteRequestDecision } from '../src/band/mobile-delete';
import { bandDeleteShape } from '../src/band/delete-log';
const id = { band: '111', post: '9001' };
const request = (): GuardedRequest => ({ url: 'https://api-kr.band.us/v1.5.0/delete_post?version=20140508&token=synthetic-session', method: 'POST', postDataComplete: true,
  contentType: 'application/x-www-form-urlencoded', postData: 'band_no=111&post_no=9001' });
describe('current single-post deletion service contract with synthetic values', () => {
  it('replays the observed version/ts query and ordered form names without retaining values', () => {
    const r = { ...request(), url: 'https://api-kr.band.us/v1.5.0/delete_post?version=20140508&ts=1700000000000' };
    expect(bandDeleteRequestDecision(r, id)).toBe('REQUEST_ALLOWED');
    expect(bandDeleteShape(r)).toEqual({ method: 'POST', host: 'api-kr.band.us', path: '/v1.5.0/delete_post',
      contentType: 'application/x-www-form-urlencoded', queryFieldNames: ['version', 'ts'], bodyFieldNames: ['band_no', 'post_no'], complete: true });
    for (const query of ['ts=1700000000000&ts=1700000000000', 'ts=not-a-time', 'ts=1700000000', 'ts=', 'ts=1700000000000&other=1'])
      expect(bandDeleteRequestDecision({ ...r, url: `https://api-kr.band.us/v1.5.0/delete_post?version=20140508&${query}` }, id)).toBe('QUERY_BLOCKED');
    expect(bandDeleteRequestDecision({ ...r, postData: 'band_no=111&post_no=9002' }, id)).toBe('TARGET_MISMATCH');
  });
  it('accepts only the complete form for the recorded target on official regional or default host', () => {
    expect(bandDeleteRequestAllowed(request(), id)).toBe(true);
    expect(bandDeleteRequestAllowed({ ...request(), url: request().url.replace('api-kr.', 'api.') }, id)).toBe(true);
  });
  it.each(['band_no=222&post_no=9001', 'band_no=111&post_no=9002', 'band_key=111&post_key=9001', 'band_no=111&post_nos=9001',
    'band_no=111&post_no=9001&comment_no=1', 'band_no=111&post_no=9001&band_no=111', 'band_no=111&post_no=9001&post_no=9001'])('refuses changed or extra target fields (%s)', postData => expect(bandDeleteRequestAllowed({ ...request(), postData }, id)).toBe(false));
  it.each(['/v1.0.0/delete_posts?version=20140508', '/v1.5.0/delete_post/extra?version=20140508', '/v1.5.0/delete_post?version=other',
    '/v1.5.0/delete_post?version=20140508&version=20140508', '/v1.5.0/delete_post?version=20140508&post_no=9002',
    '/v1.5.0/delete_post?version=20140508&token=synthetic&token=synthetic'])('refuses bulk routes or ambiguous query fields (%s)', path => expect(bandDeleteRequestAllowed({ ...request(), url: `https://api-kr.band.us${path}` }, id)).toBe(false));
  it.each([{ method: 'GET' }, { postDataComplete: false }, { contentType: 'application/json' }, { url: 'http://api-kr.band.us/v1.5.0/delete_post?version=20140508' },
    { url: 'https://api-kr.band.us.example.invalid/v1.5.0/delete_post?version=20140508' }])('refuses changed transport %#', change => expect(bandDeleteRequestAllowed({ ...request(), ...change }, id)).toBe(false));
});
