import { clickHitTags } from './index';

export const blogTagClassPrefixes = ['set_option_detail', 'tag_textarea', 'tag_input', 'tag', 'publish_btn', 'publish'] as const;
const hitTags = clickHitTags.filter(tag => tag !== '[other]').map(tag => tag.toUpperCase());
const hitNames = new Set(['[none]', '[other]', ...hitTags,
  ...hitTags.flatMap(tag => blogTagClassPrefixes.map(prefix => `${tag}.${prefix}`))]);
const phases = ['before_click', 'after_click', 'click_target', 'key_focus', 'input_before', 'input_after', 'required_focus'] as const;

export interface BlogTagDiagnostic {
  phase: typeof phases[number];
  hit?: string;
  clientHeight?: number;
  scrollHeight?: number;
  scrollTop?: number;
  chips?: number;
  inputInside?: boolean;
  wheels?: number;
}

export function sanitizeBlogTag(value: BlogTagDiagnostic): BlogTagDiagnostic | undefined {
  if (!phases.includes(value.phase)) return;
  const safe: BlogTagDiagnostic = { phase: value.phase };
  if (value.hit !== undefined && hitNames.has(value.hit)) safe.hit = value.hit;
  if (typeof value.inputInside === 'boolean') safe.inputInside = value.inputInside;
  for (const key of ['clientHeight', 'scrollHeight', 'scrollTop', 'chips', 'wheels'] as const) {
    const number = value[key];
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER) safe[key] = number;
  }
  return safe;
}
