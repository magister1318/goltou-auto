import { describe, expect, it } from 'vitest';
import { assemble, blockText, parseContents } from '../src/convert';
import { conversionMetric } from '../src/conversion-audit';
import { makePreview, preparePreview } from '../src/preparation';
import { compareDocuments, observePlan, observeSource, verifyPlan } from '../src/verify';
import { fixtureProduct } from './fixtures/catalog';

describe('mandatory struck text omission', () => {
  it.each([
    ['del', '<del>옛 가격 990000원</del>'],
    ['s', '<s>옛 가격 990000원</s>'],
    ['strike', '<strike>옛 가격 990000원</strike>'],
    ['nested tags', '<del>옛 <s>가격 <strike>990000원</strike></s></del>'],
    ['decoration shorthand', '<span style="color:red; text-decoration: underline line-through solid red">옛 가격 990000원</span>'],
    ['decoration line', '<span style="TEXT-DECORATION-LINE : overline LINE-THROUGH !important">옛 가격 990000원</span>'],
    ['nested style', '<span style="text-decoration:line-through">옛 <b style="text-decoration:none">가격 990000원</b></span>'],
  ])('omits %s text and its digits in both channels', (_label, struck) => {
    const html = `<p>현재 ${struck} 18홀 1200000원</p>`;
    const product = fixtureProduct(html, 0), parsed = parseContents(html);
    expect(parsed.blocks.map(blockText)).toEqual(['현재 18홀 1200000원']);
    expect(parsed.droppedStruckCharacters).toBe(Array.from('옛 가격 990000원').length);
    expect(observeSource(html)).toMatchObject({ text: '현재18홀1200000원', photos: [] });
    for (const channel of ['blog', 'band'] as const) {
      const plan = assemble(product, channel, {}, parsed);
      expect(observePlan(plan)).toMatchObject({ paragraphs: ['현재 18홀 1200000원'], prices: ['1190000', '1250000'], departures: ['2026-12-03', '2026-12-10'] });
      expect(verifyPlan(product, plan)).toMatchObject({ matches: true, differences: [] });
    }
    const metric = conversionMetric(product);
    expect(metric).toMatchObject({ struckNumericCharacters: 6, droppedStruckCharacters: 12, failureCode: null });
    for (const channel of ['blog', 'band'] as const) expect(metric[channel]).toMatchObject({ numbersPreserved: true, pricesPreserved: true, datesPreserved: true, sourceMatches: true });
    expect(JSON.stringify(metric)).not.toContain('990000');
  });

  it('drops newly empty paragraphs and struck line breaks without dropping a partial paragraph', () => {
    const html = '<p><del>옛 2026-11-01<br><s>990000원</s></del></p><p style="text-decoration-line:line-through">전부 제외</p><p>남은 <strike>옛 안내<br>다음 줄</strike> 안내</p><p>끝</p>';
    const parsed = parseContents(html), preview = makePreview(fixtureProduct(html, 0), {});
    expect(parsed.blocks.map(blockText)).toEqual(['남은 안내', '끝']);
    expect(parsed.discarded.filter(d => d.reason === 'empty-paragraph')).toHaveLength(2);
    expect(parsed.discarded.some(d => d.reason === 'struck-text')).toBe(true);
    expect(preview.droppedStruckCharacters).toBe(parsed.droppedStruckCharacters);
    for (const channel of ['blog', 'band'] as const) expect(preview.verification[channel]).toMatchObject({ matches: true, counts: { paragraphs: 2 } });
  });

  it('collapses only spaces joined by a removal, retaining unrelated run spacing and formatting', () => {
    const parsed = parseContents('<p>기존 <b> </b> 간격 / 앞 <del>옛</del><b> </b><i>뒤</i> / 붙<del>옛</del>임</p>');
    expect(parsed.blocks.map(blockText)).toEqual(['기존   간격 / 앞 뒤 / 붙임']);
    const formatted = parseContents('<p><b>앞 </b><s>옛 9</s><a href="https://example.invalid/info"> 뒤</a></p>');
    expect(formatted.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: '앞 ', bold: true }, { text: '뒤', href: 'https://example.invalid/info' }] });
  });

  it('retains spaces already duplicated on either side of an omission', () => {
    expect(parseContents('<p>앞<del>옛</del> <b> </b>뒤</p>').blocks.map(blockText)).toEqual(['앞  뒤']);
    expect(parseContents('<p>앞 <b> </b><del>옛</del> 뒤</p>').blocks.map(blockText)).toEqual(['앞  뒤']);
    expect(parseContents('<p>앞 <del>옛</del> <b> </b>뒤</p>').blocks.map(blockText)).toEqual(['앞  뒤']);
    expect(parseContents('<p>앞 <del>옛</del> <s>옛</s> 뒤</p>').blocks.map(blockText)).toEqual(['앞 뒤']);
  });

  it.each(['del', 'span style="text-decoration: line-through"'])('keeps an image inside %s in its original position', opening => {
    const tag = opening.split(' ')[0];
    const html = `<p>사진 앞</p><${opening}>옛 999<img src="http://127.0.0.1:19004/photo-1.png">옛 날짜 2026-01-01</${tag}><p>사진 뒤</p>`;
    const product = fixtureProduct(html, 1), parsed = parseContents(html);
    expect(parsed.blocks.map(b => b.kind === 'image' ? b.url : blockText(b))).toEqual(['사진 앞', product.images[0]!.url, '사진 뒤']);
    expect(observeSource(html).order).toEqual([{ kind: 'text', value: '사진앞' }, { kind: 'image', value: product.images[0]!.url }, { kind: 'text', value: '사진뒤' }]);
    for (const channel of ['blog', 'band'] as const) expect(verifyPlan(product, assemble(product, channel))).toMatchObject({ matches: true, counts: { photos: 1 } });
  });

  it('inherits strike on tables, rows, cells and captions while retaining nested images', () => {
    const html = '<table style="text-decoration:line-through"><caption>옛 표 9</caption><tr><td>옛 셀<img src="http://127.0.0.1:19004/photo-1.png">999</td></tr></table><table><tr style="text-decoration-line:line-through"><td>옛 행 8</td></tr><tr><td style="text-decoration:line-through">옛 셀 7</td><td>유효 18</td></tr></table>';
    const product = fixtureProduct(html, 1);
    expect(observeSource(html)).toMatchObject({ text: '유효18', photos: [product.images[0]!.url], tableCells: ['', '', '', '유효18'] });
    for (const channel of ['blog', 'band'] as const) {
      const plan = assemble(product, channel);
      expect(observePlan(plan).text).not.toMatch(/옛|999/);
      expect(verifyPlan(product, plan)).toMatchObject({ matches: true });
    }
  });

  it('counts decoded Unicode characters once, ignoring attributes and non-content subtrees', () => {
    const html = '<p><del title="999">가 &amp; <s>😀1</s><script>1234</script><style>.x{}</style></del></p>';
    const parsed = parseContents(html);
    expect(parsed.droppedStruckCharacters).toBe(6); // 가, space, &, space, 😀, 1
    expect(parsed.blocks).toEqual([]);
    expect(conversionMetric(fixtureProduct(html, 0))).toMatchObject({ struckNumericCharacters: 1, droppedStruckCharacters: 6 });
    expect(JSON.stringify(parsed)).not.toMatch(/가|😀|1234/);
  });

  it('keeps non-struck decorations and API facts, even when body strike has identical prices/dates', () => {
    const html = '<p><del>1190000원 2026-12-03</del><span style="text-decoration:underline">현재 1250000원</span> <samp style="--text-decoration:line-through; text-decoration-color:red">출발 2026-12-10</samp></p>';
    const product = fixtureProduct(html, 0), preview = makePreview(product, {});
    for (const channel of ['blog', 'band'] as const) {
      expect(observePlan(preview[channel])).toMatchObject({ paragraphs: ['현재 1250000원 출발 2026-12-10'], prices: ['1190000', '1250000'], departures: ['2026-12-03', '2026-12-10'] });
      expect(preview.verification[channel].matches).toBe(true);
    }
  });

  it.each([
    '<del>옛 990000원 2026-11-01</del>',
    '<s>옛 990000원 2026-11-01</s>',
    '<strike>옛 990000원 2026-11-01</strike>',
    '<span style="text-decoration:line-through">옛 990000원 2026-11-01</span>',
    '<span style="text-decoration-line:underline line-through">옛 990000원 2026-11-01</span>',
  ])('independently rejects a faulty converter retaining %s', struck => {
    const product = fixtureProduct(`<p>현재 ${struck} 18홀</p>`, 0);
    // Reproduce a converter regression, including the faulty approved blocks and count.
    const faulty = parseContents('<p>현재 옛 990000원 2026-11-01 18홀</p>');
    for (const channel of ['blog', 'band'] as const) {
      const plan = assemble(product, channel, {}, faulty);
      expect(compareDocuments(observePlan(plan), observePlan(assemble(product, channel, {}, faulty))).matches).toBe(true);
      const result = verifyPlan(product, plan, {}, faulty);
      expect(result.matches).toBe(false);
      expect(result.differences.map(d => d.field)).toEqual(expect.arrayContaining(['sourceText', 'sourceOrder']));
      expect(makePreview(product, {}, faulty).verification[channel].matches).toBe(false);
    }
  });

  it('never sends omitted text to optional polishing or restores it when options change', async () => {
    const product = fixtureProduct('<p>소개 <del>옛 990000원</del> 안내입니다.</p>', 0);
    const requests: string[] = [];
    const preview = await preparePreview(product, { polish: true }, async request => { requests.push(request); return '1. 소개 안내입니다.'; });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toContain('990000');
    expect(preview.droppedStruckCharacters).toBe(9);
    const next = makePreview(product, { closing: true, closingText: '끝 문구', linkCard: true }, undefined, preview.polish, ['p1']);
    expect(next.droppedStruckCharacters).toBe(9);
    for (const channel of ['blog', 'band'] as const) {
      expect(observePlan(next[channel]).text).not.toContain('990000');
      expect(next.verification[channel].matches).toBe(true);
    }
  });
});
