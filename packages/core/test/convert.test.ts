import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { assemble, blockText, parseContents, runText } from '../src/convert';
import { compareDocuments, observePlan, verifyPlan } from '../src/verify';
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
  it('expands inline link destinations for band and fails closed on photos inside table cells', () => {
    const product = fixtureProduct('<p>앞 <a href="https://example.invalid/info">안내</a> 뒤</p>', 0);
    expect(observePlan(assemble(product, 'band')).text).toContain('앞 안내 (https://example.invalid/info) 뒤');
    const tableProduct = fixtureProduct('<table><tr><td>앞<img src="http://127.0.0.1:19004/photo-1.png">뒤</td></tr></table>', 1);
    expect(verifyPlan(tableProduct, assemble(tableProduct, 'blog'))).toMatchObject({ matches: false });
  });
  it('preserves table captions and nested table text without interpreting embedded scripts', () => {
    const parsed = parseContents('<table><caption>표 제목</caption><script>tracking()</script><tr><td>바깥<table><tr><td>안쪽</td></tr></table>마지막</td></tr></table>');
    expect(parsed.blocks.map(blockText).join('\n')).toBe('표 제목\n바깥\n안쪽\n마지막');
    expect(parsed.discarded.some(d => d.tag === 'script')).toBe(true);
  });
});
