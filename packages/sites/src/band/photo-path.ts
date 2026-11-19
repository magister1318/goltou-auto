import { bandPhotoHosts, type BandPhotoPathShape } from '../../../surface/src/band-photo-diagnostics';

export interface BandPhotoEvidence {
  path: string;
  shape: BandPhotoPathShape;
}

// Band's upload and attachment hosts serve the same /a/<bucket>/<object> path.
// Preserve every component of that path. Only strip the eNNN_std size recipe
// when it is appended to a recognized CDN object name.
const cdnObject = /^\/a\/[a-z0-9]{6}\/[a-z0-9]_[a-z0-9]{22,24}_[a-z0-9]{6}\.(?:jpe?g|png|webp|gif)$/i;
const sizeSuffix = /[._!]e\d{2,4}_std(?=(?:\.(?:jpe?g|png|webp|gif))?$)/i;

export function bandPhotoEvidence(value: string): BandPhotoEvidence | undefined {
  let url: URL;
  try { url = new URL(value.startsWith('//') ? `https:${value}` : value); } catch { return undefined; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const host = bandPhotoHosts.find(value => value === url.hostname) ?? '[other]';
  const candidate = url.pathname.replace(sizeSuffix, '');
  const knownObject = host !== '[other]' && cdnObject.test(candidate);
  return {
    path: knownObject ? candidate : url.pathname,
    shape: {
      host,
      fileTail: knownObject ? url.pathname.slice(-8) : '',
      hasSizeSuffix: candidate !== url.pathname,
    },
  };
}

export function bandPhotoPath(value: string) {
  return bandPhotoEvidence(value)?.path ?? '';
}
