// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, expect, it } from 'vitest';
import type { Surface } from '@goltou/surface';
import { inspectPrivateRequest, postIdentity, readVisibility, requireTestPost, requireVisibility, type VisibilityProof } from '../src/naver-blog/publish-safety';

const proof: VisibilityProof = { selected: 'private', wire: { name: 'openType', privateValue: '0', publicValue: '2' }, target: null };
const request = (postData: string) => ({ url: 'https://blog.naver.com/RabbitWrite.naver', method: 'POST', postData });
describe('private publish transport gate', () => {
  it.each(['openType=0', 'populationParams=%7B%22configuration%22%3A%7B%22openType%22%3A0%7D%7D', '{"configuration":{"openType":0}}'])('accepts only a field mapped by the labelled radios (%s)', body => {
    expect(inspectPrivateRequest(request(body), proof)).toBe(true);
  });
  it.each(['', 'openType=2', 'visibility=private', 'openType=0&openType=2', '{"openType":2,"openType":0}', '{"configuration":{"openType":0},"openType":2}', 'configuration=broken', '{"configuration":{"visibility":"private"}}'])('fails closed for missing, ambiguous or public payload (%s)', body => {
    expect(inspectPrivateRequest(request(body), proof)).toBe(false);
  });
  it('requires the private read-back and a real wire mapping, including the method and a complete body', () => {
    expect(inspectPrivateRequest(request('openType=0'), { ...proof, wire: null })).toBe(false);
    expect(inspectPrivateRequest(request('openType=0'), { ...proof, selected: 'public' })).toBe(false);
    expect(inspectPrivateRequest({ ...request('openType=0'), method: 'GET' }, proof)).toBe(false);
    expect(inspectPrivateRequest({ url: request('').url, method: 'POST' }, proof)).toBe(false);
    expect(() => requireVisibility(proof, 'private')).not.toThrow();
    expect(() => requireVisibility({ ...proof, selected: null }, 'private')).toThrow('BLOG_VISIBILITY_NOT_PRIVATE');
  });
});
describe('publish radio read-back', () => {
  async function read(html: string) {
    document.body.innerHTML = html;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30, left: 0, top: 0, right: 100, bottom: 30, x: 0, y: 0, toJSON() {} });
    const surface = { evaluateReadOnly: async (expression: string) => window.eval(expression) } as Surface;
    try { return await readVisibility(surface, 'private'); } finally { Element.prototype.getBoundingClientRect = original; document.body.replaceChildren(); }
  }
  const radios = '<input id="pub" type="radio" name="openType" value="2"><label for="pub">전체공개</label><input id="priv" type="radio" name="openType" value="0" checked><label for="priv">비공개</label>';
  it('reads the selected radio independently and derives its request value from the page', async () => {
    expect(await read(radios)).toMatchObject({ selected: 'private', wire: proof.wire, target: { selector: 'input[id="priv"],label[for="priv"]' } });
  });
  it('refuses duplicate groups and does not infer a wire mapping from label text alone', async () => {
    expect(await read(radios + radios)).toMatchObject({ selected: null, wire: null });
    expect(await read(radios.replaceAll('name="openType"', 'name="unknown"'))).toMatchObject({ selected: 'private', wire: null });
  });
});
describe('test post deletion identity', () => {
  const own = { postId: '9001', url: 'https://blog.naver.com/fixture/9001' };
  it('accepts only the exact receipt and experiment prefix', () => {
    expect(() => requireTestPost(own, postIdentity(own.url), '[골투오토 실험] 합성 시험')).not.toThrow();
  });
  it.each([
    [undefined, own, '[골투오토 실험] 시험'], [own, { ...own, postId: '9002' }, '[골투오토 실험] 시험'],
    [own, { ...own, url: 'https://blog.naver.com/other/9001' }, '[골투오토 실험] 시험'], [own, own, '일반 글'], [own, null, '[골투오토 실험] 시험'],
  ] as const)('refuses another, missing or unprefixed post (%#)', (receipt, candidate, title) => {
    expect(() => requireTestPost(receipt, candidate, title)).toThrow('BLOG_TEST_DELETE_REFUSED');
  });
  it.each(['https://example.invalid/fixture/9001', 'http://blog.naver.com/fixture/9001', 'https://blog.naver.com/fixture/9001?x=1#x', 'https://blog.naver.com/PostView.naver?blogId=fixture&logNo=9001'])('validates and canonicalizes post locations (%s)', url => {
    const result = postIdentity(url);
    expect(result).toEqual(url.startsWith('https://blog.naver.com/') ? own : null);
  });
});
