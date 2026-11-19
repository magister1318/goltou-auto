import { clickHitRelations, clickHitTags, type ClickHitElement, type ViewportRect } from './index';

export const bandWriteKinds = ['legacyFloating', 'legacyText', 'labelled'] as const;
export const bandWriteHitClasses = ['uFloatingButton', '_btnPostWrite', '_btnOpenWriteLayer', 'cPostWriteEventWrapper', 'postWriteSection', 'lyWrap'] as const;
export const bandWriteHitLabels = ['글쓰기', '닫기', '취소', '게시'] as const;
const hitResults = ['not_checked', 'unavailable', 'match', 'miss', 'error'] as const;

export type BandWriteKind = typeof bandWriteKinds[number];
export interface BandWriteCandidateDiagnostic {
  matches: number;
  visible: number;
  textMatches: number;
  ariaMatches: number;
  inViewport: number;
  eligible: number;
  readClickTarget: typeof hitResults[number];
  scrollX?: number;
  scrollY?: number;
  candidateRect?: ViewportRect;
  rejectedHit?: ClickHitElement;
}
export type BandWriteDiagnostic = Partial<Record<BandWriteKind, BandWriteCandidateDiagnostic>>;

const coordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
function sanitizeRect(rect?: ViewportRect) {
  if (!rect || typeof rect !== 'object') return undefined;
  const { x, y, width, height } = rect;
  if (coordinate(x) && coordinate(y) && coordinate(width) && coordinate(height) && width >= 0 && height >= 0) {
    return { x, y, width, height };
  }
  return undefined;
}

export function sanitizeBandWrite(value: BandWriteDiagnostic) {
  const result: Record<string, unknown> = {};
  for (const kind of bandWriteKinds) {
    const candidate = value[kind];
    if (!candidate || typeof candidate !== 'object') continue;
    const fields: Record<string, unknown> = {};
    for (const key of ['matches', 'visible', 'textMatches', 'ariaMatches', 'inViewport', 'eligible'] as const) {
      const count = candidate[key];
      if (Number.isSafeInteger(count) && count >= 0) fields[key] = count;
    }
    if (hitResults.includes(candidate.readClickTarget)) fields.readClickTarget = candidate.readClickTarget;
    for (const key of ['scrollX', 'scrollY'] as const) {
      if (coordinate(candidate[key])) fields[key] = candidate[key];
    }
    const candidateRect = sanitizeRect(candidate.candidateRect);
    if (candidateRect) fields.candidateRect = candidateRect;
    const hit = candidate.rejectedHit;
    if (hit && typeof hit === 'object') {
      const rect = sanitizeRect(hit.rect);
      fields.rejectedHit = {
        tag: clickHitTags.some(tag => tag === hit.tag) ? hit.tag : '[other]',
        classes: bandWriteHitClasses.filter(name => Array.isArray(hit.classes) && hit.classes.includes(name)),
        ...(hit.ariaLabel ? { ariaLabel: bandWriteHitLabels.some(label => label === hit.ariaLabel) ? hit.ariaLabel : '[other]' } : {}),
        ...(rect ? { rect } : {}),
        ...(clickHitRelations.some(relation => relation === hit.relation) ? { relation: hit.relation } : {}),
      };
    }
    result[kind] = fields;
  }
  return result;
}
