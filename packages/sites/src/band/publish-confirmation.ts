import type { RecordedBandReadback } from './record-read';
import { normalizedBandBody } from './posted';

/** Known envelope fields only; never guess an ID from arbitrary response numbers. */
export function bandCreateIdentity(body: string, band: string): { succeeded: boolean; post?: string } {
  const value = JSON.parse(body);
  if (value.result_code !== 1) return { succeeded: false };
  const data = value.result_data;
  const fields = [data?.post_key, data?.post_no, data?.post?.post_no].filter(x => x !== undefined && x !== null);
  const ids = fields.map(x => typeof x === 'string' || typeof x === 'number' && Number.isSafeInteger(x) ? String(x) : '');
  if (!ids.length || ids.some(x => !/^\d{1,30}$/.test(x)) || new Set(ids).size !== 1) return { succeeded: true };
  const parent = data?.band_no ?? data?.post?.band?.band_no;
  if (parent !== undefined && String(parent) !== band) return { succeeded: true };
  return { succeeded: true, post: ids[0]! };
}
// The feed collapses blank lines. Full detail verification below preserves them.
const identityBody = (body: string) => normalizedBandBody(body).replace(/\s+/g, '');
/** Portable FNV-1a fingerprint; equality below also checks the entire normalized body. */
export function bandBodyHash(body: string) {
  let hash = 2166136261;
  for (const c of identityBody(body)) hash = Math.imul(hash ^ c.codePointAt(0)!, 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
export interface BandCreationMatch { band: string; title: string; body: string; uploaded: readonly string[]; after: number; before: number; }
export function matchesBandCreation(post: RecordedBandReadback, match: BandCreationMatch) {
  return post.owned && post.createdAt >= match.after && post.createdAt <= match.before &&
    bandBodyHash(post.body) === bandBodyHash(match.body) && identityBody(post.body) === identityBody(match.body) &&
    post.photos.length <= match.uploaded.length && post.photos.length >= Math.min(1, match.uploaded.length) &&
    post.photos.every((photo, i) => photo.path === match.uploaded[i]);
}
