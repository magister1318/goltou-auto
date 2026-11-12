import { describe, expect, it, vi } from 'vitest';
import { parseContents } from '../src/convert';
import { applyPolish, parsePolishAnswer, polishContent, validateParagraph } from '../src/polish';
import { makePreview } from '../src/preparation';
import { observePlan } from '../src/verify';
import { fixtureProduct } from './fixtures/catalog';

describe('WP4 conservative paragraph polishing', () => {
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
    const product = fixtureProduct('<p>예시CC에서 조용히 쉬어 갑니다.</p><p>원문에 숫자 18이 들어 있습니다.</p><p>출발일: 2026-12-03 가격: 1190000원</p><table><tr><td>가격 999원</td></tr></table><p><b>강조 문단</b></p>', 0);
    const parsed = parseContents(product.contentsHtml);
    const transport = vi.fn(async (_prompt: string) => '1. 예시CC에서 조용히 쉬어갑니다.\n2. 원문에 숫자 19가 들어 있습니다.');
    const result = await polishContent(parsed, product, transport);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).not.toMatch(/1190000|2026-12-03|999|강조 문단/);
    expect(result.paragraphs.map(p => p.accepted)).toEqual([true, false]);
    const preview = makePreview(product, {}, parsed, result);
    expect(preview.verification.blog.matches).toBe(true);
    expect(observePlan(preview.blog).text).toContain('조용히 쉬어갑니다.');
    expect(observePlan(preview.blog).text).toContain('숫자 18');
    const reverted = makePreview(product, {}, parsed, result, ['p1']);
    expect(observePlan(reverted.blog).text).toContain('조용히 쉬어 갑니다.');
    expect(applyPolish(parsed, result, ['p1']).blocks[0]).toEqual(parsed.blocks[0]);
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
});
