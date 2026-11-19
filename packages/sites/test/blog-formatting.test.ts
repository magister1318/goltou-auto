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
  it('ignores the observed published-viewer empty paragraph filler without shifting text or photo order', async () => {
    // Sanitized real viewer shape: 58 empty paragraphs acquired one U+200B each.
    const filler = '<p class="se-text-paragraph se-text-paragraph-align- "><span class="se-fs- se-ff-   " style="">\u200b</span></p>';
    const dom = new JSDOM(`<div class="se-documentTitle"><p class="se-text-paragraph">synthetic</p></div><div class="se-main-container">
      <div class="se-component se-text"><p class="se-text-paragraph"><b>first</b></p>${filler.repeat(58)}</div>
      <div class="se-component se-image"><img class="se-image-resource" src="https://example.invalid/goltou-0123456789abcdef-1.jpg"></div>
      <div class="se-component se-text"><p class="se-text-paragraph"><a href="https://example.invalid/a%2Fb">second</a></p>
      <p class="se-text-paragraph">x\u200by</p><p class="se-text-paragraph"> </p><p class="se-text-paragraph">\u200d</p></div></div>`, { runScripts: 'outside-only' });
    try {
      const actual = await readBlogDocument({ evaluateReadOnly: async (source: string) => dom.window.eval(source) } as Surface);
      expect(actual.tokens).toEqual([
        { kind: 'text', text: 'first', runs: [{ text: 'first', bold: true, href: null }] },
        { kind: 'photo', identity: 'goltou-0123456789abcdef-1.jpg' },
        { kind: 'text', text: 'second', runs: [{ text: 'second', bold: false, href: 'https://example.invalid/a%2Fb' }] },
        { kind: 'text', text: 'x\u200by', runs: [{ text: 'x\u200by', bold: false, href: null }] },
        { kind: 'text', text: ' ', runs: [{ text: ' ', bold: false, href: null }] },
        { kind: 'text', text: '\u200d', runs: [{ text: '\u200d', bold: false, href: null }] },
      ]);
    } finally { dom.window.close(); }
  });
  it.each(['bold', 'href', 'text'] as const)('checks %s without blocking on bold or whitespace', field => {
    const observed = normalizeBlogRuns(runs);
    if (field === 'bold') observed[1]!.bold = false;
    if (field === 'href') observed[2]!.href = 'https://example.invalid/wrong';
    if (field === 'text') observed[0]!.text = '가 ';
    const actual = { title: '', tags: [], tokens: [{ kind: 'text' as const, text: observed.map(r => r.text).join(''), runs: observed }] };
    expect(compareBlogFormatting(plan, actual)).toEqual(field === 'href' ? [{ paragraph: 1, fields: ['href'] }] : []);
  });
  it('reads exact data-href only from the observed editable link node, including nested bold text', async () => {
    const dom = new JSDOM('<div class="se-documentTitle"><p class="se-text-paragraph">제목</p></div><div class="se-main-container"><div class="se-component se-text"><p class="se-text-paragraph"><span class="se-link __se-node" data-href="https://example.invalid/a%2Fb?x=1&amp;y=2"><b>문의😀</b></span><span data-href="https://example.invalid/ignored"> 일반</span></p></div></div>', { runScripts: 'outside-only' });
    try {
      const surface = { evaluateReadOnly: async (source: string) => dom.window.eval(source) } as Surface;
      const actual = await readBlogDocument(surface);
      expect(actual.tokens).toEqual([{ kind: 'text', text: '문의😀 일반', runs: [
        { text: '문의😀', bold: true, href: 'https://example.invalid/a%2Fb?x=1&y=2' }, { text: ' 일반', bold: false, href: null },
      ] }]);
    } finally { dom.window.close(); }
  });
  it('refuses missing href evidence, and reports reorder separately from paragraph loss', () => {
    expect(compareBlogFormatting(plan, { title: '', tags: [], tokens: [{ kind: 'text', text: runs.map(r => r.text).join('') }] })).toHaveLength(1);
    const p: BlogPlan = { channel: 'blog', steps: [{ kind: 'text', role: 'body', text: ' 첫째\n둘째 ', runs: [{ text: ' 첫째\n둘째 ', bold: true }] }] };
    const issues = compareBlogFormatting(p, { title: '', tags: [], tokens: [
      { kind: 'text', text: '둘째 ', runs: [{ text: '둘째 ', bold: true }] },
      { kind: 'text', text: ' 첫째', runs: [{ text: ' 첫째', bold: true }] },
    ] });
    expect(issues).toEqual([]);
    expect(safeFailureCode(Error('BLOG_FORMATTING_REOPENED:1,2'), 'FALLBACK')).toBe('BLOG_FORMATTING_REOPENED:1,2');
    expect(safeFailureCode(Error('BLOG_FORMATTING_REOPENED:https://example.invalid'), 'FALLBACK')).toBe('FALLBACK');
  });
});
