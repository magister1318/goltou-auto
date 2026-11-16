import { describe, expect, it } from 'vitest';
import { blogBodyTags, expectedBlogTags, plannedBlogTags, sameBlogTags, type BlogPlan } from '../src';

const plan = (body: string, tags = ''): BlogPlan => ({ channel: 'blog', steps: [
  { kind: 'text', role: 'title', text: '#제목' },
  { kind: 'text', role: 'body', text: body },
  ...(tags ? [{ kind: 'text' as const, role: 'hashtags', text: tags }] : []),
] });

describe('Naver tags derived only from the plan', () => {
  it('merges a hashtag inside link text with explicit tags without changing any source', () => {
    const p = plan('문의 #본문 안내 #본문', '#계획 #본문 #계획');
    const step = p.steps[1];
    if (step?.kind !== 'text') throw new Error('fixture');
    step.runs = [{ text: '문의 ' }, { text: '#본문', bold: true, href: 'https://example.invalid/#주소만' }, { text: ' 안내 #본문' }];
    const before = JSON.stringify(p);
    expect(plannedBlogTags(p)).toEqual(['계획', '본문']);
    expect(blogBodyTags(p)).toEqual(['본문']);
    expect(expectedBlogTags(p)).toEqual(['계획', '본문']);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('uses the observed editor keyword boundaries, punctuation, emoji and UTF-16 truncation', () => {
    expect(blogBodyTags(plan('#첫째,#붙은것 x#중간 .#문장\n.#둘째 #셋째-끝 #_밑줄 #ABC #abc #123 #한글😀뒤 #1️⃣기호')))
      .toEqual(['첫째', '셋째', '_밑줄', 'ABC', 'abc', '123', '한글', '1']);
    expect(blogBodyTags(plan('.#첫째'))).toEqual(['.첫째']);
    // The loaded editor replaces the first emoji, not every emoji in a unit.
    expect(blogBodyTags(plan('#1️⃣기호'))).toEqual([]);
    expect(blogBodyTags(plan('#' + '가'.repeat(101) + ' #' + '가'.repeat(100)))).toEqual(['가'.repeat(100)]);
  });
  it('includes table cell text but excludes title, hrefs and photo addresses', () => {
    const p = plan('일반 본문');
    p.steps.push({ kind: 'table', role: 'body', rows: [['#표태그', '값 #둘째']] }, { kind: 'photos', urls: ['https://example.invalid/#사진'] });
    expect(expectedBlogTags(p)).toEqual(['표태그', '둘째']);
  });
  it('compares the exact set while retaining case and rejecting extra, missing or duplicate chips', () => {
    expect(sameBlogTags(['계획', '본문'], ['본문', '계획'])).toBe(true);
    for (const actual of [['계획'], ['계획', '본문', '외부'], ['계획', '계획'], ['계획', ' 본문'], ['계획', '본문!']]) {
      expect(sameBlogTags(['계획', '본문'], actual)).toBe(false);
    }
    expect(sameBlogTags(['ABC'], ['abc'])).toBe(false);
  });
  it('never drops expected tags to fit the service limit', () => {
    expect(expectedBlogTags(plan(Array.from({ length: 31 }, (_, i) => '#태그' + i).join(' ')))).toHaveLength(31);
  });
});
