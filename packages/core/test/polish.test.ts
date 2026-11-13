import { describe, expect, it, vi } from 'vitest';
import { parseContents } from '../src/convert';
import { applyPolish, parsePolishAnswer, polishContent, validateParagraph } from '../src/polish';
import { makePreview } from '../src/preparation';
import { observePlan } from '../src/verify';
import { fixtureProduct } from './fixtures/catalog';
import { unicodeNumber } from '../src/polish/unicode-numbers';

describe('WP4 conservative paragraph polishing', () => {
  it('covers every Unicode number without requiring ICU property escapes at runtime', () => {
    const expected = /\p{N}/u;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const character = String.fromCodePoint(cp);
      const actual = unicodeNumber.test(character);
      // Older Node builds may regard numbers added in Unicode 17 as unassigned.
      if (expected.test(character) ? !actual : actual && !/\p{Cn}/u.test(character)) throw new Error(`UNICODE_NUMBER_RANGE_MISMATCH_${cp.toString(16)}`);
    }
  });
  it.each([
    ['예시CC에서 18홀을 즐깁니다.', '예시CC에서 19홀을 즐깁니다.'],
    ['날짜는 2026-12-03입니다.', '날짜는 2026-12-04입니다.'],
    ['가격은 1190000원입니다.', '가격은 1190001원입니다.'],
    ['예시CC에서 쉬어 갑니다.', '다른CC에서 쉬어 갑니다.'],
    ['원문 안내입니다.', '원문 1 안내입니다.'],
    ['원문 안내입니다.', '원문 １ 안내입니다.'],
    ['예시CC에서 쉽니다.', '예시CC와 다른CC에서 쉽니다.'],
    ['https://example.invalid/4 주소입니다.', 'https://example.invalid/5 주소입니다.'],
    ['문장 길이를 유지합니다.', '짧음'],
    ['문장입니다.', '불필요하게 아주 길고 새로운 광고 내용이 들어간 전혀 다른 문장입니다.'],
  ])('rejects altered facts or length: %s', (original, changed) => expect(validateParagraph(original, changed, ['예시CC'])).not.toHaveLength(0));
  it('keeps exact facts, multiplicities, units and URLs', () => {
    expect(validateParagraph('예시CC 18홀에서 쉬어 갑니다.', '예시CC 18홀에서 쉬어갑니다.', ['예시CC'])).toEqual([]);
    expect(validateParagraph('예시CC 18홀 18홀', '예시CC 18홀', ['예시CC'])).not.toEqual([]);
  });
  it('excludes tables, dates, prices and formatted paragraphs; reverts individual unsafe responses', async () => {
    const product = fixtureProduct('<p>예시CC에서 조용히 쉬어 갑니다.</p><p>원문에 숫자가 없습니다.</p><p>원문에 숫자 18이 들어 있습니다.</p><p>출발일: 2026-12-03 가격: 1190000원</p><table><tr><td>가격 999원</td></tr></table><p><b>강조 문단</b></p>', 0);
    const parsed = parseContents(product.contentsHtml);
    const transport = vi.fn(async (prompt: string) => prompt.includes('예시CC') ? '1. 예시CC에서 조용히 쉬어갑니다.' : '1. 원문에 숫자 19가 있습니다.');
    const result = await polishContent(parsed, product, transport);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.flat().join('')).not.toMatch(/1190000|2026-12-03|999|강조 문단|원문에 숫자 18/);
    expect(result.paragraphs.map(p => p.outcome)).toEqual(['polished', 'fallback', 'kept_digits', 'kept_digits', 'kept_format']);
    expect(result.paragraphs[1]?.reasons).toContain('숫자·날짜·금액 변경 또는 새 숫자');
    const preview = makePreview(product, {}, parsed, result);
    expect(preview.verification.blog.matches).toBe(true);
    expect(observePlan(preview.blog).text).toContain('조용히 쉬어갑니다.');
    expect(observePlan(preview.blog).text).toContain('숫자 18');
    const reverted = makePreview(product, {}, parsed, result, ['p1']);
    expect(observePlan(reverted.blog).text).toContain('조용히 쉬어 갑니다.');
    expect(applyPolish(parsed, result, ['p1']).blocks[0]).toEqual(parsed.blocks[0]);
  });
  it('never sends paragraphs containing any Unicode number to AI, including non-price quantities', async () => {
    const numeric = ['18홀 안내입니다.', '３박 일정입니다.', '١회 안내입니다.', '² 표시입니다.', 'Ⅳ 등급입니다.', '① 안내입니다.', '𝟚회 체험입니다.'];
    const product = fixtureProduct(numeric.map(p => `<p>${p}</p>`).join('') + '<p>풍경을 둘러보며 쉬어 갑니다.</p>', 0);
    const transport = vi.fn(async (_prompt: string) => '1. 풍경을 둘러보며 쉬어갑니다.');
    const result = await polishContent(parseContents(product.contentsHtml), product, transport);
    expect(transport).toHaveBeenCalledTimes(1);
    for (const paragraph of numeric) expect(transport.mock.calls[0]![0]).not.toContain(paragraph);
    expect(result.paragraphs.filter(p => p.outcome === 'kept_digits')).toHaveLength(numeric.length);
    expect(result.paragraphs.at(-1)?.accepted).toBe(true);
    const onlyNumbers = parseContents(numeric.map(p => `<p>${p}</p>`).join(''));
    transport.mockClear();
    expect((await polishContent(onlyNumbers, product, transport)).paragraphs.every(p => !p.sent && p.outcome === 'kept_digits')).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });
  it('falls back without failing the job on login, unavailable or malformed answers', async () => {
    const product = fixtureProduct('<p>소개 문장을 다듬습니다.</p>', 0), parsed = parseContents(product.contentsHtml);
    for (const [transport, status] of [[undefined, 'unavailable'], [async () => { throw new Error('AI_LOGIN_REQUIRED'); }, 'login_required'], [async () => '번호 없는 응답', 'invalid_format']] as const) {
      const result = await polishContent(parsed, product, transport);
      expect(result.status).toBe(status); expect(result.paragraphs[0]?.polished).toBe('소개 문장을 다듬습니다.');
    }
    expect(parsePolishAnswer('1. 하나\n3. 둘', 2)).toBeNull();
    expect(parsePolishAnswer('1. 하나\n2. 둘\n설명', 2)).toBeNull();
  });
  it('sends digit-free paragraphs sequentially, keeps validation failures local, and records elapsed times', async () => {
    const product = fixtureProduct('<p>예시CC에서 조용히 쉬어 갑니다.</p><p>풍경을 둘러보며 편하게 쉬어 갑니다.</p><p>주변 풍경을 보며 쉬어 갑니다.</p>', 0);
    let active = 0, maxActive = 0;
    const transport = vi.fn(async (prompt: string) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      expect(prompt.match(/\n1\. /g)).toHaveLength(1); expect(prompt).not.toContain('\n2.');
      return prompt.includes('예시CC') ? '1. 예시CC에서 조용히 쉬어갑니다.' : prompt.includes('편하게') ? '1. 풍경을 둘러보며 2회 쉬어 갑니다.' : '1. 주변 풍경을 보며 쉬어갑니다.';
    });
    const result = await polishContent(parseContents(product.contentsHtml), product, transport);
    expect(maxActive).toBe(1); expect(transport).toHaveBeenCalledTimes(3);
    expect(result.paragraphs.map(p => p.outcome)).toEqual(['polished', 'fallback', 'polished']);
    expect(result.paragraphs.every(p => p.sent && p.elapsedMs >= 1)).toBe(true);
    expect(result.paragraphs[1]?.polished).toBe(result.paragraphs[1]?.original);
    for (const channel of ['blog', 'band'] as const) {
      const plan = makePreview(product, {}, undefined, result)[channel];
      const before = observePlan(makePreview(product, {})[channel]), after = observePlan(plan);
      expect(after.prices).toEqual(before.prices); expect(after.departures).toEqual(before.departures); expect(after.golfCourses).toEqual(before.golfCourses);
    }
  });
  it.each(['AI_LOGIN_REQUIRED', 'AI_CONSENT_REQUIRED', 'AI_REGION_UNAVAILABLE', 'AI_AGE_RESTRICTED', 'AI_BLOCKED', 'AI_LAYOUT_UNSUPPORTED', 'AI_INPUT_NOT_READY', 'AI_INPUT_MISMATCH', 'AI_REQUEST_NOT_RECEIVED', 'AI_RESPONSE_TIMEOUT', 'AI_NAVIGATION_TIMEOUT', 'AI_READ_FAILED', 'AI_BUSY', 'private raw failure'])('stops subsequent requests and keeps originals with a safe reason: %s', async code => {
    const product = fixtureProduct('<p>소개 문장을 다듬습니다.</p><p>주변 풍경을 감상합니다.</p>', 0);
    const transport = vi.fn(async () => { throw Object.assign(new Error(code), { submitted: true }); });
    const result = await polishContent(parseContents(product.contentsHtml), product, transport);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result.paragraphs.map(p => p.sent)).toEqual([true, false]);
    expect(result.paragraphs.every(p => p.original === p.polished && p.outcome === 'fallback' && p.reasons.length)).toBe(true);
    expect(result.status).toBe(code === 'AI_LOGIN_REQUIRED' ? 'login_required' : 'unavailable');
    expect(JSON.stringify(result)).not.toContain('private raw failure');
    if (code === 'AI_LOGIN_REQUIRED') expect(result.notice).toContain('사용자 로그인 대기');
  });
  it('propagates cancellation instead of swallowing it as a fallback', async () => {
    const product = fixtureProduct('<p>소개 문장을 다듬습니다.</p>', 0);
    let cancelled = false;
    await expect(polishContent(parseContents(product.contentsHtml), product, async () => { cancelled = true; throw Error('stopped'); }, () => { if (cancelled) throw Error('CANCELLED'); })).rejects.toThrow('CANCELLED');
  });
});
