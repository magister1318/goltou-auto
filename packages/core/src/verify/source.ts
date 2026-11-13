import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { InputPlan } from '../convert/types';

type Node = DefaultTreeAdapterMap['node'];
type Event = { kind: 'text' | 'image'; value: string };
export interface SourceObservation { text: string; photos: string[]; tableCells: string[]; order: Event[] }
const letters = (value: string) => value.replace(/[\s\u200b-\u200d\ufeff]+/gu, '');
function append(order: Event[], kind: Event['kind'], value: string) {
  if (kind === 'text') value = letters(value);
  if (!value) return;
  const last = order[order.length - 1];
  if (kind === 'text' && last?.kind === 'text') last.value += value;
  else order.push({ kind, value });
}

/** Independent audit: only walk original HTML nodes, never converter blocks or discard records.
 * Allowed omissions: comments, script/style/non-content embed/form metadata subtrees,
 * empty/1x1/known tracking images, and whitespace. Attributes are not visible text.
 * Keep this intentionally separate from convert/html.ts so block-builder faults are observable.
 */
export function observeSource(html: string): SourceObservation {
  const order: Event[] = [], tableCells: string[] = [], activeCells: number[] = [];
  const ignored = /^(script|style|iframe|object|embed|noscript|template|input|meta|link)$/;
  const text = (value: string) => {
    append(order, 'text', value);
    for (const index of activeCells) tableCells[index] += value;
  };
  function walk(node: Node) {
    if ('value' in node && node.nodeName === '#text') { text(node.value); return; }
    if (!('tagName' in node) || ignored.test(node.tagName)) return;
    const tag = node.tagName;
    if (tag === 'img') {
      const attrs = Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
      const url = attrs.src;
      if (url && !(attrs.width === '1' && attrs.height === '1') && !/(?:google-analytics|doubleclick\.net|\/tracking[/.?])/i.test(url)) append(order, 'image', url);
      return;
    }
    const cell = tag === 'td' || tag === 'th';
    if (cell) { activeCells.push(tableCells.length); tableCells.push(''); }
    if (tag === 'hr') text('────────');
    for (const child of node.childNodes) walk(child);
    if (cell) activeCells.pop();
  }
  for (const node of parseFragment(html).childNodes) walk(node);
  return { text: order.filter(e => e.kind === 'text').map(e => e.value).join(''), photos: order.filter(e => e.kind === 'image').map(e => e.value), tableCells: tableCells.map(letters), order };
}

/** Project actual input text, removing only verified, generated link/row delimiters.
 * Metadata alone is never accepted as proof of what the plan will type.
 */
export function observePlanSource(plan: InputPlan, leadingPhotos: readonly string[]): SourceObservation {
  const order: Event[] = [], tableCells: string[] = [];
  let leading = 0;
  for (const step of plan.steps) {
    if (step.kind === 'photos') {
      for (const url of step.urls) {
        if (leading < leadingPhotos.length && url === leadingPhotos[leading]) leading++;
        else append(order, 'image', url);
      }
    } else if (step.kind !== 'break' && step.role === 'body') {
      if (step.kind === 'table') {
        tableCells.push(...step.rows.flat().map(letters));
        append(order, 'text', step.rows.flat().join(''));
      } else {
        let value = step.text;
        if (step.tableRow && value === step.tableRow.join(' | ')) {
          tableCells.push(...step.tableRow.map(letters)); value = step.tableRow.join('');
        } else if (step.runs) {
          const plain = step.runs.map(r => r.text).join('');
          const inline = step.runs.map((r, i) => r.text + (r.href && step.runs![i + 1]?.href !== r.href && r.href !== r.text ? ` (${r.href})` : '')).join('');
          const link = step.runs.length === 1 && step.runs[0]!.href ? `${plain}\n${step.runs[0]!.href}` : plain;
          if (value === plain || (plan.channel === 'band' && (value === inline || value === link))) value = plain;
        }
        append(order, 'text', value);
      }
    }
  }
  return { text: order.filter(e => e.kind === 'text').map(e => e.value).join(''), photos: order.filter(e => e.kind === 'image').map(e => e.value), tableCells, order };
}
