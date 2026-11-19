import { compareReadbackText } from '../readback-checks';
import type { RecordedBandReadback } from './record-read';
import { bandBodyIssues, normalizedBandBody } from './posted';
import type { PhotoReadFailure } from './photo-read';

/** Known envelope fields only; never guess an ID from arbitrary response numbers. */
export function bandCreateIdentity(body: string, band: string, onFailure?: (failure: PhotoReadFailure) => void): { succeeded: boolean; post?: string } {
  const value = JSON.parse(body);
  if (value.result_code !== 1) return { succeeded: false };
  const data = value.result_data;
  const fields = [data?.post_key, data?.post_no, data?.post?.post_no].filter(x => x !== undefined && x !== null);
  const ids = fields.map(x => typeof x === 'string' || typeof x === 'number' && Number.isSafeInteger(x) ? String(x) : '');
  const valid = ids.filter(x => /^\d{1,30}$/.test(x));
  const unique = new Set(valid).size;
  if (!ids.length || valid.length !== ids.length || unique !== 1) {
    onFailure?.({ reason: !ids.length ? 'BAND_RESPONSE_NO_IDENTITY' : valid.length !== ids.length ? 'TARGET_TYPE' : 'BAND_POST_IDENTITY_AMBIGUOUS',
      counts: { expected: valid.length !== ids.length ? ids.length : 1, observed: valid.length !== ids.length ? valid.length : unique } });
    return { succeeded: true };
  }
  const parent = data?.band_no ?? data?.post?.band?.band_no;
  if (parent !== undefined && String(parent) !== band) {
    onFailure?.({ reason: 'TARGET_MISMATCH', counts: { expected: 1, observed: 0 } });
    return { succeeded: true };
  }
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
  return bandCreationMismatch(post, match) === undefined;
}

export function bandCreationMismatch(post: RecordedBandReadback, match: BandCreationMatch): PhotoReadFailure | undefined {
  if (!post.owned) return { reason: 'BAND_FEED_OWNER_MISMATCH', counts: { expected: 1, observed: 0 } };
  if (!(post.createdAt >= match.after && post.createdAt <= match.before)) {
    return { reason: 'BAND_FEED_TIME_MISMATCH', counts: { expected: 1, observed: 0 } };
  }
  const expected = identityBody(match.body), observed = identityBody(post.body);
  if (expected !== observed && !(compareReadbackText(match.body.split('\n'), post.body.split('\n')).tolerated && !bandBodyIssues(match.body, post.body, false).length)) {
    return { reason: 'BAND_FEED_BODY_MISMATCH', counts: { expected: expected.length, observed: observed.length, differences: 1 } };
  }
  const counts = { expected: match.uploaded.length, observed: post.photos.length };
  if (post.photos.length > match.uploaded.length || post.photos.length < Math.min(1, match.uploaded.length)) {
    return { reason: 'PHOTO_COUNT_MISMATCH', counts };
  }
  const mismatch = post.photos.findIndex((photo, i) => photo.path !== match.uploaded[i]);
  if (mismatch >= 0) return { reason: 'UPLOAD_PATH_MISMATCH', counts: { ...counts, photoIndex: mismatch + 1, differences: 1 } };
}
