import { describe, expect, it } from 'vitest';
import { bandFeedResponse, bandRecordReadAllowed, bandStoredText, parseRecordedBandFeed } from '../src/band/record-read';
const target = { url: 'https://band.us/band/111/post/9001', title: '합성 상품' };
export const syntheticBandPost = () => ({ post_no: 9001, band: { band_no: 111 }, web_url: target.url,
  content: '합성 상품\n\n내용 &amp; 안내\n<band:hashtag>#합성</band:hashtag>', created_at: 1700000000000,
  author: { me: true }, photo_count: 1, attachment: { photo: [{ photo_url: '//example.invalid/upload/one.jpg?private=removed', width: 100, height: 80 }] } });
const body = (posts = [syntheticBandPost()]) => JSON.stringify({ result_code: 1, result_data: { items: posts.map(post => ({ post })) } });
describe('exact recorded Band feed receipt', () => {
  it('allows only the observed mobile session-bootstrap GET, never login documents or writes', () => {
    expect(bandRecordReadAllowed({ method: 'GET', url: 'https://auth.band.us/s/login/getKey' })).toBe(true);
    for (const [method, url] of [['POST', 'https://auth.band.us/s/login/getKey'], ['GET', 'https://auth.band.us/s/login/getKey/extra'], ['GET', 'https://auth.band.us/login'], ['GET', 'https://band.us/login'], ['GET', 'http://auth.band.us/s/login/getKey']])
      expect(bandRecordReadAllowed({ method: method!, url: url! })).toBe(false);
  });
  it('decodes service markup and returns only the recorded identity and ordered photo paths', () => {
    expect(parseRecordedBandFeed(body(), target)).toEqual({ url: target.url, body: '합성 상품\n\n내용 & 안내\n#합성', createdAt: 1700000000000,
      owned: true, photos: [{ path: '/upload/one.jpg', width: 100, height: 80 }] });
    expect(parseRecordedBandFeed(body([]), target)).toBeNull();
    expect(bandStoredText('&lt;x&gt; &quot; &#39;')).toBe('<x> " \'');
    expect(bandStoredText('&amp;lt;')).toBe('&lt;');
  });
  it.each(['band', 'url', 'title', 'count', 'duplicates'])('rejects changed %s evidence', mode => {
    const p = syntheticBandPost();
    if (mode === 'band') p.band.band_no = 222;
    if (mode === 'url') p.web_url = 'https://band.us/band/111/post/9002';
    if (mode === 'title') p.content = '다른 상품';
    if (mode === 'count') p.photo_count = 2;
    expect(() => parseRecordedBandFeed(body(mode === 'duplicates' ? [p, p] : [p]), target)).toThrow();
  });
  it('keeps a non-owner unverified and selects only the exact GET response route', () => {
    const p = syntheticBandPost(); p.author.me = false;
    expect(parseRecordedBandFeed(body([p]), target)?.owned).toBe(false);
    for (const [method, path, expected] of [['GET', '/v2.0.0/get_posts_and_announcements', true], ['OPTIONS', '/v2.0.0/get_posts_and_announcements', false], ['POST', '/v2.0.0/get_posts_and_announcements', false], ['GET', '/v2.0.0/get_posts_and_announcements/extra', false]] as const)
      expect(bandFeedResponse({ method, url: `https://api-kr.band.us${path}` })).toBe(expected);
  });
});
