import { describe, expect, it, vi } from 'vitest';
import { polishPrompt, parsePolishAnswer, validateParagraph } from '../src/polish';
import { makePreview, preparePreview } from '../src/preparation';
import { observePlan } from '../src/verify';
import { fixtureProduct } from './fixtures/catalog';

describe('polish strength instructions and safety', () => {
  it.each(['spelling', 'natural'] as const)('builds firm instructions and the same response contract: %s', level => {
    const prompt = polishPrompt(['첫 문단입니다.', '다음 문단입니다.'], level);
    for (const rule of ['숫자·가격·날짜·시간·전화번호·URL·지명·호텔명·골프장명·상품명', '사실 추가·삭제', '판매 문구 추가', '이모지 추가·삭제', '취소선', '문단 수와 순서', '1. 내용 형식', '70~130%', '설명·제목·표·코드블록 없이']) expect(prompt).toContain(rule);
    expect(prompt).toContain('<원문>\n1. 첫 문단입니다.\n2. 다음 문단입니다.\n</원문>');
    expect(prompt).toContain(level === 'spelling' ? '문장은 쓴 그대로' : '적극 고치세요');
    expect(prompt).not.toContain(level === 'spelling' ? '적극 고치세요' : '문장은 쓴 그대로');
    expect(polishPrompt(['첫 문단입니다.'])).toBe(polishPrompt(['첫 문단입니다.'], 'spelling'));
  });
  it.each([
    ['18홀 후 36홀', '36홀 후 18홀'],
    ['전화 010-1234-5678 시간 09:30', '전화 010-1234-5679 시간 09:30'],
    ['가격 30만원', '가격 30원'],
    ['오전 9시 도착', '오전 9분 도착'],
    ['이동 2시간 소요', '이동 2분 소요'],
    ['https://example.invalid/a https://example.invalid/b', 'https://example.invalid/b https://example.invalid/a'],
    ['https://example.invalid/a', 'https://example.invalid/b'],
    ['HTTPS://example.invalid/a?x=one', 'HTTPS://example.invalid/a?x=two'],
    ['주소 https://example.invalid/a', '주소 안내입니다.'],
    ['안내 문장입니다.', '안내 https://example.invalid/a'],
    ['예시호텔에서 편하게 쉽니다.', '다른호텔에서 편하게 쉽니다.'],
    ['풍경을 보며 쉽니다. 😀', '풍경을 보며 쉽니다.'],
    ['풍경을 보며 쉽니다.', '풍경을 보며 쉽니다. 😀'],
    ['풍경을 보며 쉽니다. 👩‍👩‍👧‍👦', '풍경을 보며 쉽니다. 👩👩👧👦'],
    ['풍경을 보며 쉽니다. 🇰🇷', '풍경을 보며 쉽니다. 🇯🇵'],
  ])('rejects changed protected content or order: %s', (before, after) => {
    expect(validateParagraph(before, after)).not.toEqual([]);
  });
  it('keeps ordered digit sequences, units, URLs, names and emoji during a useful rewrite', () => {
    expect(validateParagraph('예시호텔에서 18홀 후 36홀을 즐기며 쉬어 갑니다. 😀 https://example.invalid/a', '예시호텔에서 18홀 후 36홀을 즐기며 쉬어갑니다. 😀 https://example.invalid/a', ['예시호텔'])).toEqual([]);
    expect(validateParagraph('예시지역에서 예시상품을 안내합니다.', '다른지역에서 예시상품을 안내합니다.', ['예시지역', '예시상품'])).toContain('고유명사 변경');
  });
  it.each(['spelling', 'natural'] as const)('flows the selected level into requests and never revives struck text: %s', async level => {
    const product = fixtureProduct('<p>라운드 후에는 <del>별도결제</del> 편안하게 쉬어 갑니다.</p>', 0);
    const transport = vi.fn(async (_prompt: string) => '1. 라운드 후에는 별도결제 후 편안하게 쉬어갑니다.');
    const preview = await preparePreview(product, { polish: true, polishStrength: level }, transport);
    expect(transport.mock.calls[0]![0]).toBe(polishPrompt(['라운드 후에는 편안하게 쉬어 갑니다.'], level));
    expect(transport.mock.calls[0]![0]).not.toContain('별도결제');
    expect(preview.polish?.paragraphs[0]).toMatchObject({ accepted: false, failureCode: 'AI_VALIDATION_REJECTED', reasons: expect.arrayContaining(['취소선으로 제외한 글자 재등장']) });
    for (const channel of ['blog', 'band'] as const) {
      expect(observePlan(preview[channel]).text).not.toContain('별도결제');
      expect(observePlan(makePreview(product, {}, undefined, preview.polish)[channel]).text).not.toContain('별도결제');
    }
  });
  it('does not send anything while polishing is off, even with a remembered strength', async () => {
    const transport = vi.fn();
    await preparePreview(fixtureProduct('<p>소개 문장입니다.</p>', 0), { polish: false, polishStrength: 'spelling' }, transport);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('strict payload with tolerant wrappers', () => {
  it.each([
    '1. 소개 문장입니다.', '  "1. 소개 문장입니다."  ', "'1. 소개 문장입니다.'", '“1. 소개 문장입니다.”',
    '```\n1. 소개 문장입니다.\n```', '```text\r\n1. 소개 문장입니다.\r\n```',
    '결과:\n1. 소개 문장입니다.', '다듬은 문장:\n1. 소개 문장입니다.',
    '다듬은 글:\n```text\n"1. 소개 문장입니다."\n```',
    '```text\n교정 결과:\n1. 소개 문장입니다.\n```',
  ])('accepts only a harmless wrapper: %s', answer => expect(parsePolishAnswer(answer, 1)).toEqual(['소개 문장입니다.']));
  it.each([
    '설명입니다.\n1. 소개 문장입니다.', '1. 소개 문장입니다.\n고쳤습니다.',
    '결과:\n1. 소개 문장입니다.\n설명: 원문과 같습니다.', '```text\n1. 소개 문장입니다.\n```\n확인해 주세요.',
    '"1. 소개 문장입니다.', '```\n1. 소개 문장입니다.', '2. 소개 문장입니다.',
    '1. 소개 문장입니다.\n1. 추가 문장입니다.', '문장을 다듬었습니다:\n1. 소개 문장입니다.',
    '```javascript\n1. 소개 문장입니다.\n```', '결과:\n결과:\n1. 소개 문장입니다.',
  ])('rejects commentary, unbalanced wrappers and wrong numbering: %s', answer => expect(parsePolishAnswer(answer, 1)).toBeNull());
  it('retains paragraph count/order and original quotation inside a numbered payload', () => {
    expect(parsePolishAnswer('결과:\n```text\n1. “하나”입니다.\n2. 둘입니다.\n```', 2)).toEqual(['“하나”입니다.', '둘입니다.']);
    expect(parsePolishAnswer('1. 하나\n3. 둘', 2)).toBeNull();
    expect(parsePolishAnswer('1. 하나\n\n2. 둘', 2)).toBeNull();
  });
});
