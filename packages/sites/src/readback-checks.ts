/** Diagnostics contain field names and positions only, never service content. */
export interface ReadbackIssue { field: 'title' | 'text' | 'line_breaks' | 'photos' | 'order' | 'hashtags' | 'links' | 'bold' | 'visibility' | 'stability'; index?: number; paragraph?: number }
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
