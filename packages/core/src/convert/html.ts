import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { blockText, runText, type Block, type Discard, type ParsedContent, type Run } from './types';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
const containers = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'ul', 'ol', 'figure', 'figcaption']);
const forbidden = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'input', 'meta', 'link']);
const attr = (node: Element, name: string) => node.attrs.find(a => a.name === name)?.value ?? '';
export function parseContents(html: string): ParsedContent {
  const document = parseFragment(html, { sourceCodeLocationInfo: true });
  const blocks: Block[] = [], discarded: Discard[] = [];
  let runs: Run[] = [], serial = 0;
  const discard = (node: Node, reason: string) => discarded.push({ reason, tag: 'tagName' in node ? node.tagName : node.nodeName, offset: node.sourceCodeLocation?.startOffset ?? null });
  function flush() {
    // HTML collapses ordinary whitespace. Preserve all visible letters, punctuation and line breaks.
    if (runs.length) {
      runs[0]!.text = runs[0]!.text.replace(/^ +/, '');
      runs[runs.length - 1]!.text = runs[runs.length - 1]!.text.replace(/ +$/, '');
      if (runText(runs).trim()) blocks.push({ kind: 'paragraph', id: `p${++serial}`, runs });
      runs = [];
    }
  }
  function visit(node: Node, bold = false, href?: string) {
    if (node.nodeName === '#text' && 'value' in node) {
      const text = node.value.replace(/[\t\n\r\f ]+/g, ' ');
      if (!runs.length && !text.trim()) return;
      runs.push({ text, ...(bold ? { bold: true } : {}), ...(href ? { href } : {}) }); return;
    }
    if (!('tagName' in node)) { if (node.nodeName === '#comment') discard(node, 'comment-or-tracking'); return; }
    const tag = node.tagName;
    if (forbidden.has(tag)) { discard(node, 'script-style-or-tracking'); return; }
    for (const a of node.attrs) if (/^on/i.test(a.name) || /^(style|class|data-.+)$/i.test(a.name)) discard(node, `attribute:${a.name}`);
    if (tag === 'img') {
      const src = attr(node, 'src');
      if (!src || (attr(node, 'width') === '1' && attr(node, 'height') === '1') || /(?:google-analytics|doubleclick\.net|\/tracking[/.?])/i.test(src)) { discard(node, 'tracking-or-empty-image'); return; }
      flush(); blocks.push({ kind: 'image', url: src }); return;
    }
    if (tag === 'br') { runs.push({ text: '\n' }); return; }
    if (tag === 'hr') { flush(); blocks.push({ kind: 'rule' }); return; }
    if (tag === 'table') {
      flush(); const rows: string[][] = [];
      function tableWalk(n: Node) {
        if ('tagName' in n && (n.tagName === 'caption' || forbidden.has(n.tagName))) { visit(n); flush(); return; }
        if (n.nodeName === '#comment') { visit(n); return; }
        if ('tagName' in n && n.tagName === 'tr') {
          const row: string[] = [];
          for (const cell of n.childNodes) if ('tagName' in cell && ['td', 'th'].includes(cell.tagName)) {
            const before = blocks.length;
            for (const child of cell.childNodes) visit(child);
            flush(); const cellBlocks = blocks.splice(before);
            row.push(cellBlocks.map(blockText).filter(Boolean).join('\n'));
            // Photos within cells cannot be faithfully represented by this minimal table model.
            // Keep them visible in the plan; verification blocks a changed document order.
            for (const b of cellBlocks) if (b.kind === 'image') { discard(cell, 'unsupported-layout:table-image'); blocks.push(b); }
          }
          rows.push(row); return;
        }
        if ('childNodes' in n) for (const child of n.childNodes) tableWalk(child);
      }
      tableWalk(node); blocks.push({ kind: 'table', rows }); return;
    }
    const boundary = containers.has(tag);
    if (boundary) flush();
    const count = blocks.length;
    let nextHref = href;
    if (tag === 'a') {
      const value = attr(node, 'href');
      if (/^https?:\/\//i.test(value)) nextHref = value;
      else if (value) discard(node, 'unsafe-or-relative-link');
    }
    for (const child of node.childNodes) visit(child, bold || ['b', 'strong'].includes(tag), nextHref);
    if (boundary) {
      flush();
      if (blocks.length === count) discard(node, 'empty-paragraph');
    }
  }
  for (const child of document.childNodes) visit(child);
  flush();
  // An all-link paragraph is also a first-class link block; mixed links retain inline positions.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === 'paragraph' && b.runs[0]?.href && b.runs.every(r => r.href === b.runs[0]!.href) && !b.runs.some(r => r.bold))
      blocks[i] = { kind: 'link', text: runText(b.runs), href: b.runs[0].href };
  }
  return { blocks, discarded };
}
