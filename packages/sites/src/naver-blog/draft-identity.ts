import type { GuardedResponse, Surface } from '@goltou/surface';
import { click, read, waitFor } from '../dom';

/** Ephemeral list evidence only. Never put titles, dates or draft IDs in logs. */
export interface DraftEntry { title: string; stamp: string; id: string }
const list = '[aria-label="임시저장된 글"]';
export const draftItem = `${list} > li button[data-click-area="tpb*s.tlist"]`;
export async function draftEntries(surface: Surface): Promise<DraftEntry[]> {
  return read(surface, `return docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(draftItem)})).filter(visible).map(e=>({
    title:(e.querySelector('strong')?.textContent||'').trim(),
    stamp:(e.querySelector('time')?.getAttribute('datetime')||e.querySelector('time,span[class^="date__"]')?.textContent||'').trim(),
    id:e.getAttribute('data-log-no')||''})));`);
}
export async function openDraftEntries(surface: Surface, emptyAllowed = false) {
  const opened = () => read<boolean>(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(list)})).some(visible));`);
  if (!await opened()) {
    if (emptyAllowed && await read<boolean>(surface, `return docs.some(({d})=>d.querySelector('button[data-click-area="tpb*s.count"]')?.textContent.trim()==='0');`)) return [];
    await click(surface, 'BLOG_DRAFT_LIST', 'button[data-click-area="tpb*s.count"]');
  }
  await waitFor(opened);
  return draftEntries(surface);
}
export async function closeDraftEntries(surface: Surface) {
  if (await read<boolean>(surface, `return docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(list)})).some(visible));`)) {
    await click(surface, 'BLOG_DRAFT_CLOSE', 'button[data-click-area="tpb*s.close"]');
    await waitFor(() => read(surface, `return !docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(list)})).some(visible));`));
  }
}
const key = (entry: DraftEntry) => JSON.stringify([entry.title, entry.stamp, entry.id]);
/** No title-only, list-order or newest-of-equal-candidates fallback. */
export function identifySavedDraft(before: readonly DraftEntry[], after: readonly DraftEntry[], title: string, responseId?: string) {
  if (responseId && after.some(e => e.id)) {
    const matches = after.flatMap((e, index) => e.title === title && e.id === responseId ? [index] : []);
    if (matches.length === 1 && !before.some(e => e.id === responseId)) return { index: matches[0]!, source: 'response-id' as const };
    return null;
  }
  const old = new Set(before.map(key));
  const candidates = after.flatMap((e, index) => e.title === title && (e.stamp || e.id) && !old.has(key(e)) ? [index] : []);
  if (candidates.length !== 1) return null;
  return { index: candidates[0]!, source: 'list-change' as const };
}
export function draftSaveReceipt(response: GuardedResponse): { saved: boolean; id?: string } {
  if (response.status < 200 || response.status >= 300) return { saved: false };
  try {
    const data = JSON.parse(response.body);
    if (data?.isSuccess !== true) return { saved: false };
    const id: unknown = data.result?.logNo;
    return { saved: true, ...(typeof id === 'string' && /^\d+$/.test(id) || typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? { id: String(id) } : {}) };
  } catch { return { saved: false }; }
}
