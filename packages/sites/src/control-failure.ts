// Only fixed application identifiers and plan positions may enter a failure code.
const controls = [
  'BLOG_TITLE', 'BLOG_BODY', 'BLOG_IMAGE_BUTTON', 'BLOG_IMAGE_LIST', 'BLOG_TAG_INPUT',
  'BLOG_TABLE_ADD_ROW', 'BLOG_SAVE', 'BLOG_DRAFT_LIST', 'BLOG_DRAFT_ITEM', 'BLOG_PUBLISH', 'BLOG_TAG_PANEL',
  'BLOG_RESTORE_CANCEL', 'BLOG_HELP_CLOSE',
  'BAND_ALL_LIST', 'BAND_WRITE_MOBILE', 'BAND_WRITE_DESKTOP', 'BAND_BODY', 'BAND_PHOTO_BUTTON',
  'BAND_SAVE', 'BAND_DRAFT_LIST', 'BAND_DRAFT_ITEM', 'BAND_BACK', 'BAND_CLOSE', 'BAND_CANCEL', 'BAND_DISCARD',
] as const;
export type ControlId = typeof controls[number];
const kinds = ['TEXT_TITLE', 'TEXT_BODY', 'TEXT_COURSES', 'TEXT_CLOSING', 'TEXT_LINKCARD', 'TEXT_HASHTAGS', 'TEXT_DEPARTURES', 'TEXT', 'BREAK', 'PHOTOS', 'TABLE', 'NONE'] as const;
type PlanStepKind = typeof kinds[number];

export class ControlNotFoundError extends Error {
  readonly control: ControlId;
  readonly planStepKind: PlanStepKind;
  /** One-based plan index. Zero with NONE means the lookup was outside plan execution. */
  readonly planStepIndex: number;
  constructor(control: ControlId, kind: PlanStepKind = 'NONE', index = 0) {
    if (!controls.includes(control) || !kinds.includes(kind) || !Number.isSafeInteger(index) || index < 0) throw new Error('INVALID_CONTROL_DIAGNOSTIC');
    super(`CONTROL_NOT_FOUND:${control}:${kind}:${index}`);
    this.name = 'ControlNotFoundError';
    this.control = control; this.planStepKind = kind; this.planStepIndex = index;
  }
  atPlanStep(index: number, step: { kind: string; role?: string }) {
    // Never interpolate arbitrary role strings, selectors, exactText, URLs or body content.
    const candidate = step.kind === 'text' ? `TEXT_${step.role?.toUpperCase()}` : step.kind.toUpperCase();
    const kind = kinds.find(k => k === candidate) ?? (step.kind === 'text' ? 'TEXT' : 'NONE');
    return new ControlNotFoundError(this.control, kind, index);
  }
}

export function safeFailureCode(error: unknown, fallback: string): string {
  if (error instanceof ControlNotFoundError) return `CONTROL_NOT_FOUND:${error.control}:${error.planStepKind}:${error.planStepIndex}`;
  const code = error instanceof Error ? error.message : '';
  return /^[A-Z_]+(?::[A-Za-z,]+)?$/.test(code) ? code : fallback;
}
