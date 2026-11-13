import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { polishContent } from '../../core/src/polish';
import { parseContents } from '../../core/src/convert';
import { fixtureProduct } from '../../core/test/fixtures/catalog';
import { PolishComparison } from '../src/PolishComparison';

describe('paragraph approval preview', () => {
  it('shows polished, digit-kept, formatted and fallback paragraphs side by side before registration', async () => {
    const product = fixtureProduct('<p>주변 풍경을 보며 쉬어 갑니다.</p><p>18홀 가격 1190000원</p><p><b>강조 문장입니다.</b></p><p>안내 문장을 확인해 주세요.</p>', 0);
    const result = await polishContent(parseContents(product.contentsHtml), product, async prompt => prompt.includes('주변 풍경') ? '1. 주변 풍경을 보며 쉬어갑니다.' : '1. 안내 문장 2개를 확인하세요.');
    const render = () => renderToStaticMarkup(createElement(PolishComparison, { result, busy: false, onOpen() {}, onRetry() {}, onRevert() {} }));
    const html = render();
    for (const label of ['다듬음', '유지 · 숫자 포함', '유지 · 서식·일정·요금', '원문 유지: 숫자가 달라짐', 'AI 화면 열기', '다듬기 다시 시도', '숫자·날짜·금액 변경 또는 새 숫자']) expect(html).toContain(label);
    expect(html).toContain('전송 2'); expect(html).toContain('다듬음 1');
    expect(html.match(/18홀 가격 1190000원/g)).toHaveLength(2);
    expect(html).toContain('쉬어 갑니다.'); expect(html).toContain('쉬어갑니다.');
    result.paragraphs[0]!.reverted = true;
    expect(render()).toContain('원문 사용 · 직접 되돌림');
  });
  it('shows login wait and original text after unavailable transport', async () => {
    const product = fixtureProduct('<p>사용할 원문 문장입니다.</p>', 0);
    const result = await polishContent(parseContents(product.contentsHtml), product, async () => { throw Error('AI_LOGIN_REQUIRED'); });
    const html = renderToStaticMarkup(createElement(PolishComparison, { result, busy: true, onOpen() {}, onRetry() {}, onRevert() {} }));
    expect(html).toContain('사용자 로그인 대기'); expect(html.match(/사용할 원문 문장입니다./g)).toHaveLength(2); expect(html).toContain('disabled');
  });
  it('distinguishes unchanged answers from rejected numbers, URLs and extra commentary', async () => {
    const product = fixtureProduct('<p>풍경을 보며 편안하게 쉬어 갑니다.</p><p>안내 문장을 확인해 주세요.</p><p>주소 https://example.invalid/info 를 확인하세요.</p><p>주변 풍경을 감상합니다.</p>', 0);
    const answers = ['1. 풍경을 보며 편안하게 쉬어 갑니다.', '1. 안내 문장 2개를 확인해 주세요.', '1. 주소 https://example.invalid/other 를 확인하세요.', '1. 주변 풍경을 감상합니다.\n수정했습니다.'];
    const result = await polishContent(parseContents(product.contentsHtml), product, async () => answers.shift()!);
    const html = renderToStaticMarkup(createElement(PolishComparison, { result, busy: false, onOpen() {}, onRetry() {}, onRevert() {} }));
    for (const label of ['바뀐 곳 없음 1', '다듬음 0', '원문 유지 3', '원문 유지: 숫자가 달라짐', '원문 유지: 주소가 달라짐', '원문 유지: 응답 형식이 맞지 않음']) expect(html).toContain(label);
    expect(html).not.toContain('이 문단 되돌리기');
  });
});
