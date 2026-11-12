import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { assemble, blockText, parseContents, runText } from '../src/convert';
import { compareDocuments, observePlan, observeSource, verifyPlan } from '../src/verify';
import { makePreview } from '../src/preparation';
import { fixtureCases, fixtureProduct } from './fixtures/catalog';

describe('WP4 synthetic HTML conversion', () => {
  for (const fixture of fixtureCases) it(`${fixture.name}: source, blog and band agree`, async () => {
    const html = await readFile(new URL(`./fixtures/${fixture.name}.html`, import.meta.url), 'utf8');
    const parsed = parseContents(html), product = fixtureProduct(html, fixture.photos);
    expect(parsed.blocks.filter(b => b.kind === 'paragraph')).toHaveLength(fixture.paragraphs);
    expect(parsed.blocks.filter(b => b.kind === 'image')).toHaveLength(fixture.photos);
    expect(parsed.blocks.filter(b => b.kind === 'table')).toHaveLength(fixture.tables);
    for (const channel of ['blog', 'band'] as const) {
      const plan = assemble(product, channel);
      expect(verifyPlan(product, plan)).toMatchObject({ matches: true, counts: { photos: fixture.photos, prices: 2, departures: 2 } });
      expect(plan.steps.some(s => s.kind === 'text' && s.role === 'closing')).toBe(false);
      expect(plan.steps.some(s => s.kind === 'text' && s.role === 'linkCard')).toBe(false);
      const observation = observePlan(plan);
      expect(observation.prices).toEqual(['1190000', '1250000']);
      expect(observation.departures).toEqual(['2026-12-03', '2026-12-10']);
      expect(observation.golfCourses).toEqual(['예시CC']);
    }
    if (fixture.name === 'table') expect(parsed.blocks.find(b => b.kind === 'table')).toMatchObject({ rows: [['항목', '내용'], ['이동', '전용 차량'], ['숙소', '예시 호텔']] });
    if (fixture.name === 'messy') {
      expect(parsed.blocks.map(blockText).join('')).toContain('원문의 안내 & 조건입니다.그대로 옮기는 중요 문장입니다.\n줄바꿈도 남깁니다.');
      expect(parsed.discarded.map(d => d.reason)).toContain('tracking-or-empty-image');
      expect(parsed.discarded.filter(d => d.reason === 'script-style-or-tracking')).toHaveLength(2);
    }
    if (fixture.name === 'long') expect(parsed.blocks.map(blockText).join('').length).toBeGreaterThan(12000);
  });
  it('preserves cursor positions, grouping only adjacent photos', async () => {
    const html = await readFile(new URL('./fixtures/interleaved.html', import.meta.url), 'utf8');
    const plan = assemble(fixtureProduct(html, 3), 'blog');
    expect(plan.steps.filter(s => s.kind === 'text' || s.kind === 'photos').slice(1, 6).map(s => s.kind === 'photos' ? `photos:${s.urls.length}` : s.kind === 'text' ? s.text : '')).toEqual(['첫 안내입니다.', 'photos:1', '사진 사이 안내입니다.', 'photos:2', '마지막 안내입니다.']);
  });
  it('detects same-length number mutation, missing paragraphs, image order and changed API facts', () => {
    const product = fixtureProduct('<p>원문 숫자 18홀입니다.</p><p>둘째 문단</p>', 2);
    const plan = assemble(product, 'blog');
    const before = observePlan(plan), changed = structuredClone(before);
    changed.text = changed.text.replace('18', '19');
    changed.paragraphs[0] = changed.paragraphs[0]!.replace('18', '19');
    changed.photos.reverse(); changed.prices[0] = '1190001'; changed.departures[0] = '2026-12-04'; changed.golfCourses[0] = '다른CC';
    expect(compareDocuments(before, changed).differences.map(d => d.field)).toEqual(expect.arrayContaining(['text', 'paragraphs', 'photos', 'prices', 'departures', 'golfCourses']));
    changed.paragraphs.pop(); expect(compareDocuments(before, changed).differences.some(d => d.field === 'paragraphCount')).toBe(true);
    const table = plan.steps.find(s => s.kind === 'table' && s.role === 'departures');
    if (table?.kind === 'table') table.rows[0]![1] = '1190001원';
    expect(verifyPlan(product, plan).matches).toBe(false);
  });
  it('uses original title, API-only facts and explicit closing/link options', () => {
    const product = fixtureProduct('<p>소개</p>', 0);
    const plain = assemble(product, 'band'), extra = assemble(product, 'band', { closing: true, closingText: '끝 문구', linkCard: true, hashtags: ['예시'] });
    expect(observePlan(plain).title).toBe(product.title);
    expect(observePlan(plain).text).not.toContain(product.productUrl);
    expect(observePlan(extra).text).toContain(product.productUrl);
    expect(observePlan(extra).text).toContain('끝 문구\nhttps://example.invalid/product/4\n#예시');
    const bold = parseContents('<p>앞 <b>강조</b><br>뒤</p>').blocks[0];
    expect(bold?.kind === 'paragraph' && runText(bold.runs)).toBe('앞 강조\n뒤');
    expect(bold?.kind === 'paragraph' && bold.runs.some(r => r.bold)).toBe(true);
  });
  it('blocks a body image not present in API instead of silently skipping it', () => {
    const product = fixtureProduct('<p>소개</p><img src="https://unlisted.invalid/a.png">', 0);
    expect(verifyPlan(product, assemble(product, 'blog'))).toMatchObject({ matches: false });
  });
  it('expands inline link destinations for band', () => {
    const product = fixtureProduct('<p>앞 <a href="https://example.invalid/info">안내</a> 뒤</p>', 0);
    expect(observePlan(assemble(product, 'band')).text).toContain('앞 안내 (https://example.invalid/info) 뒤');
  });
  it.each(['blog', 'band'] as const)('flattens photo tables into text rows and photos in source order: %s', channel => {
    const html = '<p>표 앞</p><table><caption>표 제목</caption><tr><td>첫 셀</td><td>사진 앞<img src="http://127.0.0.1:19004/photo-1.png">사진 뒤</td><td>옆 셀</td></tr><tr><td><table><tr><td>중첩 앞<img src="http://127.0.0.1:19004/photo-2.png">중첩 뒤</td></tr></table></td><td>끝 셀</td></tr><caption>표 끝</caption></table><p>표 뒤</p>';
    const product = fixtureProduct(html, 2), parsed = parseContents(html);
    const plan = assemble(product, channel, {}, parsed);
    expect(plan.steps.filter(s => s.kind === 'text' && s.role === 'body' || s.kind === 'photos').map(s => s.kind === 'photos' ? s.urls : s.kind === 'text' ? s.text : '')).toEqual([
      '표 앞', '표 제목', '첫 셀 | 사진 앞', ['http://127.0.0.1:19004/photo-1.png'], '사진 뒤 | 옆 셀', '중첩 앞', ['http://127.0.0.1:19004/photo-2.png'], '중첩 뒤 | 끝 셀', '표 끝', '표 뒤',
    ]);
    expect(plan.steps.some(s => s.kind === 'table' && s.role === 'body')).toBe(false);
    const result = verifyPlan(product, plan);
    expect(result).toMatchObject({ matches: true, differences: [] });
    expect(result.notices).toHaveLength(1);
    expect(result.message).toContain('안내: 사진이 든 표');
    expect(parsed.discarded.some(d => d.reason.startsWith('unsupported-layout:'))).toBe(false);
  });
  it.each(['drop paragraph', 'drop run', 'reorder paragraphs', 'drop cell', 'reorder cells', 'move cell to paragraph', 'drop image', 'move image'] as const)('independently detects builder faults even with the same faulty parsed blocks: %s', fault => {
    const html = '<p>첫 문단 <b>보존할 글자</b></p><table><tr><td>첫째 셀</td><td>둘째 셀</td></tr></table><img src="http://127.0.0.1:19004/photo-1.png"><p>마지막 문단</p>';
    const product = fixtureProduct(html, 1), parsed = parseContents(html);
    const table = parsed.blocks.find(b => b.kind === 'table');
    if (fault === 'drop paragraph') parsed.blocks.shift();
    if (fault === 'drop run' && parsed.blocks[0]?.kind === 'paragraph') parsed.blocks[0].runs.pop();
    if (fault === 'reorder paragraphs') [parsed.blocks[0], parsed.blocks[3]] = [parsed.blocks[3]!, parsed.blocks[0]!];
    if (fault === 'drop cell' && table?.kind === 'table') table.rows[0]!.pop();
    if (fault === 'reorder cells' && table?.kind === 'table') table.rows[0]!.reverse();
    if (fault === 'move cell to paragraph' && table?.kind === 'table' && parsed.blocks[0]?.kind === 'paragraph') parsed.blocks[0].runs.push({ text: table.rows[0]!.shift()! });
    if (fault === 'drop image') parsed.blocks.splice(2, 1);
    if (fault === 'move image') parsed.blocks.unshift(parsed.blocks.splice(2, 1)[0]!);
    // A parser's own discard record must never waive the independent audit.
    parsed.discarded.push({ reason: 'empty-paragraph', tag: 'p', offset: 0 });
    for (const channel of ['blog', 'band'] as const) {
      const plan = assemble(product, channel, {}, parsed);
      expect(compareDocuments(observePlan(plan), observePlan(assemble(product, channel, {}, parsed))).matches).toBe(true);
      const result = verifyPlan(product, plan, {}, parsed);
      expect(result.matches).toBe(false);
      expect(result.differences.some(d => d.field.startsWith('source'))).toBe(true);
      expect(makePreview(product, {}, parsed).verification[channel].matches).toBe(false);
    }
  });
  it('observes visible text, ordered original images and nested cell text directly from HTML', () => {
    expect(observeSource('<script>버릴 코드</script><!-- 추적 --><p>A &amp; B</p><table><tr><td>C<table><tr><td>D</td></tr></table>E<img src="https://example.invalid/original.png"></td><td>F</td></tr></table><img width="1" height="1" src="https://example.invalid/pixel">')).toMatchObject({
      text: 'A&BCDEF', photos: ['https://example.invalid/original.png'], tableCells: ['CDE', 'D', 'F'],
      order: [{ kind: 'text', value: 'A&BCDE' }, { kind: 'image', value: 'https://example.invalid/original.png' }, { kind: 'text', value: 'F' }],
    });
  });
  it('preserves table captions and nested table text without interpreting embedded scripts', () => {
    const parsed = parseContents('<table><caption>표 제목</caption><script>tracking()</script><tr><td>바깥<table><tr><td>안쪽</td></tr></table>마지막</td></tr></table>');
    expect(parsed.blocks.map(blockText).join('\n')).toBe('표 제목\n바깥\n안쪽\n마지막');
    expect(parsed.discarded.some(d => d.tag === 'script')).toBe(true);
  });
});
