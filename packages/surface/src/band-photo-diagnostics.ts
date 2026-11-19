export const bandPhotoHosts = ['coresos-phinf.pstatic.net', 'coresos.phinf.naver.net'] as const;

export interface BandPhotoPathShape {
  host: typeof bandPhotoHosts[number] | '[other]';
  fileTail: string;
  hasSizeSuffix: boolean;
}

export interface BandPhotoOrderDiagnostic {
  index: number;
  expected: BandPhotoPathShape | null;
  observed: BandPhotoPathShape | null;
}

function sanitizeShape(shape: BandPhotoPathShape | null) {
  if (!shape || typeof shape !== 'object') return null;
  const host = bandPhotoHosts.find(value => value === shape.host) ?? '[other]';
  return {
    host,
    fileTail: host !== '[other]' && typeof shape.fileTail === 'string' && /^[A-Za-z0-9_.!-]{8}$/.test(shape.fileTail) ? shape.fileTail : '',
    hasSizeSuffix: shape.hasSizeSuffix === true,
  };
}

export function sanitizeBandPhotoOrder(value: BandPhotoOrderDiagnostic) {
  if (!Number.isSafeInteger(value.index) || value.index < 1) return undefined;
  return { index: value.index, expected: sanitizeShape(value.expected), observed: sanitizeShape(value.observed) };
}
