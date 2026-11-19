import { clickHitTags, type ClickHitElement } from './index';

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
  rejectedHit?: ClickHitElement;
}
export type BandWriteDiagnostic = Partial<Record<BandWriteKind, BandWriteCandidateDiagnostic>>;

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
    const hit = candidate.rejectedHit;
    if (hit && typeof hit === 'object') fields.rejectedHit = {
      tag: clickHitTags.some(tag => tag === hit.tag) ? hit.tag : '[other]',
      classes: bandWriteHitClasses.filter(name => Array.isArray(hit.classes) && hit.classes.includes(name)),
      ...(hit.ariaLabel ? { ariaLabel: bandWriteHitLabels.some(label => label === hit.ariaLabel) ? hit.ariaLabel : '[other]' } : {}),
    };
    result[kind] = fields;
  }
  return result;
}
