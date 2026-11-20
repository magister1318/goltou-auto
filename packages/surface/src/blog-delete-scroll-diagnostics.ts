import { clickHitTags } from './index';

export const blogDeleteScrollHitClasses = ['se-component', 'se-text-paragraph', 'se-image-resource', 'area_btn_postedit'] as const;

export interface BlogDeleteScrollDiagnostic {
  x: number;
  y: number;
  tag?: string;
  classes?: string[];
  iframe?: boolean;
}

export function sanitizeBlogDeleteScroll(value: BlogDeleteScrollDiagnostic): BlogDeleteScrollDiagnostic | undefined {
  const { x, y, tag, classes, iframe } = value;
  if (![x, y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER)) return;
  return {
    x, y,
    ...(tag !== undefined ? { tag: clickHitTags.some(allowed => allowed === tag) ? tag : '[other]' } : {}),
    ...(Array.isArray(classes) ? { classes: blogDeleteScrollHitClasses.filter(name => classes.includes(name)) } : {}),
    ...(typeof iframe === 'boolean' ? { iframe } : {}),
  };
}
