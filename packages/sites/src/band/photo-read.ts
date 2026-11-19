import { trace, type ReasonCode, type TraceCounts } from '@goltou/surface/telemetry';
import { bandPhotoEvidence, type BandPhotoEvidence } from './photo-path';

export type PhotoReadFailure = { reason: ReasonCode; counts?: TraceCounts };
export type ApiPhotoRead = { photos: BandPhotoEvidence[] } | PhotoReadFailure;
export type PhotoSource = 'band.photo.detail_api' | 'band.photo.cached_feed' | 'band.photo.recovery_feed' | 'band.photo.detail_dom';

export function readApiPhotos(post: { photo_count?: unknown; attachment?: unknown }): ApiPhotoRead {
  const photos = (post.attachment as { photo?: unknown } | undefined)?.photo;
  if (post.photo_count === 0 && photos === undefined) return { photos: [] };
  const declared = typeof post.photo_count === 'number' && Number.isSafeInteger(post.photo_count) && post.photo_count >= 0
    ? post.photo_count : undefined;
  if (photos === undefined) return { reason: 'PHOTO_SOURCE_MISSING', counts: { observed: 0, ...(declared !== undefined ? { expected: declared } : {}) } };
  if (!Array.isArray(photos) || declared === undefined) return { reason: 'PHOTO_PARSE_FAILED' };
  if (declared !== photos.length) return { reason: 'PHOTO_COUNT_MISMATCH', counts: { expected: declared, observed: photos.length } };
  const evidence = photos.map(photo => typeof photo?.photo_url === 'string' ? bandPhotoEvidence(photo.photo_url) : undefined);
  const invalid = evidence.findIndex(photo => photo === undefined);
  if (invalid >= 0) return { reason: 'PHOTO_PATH_UNREADABLE', counts: { photoIndex: invalid + 1, expected: declared, observed: evidence.filter(Boolean).length } };
  return { photos: evidence as BandPhotoEvidence[] };
}

export function tracePhotoSource(source: PhotoSource, expected: number, observed: number, failure?: PhotoReadFailure, attempt?: number) {
  trace(source, failure ? 'fail' : 'ok', {
    reason: failure?.reason ?? 'PHOTO_SOURCE_READ',
    counts: { expected, observed, photoTotal: expected, ...failure?.counts, ...(attempt !== undefined ? { attempt } : {}) },
  });
}
