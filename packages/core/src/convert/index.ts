import type { Product } from '@goltou/api-client';
import { productTags } from './post-extras';
import { parseContents } from './html';
import { runText, type ConvertOptions, type InputPlan, type InputStep, type ParsedContent, type Run } from './types';
export * from './types';
export * from './post-extras';
export { parseContents } from './html';

const bandRuns = (runs: readonly Run[]) => runs.map((run, index) => run.text +
  (run.href && runs[index + 1]?.href !== run.href && run.href !== run.text ? ` (${run.href})` : '')).join('');

export function assemble(product: Product, channel: InputPlan['channel'], options: ConvertOptions = {}, parsed: ParsedContent = parseContents(product.contentsHtml)): InputPlan {
  const steps: InputStep[] = [];
  const text = (role: import('./types').Role, value: string, extra: Partial<Extract<InputStep, { kind: 'text' }>> = {}) => {
    steps.push({ kind: 'text', role, text: value, ...extra }, { kind: 'break' });
  };
  const photos = (urls: string[]) => {
    if (!urls.length) return;
    const last = steps[steps.length - 1];
    if (last?.kind === 'photos') last.urls.push(...urls);
    else steps.push({ kind: 'photos', urls });
  };
  text('title', product.title);
  if (options.prefixText) text('prefix', options.prefixText);
  const inBody = new Set(parsed.blocks.filter(b => b.kind === 'image').map(b => b.url));
  photos([...product.images].sort((a, b) => a.order - b.order).filter(i => !inBody.has(i.url)).map(i => i.url));
  for (const block of parsed.blocks) {
    if (block.kind === 'image') photos([block.url]);
    if (block.kind === 'paragraph') {
      const value = channel === 'blog' ? runText(block.runs) : bandRuns(block.runs);
      text('body', value, { runs: block.runs, paragraphId: block.id });
    }
    if (block.kind === 'link') text('body', channel === 'blog' || block.text === block.href ? block.text : `${block.text}\n${block.href}`, { runs: [{ text: block.text, href: block.href }] });
    if (block.kind === 'rule') text('body', '────────');
    if (block.kind === 'table') {
      if (channel === 'blog' && !block.flattened) steps.push({ kind: 'table', role: 'body', rows: block.rows, ...(block.cellRuns ? { cellRuns: block.cellRuns } : {}) }, { kind: 'break' });
      else for (const [index, row] of block.rows.entries()) {
        const cells = block.cellRuns?.[index];
        const runs = cells?.flatMap((cell, column) => [...(column ? [{ text: ' | ' }] : []), ...cell]);
        text('body', channel === 'band' && runs ? bandRuns(runs) : row.join(' | '), { tableRow: row, ...(runs ? { runs } : {}) });
      }
    }
  }
  const rows = product.departures.map(d => [d.date, `${d.price}원`]);
  if (channel === 'blog' && rows.length) steps.push({ kind: 'table', role: 'departures', rows }, { kind: 'break' });
  if (channel === 'band') for (const row of rows) text('departures', row.join(' | '));
  for (const course of product.golfCourses) text('courses', course);
  if (options.linkCard) text('linkCard', product.productUrl);
  if (options.closing && options.closingText) text('closing', options.closingText);
  const hashtags = options.tagWords ? productTags(product, options.tagWords).map(tag => tag.text) : options.hashtags;
  if (hashtags?.length) text('hashtags', hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' '));
  return { channel, steps, discarded: parsed.discarded, notices: parsed.notices };
}
