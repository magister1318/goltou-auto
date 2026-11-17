import type { BlogPlan } from './plan';
import { blogHashtagPattern, blogTagEmojiPattern } from './tag-patterns';

const unique = (tags: readonly string[]) => [...new Set(tags.filter(Boolean))];

/** The metadata layer trims and caps each body keyword at 100 UTF-16 units.
 * Do not cap the combined set at 30: a service limit must fail verification,
 * rather than silently authorize loss of a planned tag. */
export function blogBodyTags(plan: BlogPlan): string[] {
  // The service extracts from text units, including their paragraph newlines;
  // run boundaries and links do not start a new unit. Photos/tables do.
  const units: string[] = [];
  let text = '';
  const flush = () => { if (text) units.push(text); text = ''; };
  for (const [index, step] of plan.steps.entries()) {
    if (step.kind === 'table') { flush(); units.push(...step.rows.flat()); }
    else if (step.kind === 'photos') { if (step.urls.length) flush(); }
    else if (step.kind === 'break') { if (index > 1) text += '\n\n'; }
    else if (step.role !== 'title' && step.role !== 'hashtags') text += step.text;
  }
  flush();
  return unique(units.flatMap(text => (text.replace(blogTagEmojiPattern, '$').match(blogHashtagPattern) ?? [])
    .map(tag => tag.replace('#', '').trim().slice(0, 100).trim())));
}

export function plannedBlogTags(plan: BlogPlan): string[] {
  return unique(plan.steps.flatMap(step => step.kind === 'text' && step.role === 'hashtags'
    ? step.text.split(/\s+/).filter(Boolean).map(tag => tag.replace(/^#/, '').trim()) : []));
}

export function expectedBlogTags(plan: BlogPlan): string[] {
  return unique([...plannedBlogTags(plan), ...blogBodyTags(plan)]);
}

/** Only tag order is immaterial. Extra, missing, changed and duplicate chips fail. */
export function sameBlogTags(expected: readonly string[], actual: readonly string[]): boolean {
  return expected.length === actual.length && JSON.stringify([...expected].sort()) === JSON.stringify([...actual].sort());
}

/** Post-save metadata: explicit chips stay exact; automatic chips are owned by
 * the service. Their wording must occur after # in the unchanged planned body. */
export function sameServiceBlogTags(plan: BlogPlan, actual: readonly string[]): boolean {
  const explicit = plannedBlogTags(plan);
  const body = plan.steps.flatMap(step => step.kind === 'table' ? step.rows.flat() : step.kind === 'text' && !['title','hashtags'].includes(step.role) ? [step.text] : []).join('\n');
  return new Set(actual).size === actual.length && explicit.every(tag=>actual.includes(tag)) &&
    actual.every(tag=>!!tag && (explicit.includes(tag) || body.includes('#'+tag) || tag.startsWith('.') && body.includes('.#'+tag.slice(1))));
}
