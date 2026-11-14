import { describe, expect, it } from 'vitest';
import { parsePublishIdentity, resolvePublishIdentity, resolvePublishEvidence, type ResponseIdentity } from '../src/naver-blog/publish-identity';
import { postIdentity } from '../src/naver-blog/publish-safety';
const url = 'https://blog.naver.com/synthetic/9001', title = 'synthetic title';
const none: ResponseIdentity = { post: null, postId: null };
const page = { url, titles: [title] };
const parse = (body: unknown) => parsePublishIdentity({ status: 200, body: JSON.stringify(body) });
describe('publish identity from independent sources', () => {
  it('reports only fixed source names after resolving agreeing evidence', () => {
    expect(resolvePublishEvidence(parse({ result: { postUrl: url } }), [url], [page], title)).toEqual({ post: postIdentity(url), sources: ['response', 'result-url', 'title'] });
    expect(resolvePublishEvidence(parse({ undocumented: true }), [url], [page], title)).toEqual({ post: postIdentity(url), sources: ['result-url', 'title'] });
    expect(resolvePublishEvidence(parse({ logNo: '9001' }), [], [page], title)).toEqual({ post: postIdentity(url), sources: ['title'] });
    expect(resolvePublishEvidence(none, [], [], title)).toEqual({ post: null, sources: [] });
    expect(() => resolvePublishEvidence(none, [url.replace('9001', '9002')], [page], title)).toThrow('BLOG_PUBLISH_ID_AMBIGUOUS');
  });
  it.each([{ isSuccess: true, result: { logNo: '9001', postUrl: url } }, { logNo: 9001, url }, { result: { postUrl: url } }])('uses the understood response schema (%#)', body => {
    const identity = parse(body);
    expect(resolvePublishIdentity(identity, [], [], title)).toEqual(postIdentity(url));
  });
  it.each(['not-json', JSON.stringify({ undocumented: { arbitraryId: '9001' } })])('does not guess unknown response fields; navigation or exact title still suffices (%#)', body => {
    const response = parsePublishIdentity({ status: 200, body });
    expect(response).toEqual(none);
    expect(resolvePublishIdentity(response, [url], [], title)).toEqual(postIdentity(url));
    expect(resolvePublishIdentity(response, ['https://blog.naver.com/GoBlogWrite.naver'], [page], title)).toEqual(postIdentity(url));
  });
  it('keeps an id-only response as a constraint, not an invented URL', () => {
    const response = parse({ result: { logNo: '9001' } });
    expect(resolvePublishIdentity(response, [], [], title)).toBeNull();
    expect(resolvePublishIdentity(response, [], [page], title)).toEqual(postIdentity(url));
  });
  it.each([
    [none, [url, url.replace('9001', '9002')], []],
    [none, [url], [{ ...page, url: url.replace('9001', '9002') }]],
    [none, [], [page, { ...page, url: url.replace('synthetic', 'other') }]],
    [none, [], [{ ...page, titles: [title, title] }]],
    [{ post: null, postId: '9002' }, [url], [page]],
    [{ post: postIdentity(url), postId: '9001' }, [url.replace('synthetic', 'other')], []],
  ] as const)('refuses ambiguity or conflict within/across sources (%#)', (response, navigation, pages) => {
    expect(() => resolvePublishIdentity(response, [...navigation], pages.map(p => ({ ...p, titles: [...p.titles] })), title)).toThrow('BLOG_PUBLISH_ID_AMBIGUOUS');
  });
  it('requires an exact title and a real post URL for title lookup', () => {
    expect(resolvePublishIdentity(none, [], [{ ...page, titles: [title + 'different'] }], title)).toBeNull();
    expect(resolvePublishIdentity(none, [], [{ ...page, url: 'https://example.invalid/9001' }], title)).toBeNull();
  });
  it.each([
    '{"result":{"logNo":"9001","logNo":"9002"}}',
    JSON.stringify({ result: { logNo: '9002', postUrl: url } }),
    JSON.stringify({ result: { postUrl: url, url: url.replace('synthetic', 'other') } }),
    JSON.stringify({ logNo: '9002', result: { logNo: '9001' } }),
  ])('rejects conflicting response identities and duplicate fields (%#)', body => expect(() => parsePublishIdentity({ status: 200, body })).toThrow('BLOG_PUBLISH_ID_AMBIGUOUS'));
  it('does not accept an explicit failure or unsafe numeric identifier', () => {
    expect(() => parse({ isSuccess: false })).toThrow('BLOG_PUBLISH_RESPONSE_REJECTED');
    expect(() => parsePublishIdentity({ status: 403, body: '{}' })).toThrow('BLOG_PUBLISH_RESPONSE_REJECTED');
    expect(parse({ logNo: 9007199254740992 })).toEqual(none);
  });
  it.each([
    'https://blog.naver.com/PostView.naver?blogId=synthetic&logNo=9001&logNo=9002',
    'https://blog.naver.com/synthetic/9001?blogId=other',
    'https://blog.naver.com/synthetic/9001?logNo=9002',
    'https://blog.naver.com/PostView.naver?blogId=synthetic&blogId=other&logNo=9001',
  ])('rejects ambiguous URL identifiers (%s)', value => expect(postIdentity(value)).toBeNull());
});
