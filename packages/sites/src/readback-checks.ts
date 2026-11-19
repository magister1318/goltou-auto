import { trace } from '@goltou/surface/telemetry';

/** Diagnostics contain field names and positions only, never service content. */
export interface ReadbackIssue { field: 'number' | 'cursor' | 'input' | 'href' | 'photo' | 'table' | 'title' | 'text' | 'line_breaks' | 'photos' | 'order' | 'hashtags' | 'links' | 'bold' | 'visibility' | 'stability'; index?: number; paragraph?: number; expected?: number; observed?: number; missing?: boolean }
export class ReadbackMismatch extends Error {
  constructor(code: string, readonly issues: ReadbackIssue[]) { super(code); }
}
export interface ServiceTextToken { text: string; start: number }
export interface ServiceLink extends ServiceTextToken { href: string }
// This is only a coordinate system for derived tokens. Full-body checks remain separate.
export const tokenText = (text: string) => text.replace(/[\s\u200b-\u200d\ufeff]+/g, '');
const canonicalUrl = (text: string) => { try { return new URL(text).href; } catch { return null; } };
/** The service owns autolink boundaries. Its destination must match a prefix at
 * the observed position; punctuation and Korean suffixes remain in the body. */
export function containsServiceLink(planned: string, link: ServiceLink): boolean {
  const text = tokenText(planned), label = tokenText(link.text);
  if (!label || link.start < 0 || text.slice(link.start, link.start + label.length) !== label || !/^https?:\/\//i.test(label)) return false;
  const destination = canonicalUrl(link.href);
  if (!destination) return false;
  for (let end = 8; end <= label.length; end++) if (canonicalUrl(label.slice(0, end)) === destination) return true;
  return false;
}

// Compare Unicode characters. Joiners and variation selectors are characters,
// even when services treat them as part of the preceding glyph.
const visibleText = (value: string) => value.replace(/[\s\u200b\ufeff]+/g, '');
const characters = (value: string) => Array.from(visibleText(value));

/** Bounded Levenshtein distance. Values above the limit are equivalent. */
export function smallEditDistance(a: readonly string[], b: readonly string[], limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = new Map<number, number>();
  for (let j = 0; j <= Math.min(limit, b.length); j++) previous.set(j, j);
  for (let i = 1; i <= a.length; i++) {
    const row = new Map<number, number>();
    if (i <= limit) row.set(0, i);
    for (let j = Math.max(1, i - limit); j <= Math.min(b.length, i + limit); j++) {
      row.set(j, Math.min((previous.get(j) ?? limit) + 1, (row.get(j - 1) ?? limit) + 1, (previous.get(j - 1) ?? limit + 1) + Number(a[i - 1] !== b[j - 1])));
    }
    if ([...row.values()].every(value => value > limit)) return limit + 1;
    previous = row;
  }
  return previous.get(b.length) ?? limit + 1;
}

// Find the numeric facts without consuming their neighboring words or phone
// numbers. Keep occurrence order and distinguish dates from amounts.
export function numberFacts(text: string): string[] {
  const spaced = text.replace(/([0-9])\s+([0-9])(?=[0-9,]*(?:\s*(?:원|달러|바트|엔|동)|\s*[-./년월일]))/g, '$1$2');
  const pattern = /(?:[₩$¥€]\s*\d+(?:,\d+)*(?:\.\d+)?)|(?:\d+(?:,\d+)*(?:\.\d+)?\s*(?:만\s*원|천\s*원|원|달러|바트|엔|동))|(?:\d{4}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2})|(?:(?<![\d-])\d{1,2}\s*[/.-]\s*\d{1,2}(?![\d-]))|(?:(?:\d{2,4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일)|(?:\d{1,4}\s*(?:년|월|일)(?![가-힣]))/g;
  return Array.from(spaced.matchAll(pattern), match => match[0].replace(/[\s,]/g, ''));
}

export function sameReadbackNumbers(expected: string, actual: string): boolean {
  return visibleText(expected) === visibleText(actual) || JSON.stringify(numberFacts(expected)) === JSON.stringify(numberFacts(actual));
}

export function sameReadbackIdentityText(expected: string, actual: string): boolean {
  return !!visibleText(actual) && (expected === actual || compareReadbackText([expected], [actual]).tolerated) &&
    sameReadbackNumbers(expected, actual);
}

export interface TextReadback { missing: number[]; changed: number | null; expected: number; observed: number; tolerated: boolean }

/** Align compact text so editor line wrapping is independent of paragraph edits. */
export function compareReadbackText(expected: readonly string[], actual: readonly string[]): TextReadback {
  const paragraphs = expected.map(characters).filter(text => text.length);
  const observed = actual.flatMap(characters);
  const planned = paragraphs.flat();
  const changedWhitespace = expected.join('\n') !== actual.join('\n');
  const counts = { expected: planned.length, observed: observed.length };
  if (planned.join('') === observed.join('')) return { ...counts, missing: [], changed: 0, tolerated: changedWhitespace };

  const observedText = observed.join('');
  // If full paragraphs account for the entire omission, even a short
  // paragraph counts as missing rather than as a small character edit.
  let position = 0;
  const omitted: number[] = [];
  for (const [index, paragraph] of paragraphs.entries()) {
    const text = paragraph.join('');
    if (observedText.startsWith(text, position)) position += text.length;
    else omitted.push(index + 1);
  }
  if (omitted.length && position === observedText.length) return { ...counts, missing: omitted, changed: planned.length - observed.length, tolerated: false };

  const budget = Math.floor(planned.length / 100);
  let offsets = new Map<number, number>([[0, 0]]);
  for (const paragraph of paragraphs) {
    const next = new Map<number, number>();
    for (const [start, used] of offsets) {
      const limit = Math.min(3, budget - used);
      for (let size = Math.max(1, paragraph.length - limit); size <= paragraph.length + limit && start + size <= observed.length; size++) {
        const edits = smallEditDistance(paragraph, observed.slice(start, start + size), limit);
        if (edits <= limit && used + edits < (next.get(start + size) ?? Infinity)) next.set(start + size, used + edits);
      }
    }
    offsets = next;
    if (!offsets.size) break;
  }
  const edits = offsets.get(observed.length);
  if (edits !== undefined) return { ...counts, missing: [], changed: edits, tolerated: true };

  // Compare actual paragraph boundaries when the aggregate budget was exceeded.
  // Exact neighbors distinguish a removed paragraph from one with changed text.
  const lines = actual.map(visibleText).filter(Boolean);
  const missing: number[] = [];
  if (lines.length < paragraphs.length) {
    let cursor = 0, unmatched = 0;
    for (let i = 0; i <= paragraphs.length; i++) {
      const text = paragraphs[i]?.join('') ?? '';
      const start = text ? observedText.indexOf(text, cursor) : observedText.length;
      if (start < 0) continue;
      if (start === cursor) for (let skipped = unmatched; skipped < i; skipped++) missing.push(skipped + 1);
      cursor = start + text.length; unmatched = i + 1;
    }
  }
  return { ...counts, missing, changed: null, tolerated: false };
}

export function traceReadbackText(result: TextReadback) {
  trace('verification', result.missing.length ? 'fail' : 'ok', {
    check: 'text', reason: result.missing.length ? 'READBACK_TEXT' : result.tolerated ? 'READBACK_TOLERATED' : result.changed ? 'READBACK_TEXT_VARIANCE' : 'READBACK_TEXT',
    counts: { expected: result.expected, observed: result.observed, ...(result.changed === null ? {} : { differences: result.changed }), paragraphs: result.missing.length },
  });
}
