import type { Product } from '@goltou/api-client';
import { parseContents } from './html';
import { runText, type ConvertOptions, type InputPlan, type InputStep, type ParsedContent } from './types';
export * from './types';
export { parseContents } from './html';

export function assemble(product: Product, channel: InputPlan['channel'], options: ConvertOptions = {}, parsed: ParsedContent = parseContents(product.contentsHtml)): InputPlan {
  const steps: InputStep[] = [];
  const text = (role: 'title' | 'body' | 'courses' | 'closing' | 'linkCard' | 'hashtags' | 'departures', value: string, extra: Partial<Extract<InputStep, { kind: 'text' }>> = {}) => {
    steps.push({ kind: 'text', role, text: value, ...extra }, { kind: 'break' });
  };
  const photos = (urls: string[]) => {
    if (!urls.length) return;
    const last = steps[steps.length - 1];
    if (last?.kind === 'photos') last.urls.push(...urls);
    else steps.push({ kind: 'photos', urls });
  };
  text('title', product.title);
  const inBody = new Set(parsed.blocks.filter(b => b.kind === 'image').map(b => b.url));
  photos([...product.images].sort((a, b) => a.order - b.order).filter(i => !inBody.has(i.url)).map(i => i.url));
  for (const block of parsed.blocks) {
    if (block.kind === 'image') photos([block.url]);
    if (block.kind === 'paragraph') {
      const value = channel === 'blog' ? runText(block.runs) : block.runs.map((r, i) => r.text + (r.href && block.runs[i + 1]?.href !== r.href && r.href !== r.text ? ` (${r.href})` : '')).join('');
      text('body', value, { runs: block.runs, paragraphId: block.id });
    }
    if (block.kind === 'link') text('body', channel === 'blog' || block.text === block.href ? block.text : `${block.text}\n${block.href}`, { runs: [{ text: block.text, href: block.href }] });
    if (block.kind === 'rule') text('body', '────────');
    if (block.kind === 'table') {
      if (channel === 'blog' && !block.flattened) steps.push({ kind: 'table', role: 'body', rows: block.rows }, { kind: 'break' });
      else for (const row of block.rows) text('body', row.join(' | '), { tableRow: row });
    }
  }
  const rows = product.departures.map(d => [d.date, `${d.price}원`]);
  if (channel === 'blog' && rows.length) steps.push({ kind: 'table', role: 'departures', rows }, { kind: 'break' });
  if (channel === 'band') for (const row of rows) text('departures', row.join(' | '));
  for (const course of product.golfCourses) text('courses', course);
  if (options.closing && options.closingText) text('closing', options.closingText);
  if (options.linkCard) text('linkCard', product.productUrl);
  if (options.hashtags?.length) text('hashtags', options.hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' '));
  return { channel, steps, discarded: parsed.discarded, notices: parsed.notices };
}
