import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { blockText, runText, type Block, type Discard, type ParsedContent, type Run } from './types';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
const containers = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'ul', 'ol', 'figure', 'figcaption']);
const forbidden = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'input', 'meta', 'link']);
const attr = (node: Element, name: string) => node.attrs.find(a => a.name === name)?.value ?? '';
export function parseContents(html: string): ParsedContent {
  const document = parseFragment(html, { sourceCodeLocationInfo: true });
  const blocks: Block[] = [], discarded: Discard[] = [], notices: string[] = [];
  let runs: Run[] = [], serial = 0, droppedStruckCharacters = 0, removedSinceText = false;
  const struckNodes = new WeakSet<Node>();
  const discard = (node: Node, reason: string) => discarded.push({ reason, tag: 'tagName' in node ? node.tagName : node.nodeName, offset: node.sourceCodeLocation?.startOffset ?? null });
  // Filter before block building so strike on table/row/cell containers is inherited too.
  // Keep images and their positions; record counts/locations, never the omitted text.
  function dropStruckText(node: Node, inherited = false) {
    if ('tagName' in node && forbidden.has(node.tagName)) return;
    const struck = inherited || ('tagName' in node && (['del', 's', 'strike'].includes(node.tagName)
      || /(?:^|;)\s*text-decoration(?:-line)?\s*:[^;]*\bline-through\b/i.test(attr(node, 'style'))));
    if (struck) struckNodes.add(node);
    if (struck && node.nodeName === '#text' && 'value' in node && node.value) {
      droppedStruckCharacters += Array.from(node.value).length;
      discard(node, 'struck-text');
      node.value = '';
    }
    if ('childNodes' in node) for (const child of node.childNodes) dropStruckText(child, struck);
  }
  dropStruckText(document);
  function flush() {
    // HTML collapses ordinary whitespace. Preserve all visible letters, punctuation and line breaks.
    if (runs.length) {
      runs[0]!.text = runs[0]!.text.replace(/^ +/, '');
      runs[runs.length - 1]!.text = runs[runs.length - 1]!.text.replace(/ +$/, '');
      if (runText(runs).trim()) blocks.push({ kind: 'paragraph', id: `p${++serial}`, runs });
      runs = [];
    }
    removedSinceText = false;
  }
  function visit(node: Node, bold = false, href?: string) {
    if (node.nodeName === '#text' && 'value' in node) {
      if (struckNodes.has(node)) { removedSinceText = true; return; }
      let text = node.value.replace(/[\t\n\r\f ]+/g, ' ');
      if (!text) return;
      // Only join spaces across an omission. Other run boundaries keep their spacing.
      if (removedSinceText && runs[runs.length - 1]?.text.endsWith(' ')) text = text.replace(/^ +/, '');
      removedSinceText = false;
      if (!text) return;
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
    if (tag === 'br') { if (!struckNodes.has(node)) { runs.push({ text: '\n' }); removedSinceText = false; } return; }
    if (tag === 'hr') { if (!struckNodes.has(node)) { flush(); blocks.push({ kind: 'rule' }); } return; }
    if (tag === 'table') {
      flush(); let rows: string[][] = [];
      const hasImage = (n: Node): boolean => 'tagName' in n && !forbidden.has(n.tagName) && (n.tagName === 'img' || n.childNodes.some(hasImage));
      const flatten = hasImage(node);
      if (flatten) notices.push('사진이 든 표를 원문 순서의 글자 행과 사진으로 풀어 썼습니다.');
      const flushRows = () => { if (rows.length) { blocks.push({ kind: 'table', rows, ...(flatten ? { flattened: true } : {}) }); rows = []; } };
      function tableWalk(n: Node) {
        if ('tagName' in n && (n.tagName === 'caption' || forbidden.has(n.tagName))) { flushRows(); visit(n); flush(); return; }
        if (n.nodeName === '#comment') { visit(n); return; }
        if ('tagName' in n && n.tagName === 'tr') {
          let row: string[] = [];
          for (const cell of n.childNodes) if ('tagName' in cell && ['td', 'th'].includes(cell.tagName)) {
            const before = blocks.length;
            for (const child of cell.childNodes) visit(child);
            flush(); const cellBlocks = blocks.splice(before);
            if (!flatten) row.push(cellBlocks.map(blockText).filter(Boolean).join('\n'));
            else {
              let text: string[] = [];
              const flushCell = () => { if (text.length) { row.push(text.join('\n')); text = []; } };
              for (const block of cellBlocks) {
                if (block.kind === 'image') {
                  flushCell(); if (row.length) { rows.push(row); row = []; } flushRows(); blocks.push(block);
                } else if (blockText(block)) text.push(blockText(block));
              }
              flushCell();
            }
          }
          if (row.length) rows.push(row);
          if (flatten) flushRows();
          return;
        }
        if ('childNodes' in n) for (const child of n.childNodes) tableWalk(child);
      }
      tableWalk(node); flushRows(); return;
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
  return { blocks, discarded, notices: [...new Set(notices)], droppedStruckCharacters };
}
