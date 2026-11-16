import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import type { Surface } from '@goltou/surface';
import { compareBlogFormatting, normalizeBlogRuns, readBlogDocument, safeFailureCode, splitBlogRuns, type BlogPlan } from '../src';

const runs = [{ text: '가  ' }, { text: '굵게', bold: true }, { text: ' 문의😀', bold: true, href: 'https://example.invalid/a?x=1&b=2#part' }];
const plan: BlogPlan = { channel: 'blog', steps: [{ kind: 'text', role: 'body', text: runs.map(r => r.text).join(''), runs }] };
describe('WP18 exact normalized document runs', () => {
  it('merges adjacent identical formats only, retaining whitespace, zero-width joiners and exact addresses', () => {
    expect(normalizeBlogRuns([{ text: 'a ' }, { text: ' b', bold: false }, { text: '👩‍💻', bold: true }, { text: 'c', href: 'https://example.invalid/a%2fb' }, { text: 'd', href: 'https://example.invalid/a%2Fb' }])).toEqual([
      { text: 'a  b', bold: false, href: null }, { text: '👩‍💻', bold: true, href: null },
      { text: 'c', bold: false, href: 'https://example.invalid/a%2fb' }, { text: 'd', bold: false, href: 'https://example.invalid/a%2Fb' },
    ]);
    expect(splitBlogRuns([{ text: '가\n나', bold: true }, { text: '\n\n다', href: 'https://example.invalid' }])).toHaveLength(4);
  });
  it('reads nested __se-node spans once, semantic and computed bold, and nearest href without rewriting text', async () => {
    const dom = new JSDOM('<div class="se-documentTitle"><p class="se-text-paragraph">제목</p></div><div class="se-main-container"><div class="se-component se-text"><p class="se-text-paragraph"><span class="__se-node">가  <strong><span class="__se-node">굵</span></strong><span style="font-weight:700">게</span><a href="https://example.invalid/a?x=1&amp;b=2#part"><b> 문의😀</b></a></span></p><p class="se-text-paragraph"><span class="se-placeholder">본문</span></p></div></div>', { runScripts: 'outside-only' });
    try {
      const s = { evaluateReadOnly: async (source: string) => dom.window.eval(source) } as Surface;
      const actual = await readBlogDocument(s);
      expect(actual.tokens).toEqual([{ kind: 'text', text: runs.map(r => r.text).join(''), runs: normalizeBlogRuns(runs) }]);
      expect(compareBlogFormatting(plan, actual)).toEqual([]);
    } finally { dom.window.close(); }
  });
  it.each(['bold', 'href', 'text'] as const)('reports %s loss at the correct paragraph even when old compact comparison would match', field => {
    const observed = normalizeBlogRuns(runs);
    if (field === 'bold') observed[1]!.bold = false;
    if (field === 'href') observed[2]!.href = 'https://example.invalid/wrong';
    if (field === 'text') observed[0]!.text = '가 ';
    const actual = { title: '', tags: [], tokens: [{ kind: 'text' as const, text: observed.map(r => r.text).join(''), runs: observed }] };
    expect(compareBlogFormatting(plan, actual)).toContainEqual(expect.objectContaining({ paragraph: 1, fields: expect.arrayContaining([field]) }));
  });
  it('refuses missing run evidence and identifies each reordered paragraph without discarding spaces', () => {
    expect(compareBlogFormatting(plan, { title: '', tags: [], tokens: [{ kind: 'text', text: runs.map(r => r.text).join('') }] })).toHaveLength(1);
    const p: BlogPlan = { channel: 'blog', steps: [{ kind: 'text', role: 'body', text: ' 첫째\n둘째 ', runs: [{ text: ' 첫째\n둘째 ', bold: true }] }] };
    const issues = compareBlogFormatting(p, { title: '', tags: [], tokens: [
      { kind: 'text', text: '둘째 ', runs: [{ text: '둘째 ', bold: true }] },
      { kind: 'text', text: ' 첫째', runs: [{ text: ' 첫째', bold: true }] },
    ] });
    expect(issues.map(i => i.paragraph)).toEqual([1, 2]);
    expect(safeFailureCode(Error('BLOG_FORMATTING_REOPENED:1,2'), 'FALLBACK')).toBe('BLOG_FORMATTING_REOPENED:1,2');
    expect(safeFailureCode(Error('BLOG_FORMATTING_REOPENED:https://example.invalid'), 'FALLBACK')).toBe('FALLBACK');
  });
});
