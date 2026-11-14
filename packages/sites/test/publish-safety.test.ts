// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, expect, it } from 'vitest';
import type { Surface } from '@goltou/surface';
import { inspectPrivateRequest, postIdentity, readVisibility, requireTestPost, requireVisibility, type VisibilityProof } from '../src/naver-blog/publish-safety';

const proof: VisibilityProof = { selected: 'private', wire: { name: 'open_type', privateValue: '0', publicValue: '2' }, target: null };
// Same field SHAPE as the blocked 2026-11-14 probes; all content is synthetic.
const shape = (population = '{"configuration":{"openType":0}}', documentModel = '{"title":"synthetic","components":[]}') => new URLSearchParams({ blogId: 'synthetic', documentModel, mediaResources: '{}', populationParams: population, productApiVersion: 'v1', tokenId: 'synthetic' }).toString();
const request = (postData: string) => ({ url: 'https://blog.naver.com/RabbitWrite.naver', method: 'POST', postData, contentType: 'application/x-www-form-urlencoded; charset=UTF-8', postDataComplete: true });
describe('private publish transport gate', () => {
  it.each([shape(), shape('{"configuration":{"openType":0},"other":true}')])('accepts the exact observed private shape with synthetic content (%#)', body => {
    expect(inspectPrivateRequest(request(body), proof)).toBe(true);
  });
  it.each(['', 'openType=0', shape('{"configuration":{"openType":2}}'), shape('{"configuration":{"openType":"0"}}'), shape('{"configuration":{"openType":false}}'), shape('{"configuration":{"openType":0,"openType":2}}'), shape('{"configuration":{"openType":2,"openType":0}}'), shape('{"configuration":{"openType":0},"openType":2}'), shape('{"configuration":{},"other":{"openType":0}}'), shape('{"configuration":{"openType":0},"other":"{\\"openType\\":2}"}'), shape('{"configuration":{"openType":0}}', '{"nested":[{"visibility":"public"}]}'), shape('broken'), shape() + '&populationParams=%7B%7D', shape() + '&openType=0', shape().replace('tokenId=synthetic', ''), shape('{"configuration":{"openType":0},"configuration":{}}')])('fails closed for unknown encodings, paths, types, duplicates and conflicting copies (%#)', body => {
    expect(inspectPrivateRequest(request(body), proof)).toBe(false);
  });
  it('requires the private read-back and a real wire mapping, including the method and a complete body', () => {
    expect(inspectPrivateRequest(request(shape()), { ...proof, wire: null })).toBe(false);
    expect(inspectPrivateRequest(request(shape()), { ...proof, selected: 'public' })).toBe(false);
    expect(inspectPrivateRequest({ ...request(shape()), method: 'GET' }, proof)).toBe(false);
    expect(inspectPrivateRequest({ ...request(shape()), postDataComplete: false }, proof)).toBe(false);
    expect(inspectPrivateRequest({ ...request(shape()), contentType: 'multipart/form-data' }, proof)).toBe(false);
    expect(inspectPrivateRequest({ ...request(shape()), contentType: 'application/json' }, proof)).toBe(false);
    expect(inspectPrivateRequest(request(shape()), { ...proof, wire: { ...proof.wire!, privateValue: '2' } })).toBe(false);
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
  const radios = '<input id="pub" type="radio" name="open_type" value="2"><label for="pub">전체공개</label><input id="priv" type="radio" name="open_type" value="0" checked><label for="priv">비공개</label>';
  it('reads the selected radio independently and derives its request value from the page', async () => {
    expect(await read(radios)).toMatchObject({ selected: 'private', wire: proof.wire, target: { selector: 'input[id="priv"],label[for="priv"]' } });
  });
  it('refuses duplicate groups and does not infer a wire mapping from label text alone', async () => {
    expect(await read(radios + radios)).toMatchObject({ selected: null, wire: null });
    expect(await read(radios.replaceAll('name="open_type"', 'name="openType"'))).toMatchObject({ selected: 'private', wire: null });
    expect(await read(radios.replace('value="0"', 'value="1"'))).toMatchObject({ selected: 'private', wire: null });
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
