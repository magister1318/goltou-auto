import { BlogExecution, type BlogReadback, type BlogToken } from '@goltou/sites';
import type { SurfaceHost } from '@goltou/surface';
import type { InputPlan } from './convert';
import { compact, compareDocuments, observePlan, type Observation } from './verify';
import type { MediaFile } from './media';

export interface BlogServices {
  host: SurfaceHost;
  editorUrl?: string;
  localPublish?: boolean;
  publishEnabled?: boolean;
  draftSaveLimit?: number;
  publishProbe?: NonNullable<import('@goltou/sites').BlogEnvironment['publishProbe']>;
  capture?(surface: import('@goltou/surface').Surface, name: string): Promise<Record<string, unknown>>;
  recordFailure?(failure: { jobId: number; step: number; code: string; evidence: string }): Promise<void>;
}
// Naver can transcode an upload (jpg -> png). The source-byte hash and ordinal
// in our filename remain the identity; a server-chosen suffix is not identity.
const photoIdentity = (value: string) => /^(goltou-[a-f0-9]{16}-[0-9]+)(?:\.[a-z]+)?$/i.exec(value)?.[1] ?? '';
export function blogObservation(plan: InputPlan, files: readonly MediaFile[], actual: BlogReadback): Observation {
  const result: Observation = { title: actual.title, text: '', paragraphs: [], photos: [], prices: [], departures: [], golfCourses: [] };
  const all = [actual.title];
  const tokens = actual.tokens;
  let offset = 0;
  const expectedOrder: BlogToken[] = [];
  for (const step of plan.steps) {
    if (step.kind === 'break' || (step.kind === 'text' && step.role === 'title')) continue;
    if (step.kind === 'photos') {
      for (const url of step.urls) {
        const file = files.find(f => f.url === url);
        const identity = photoIdentity(file?.path.split(/[\\/]/).pop() ?? '');
        expectedOrder.push({ kind: 'photo', identity });
        const token = tokens[offset++];
        result.photos.push(identity && token?.kind === 'photo' && photoIdentity(token.identity) === identity ? url : 'UNVERIFIED_PHOTO');
      }
      continue;
    }
    if (step.role === 'hashtags') { all.push(actual.tags.map(t => `#${t}`).join(' ')); continue; }
    const lines = step.kind === 'table' ? step.rows.map(row => row.join(' | ')) : [step.text];
    for (const line of lines) {
      // An internal newline is entered through keyboard input and may become multiple DOM paragraphs.
      const pieces = line.split('\n').filter(t => compact(t));
      const observed: string[] = [];
      for (const piece of pieces) {
        expectedOrder.push({ kind: 'text', text: piece });
        const token = tokens[offset++]; observed.push(token?.kind === 'text' ? token.text : 'MISSING_TEXT');
      }
      const value = observed.join('\n'); all.push(value);
      if (step.role === 'body') result.paragraphs.push(value);
      if (step.role === 'courses') result.golfCourses.push(value);
      if (step.role === 'departures') {
        result.departures.push(value.match(/^([^|]+)\s*\|/)?.[1]?.trim() ?? '');
        result.prices.push(value.match(/\|\s*(.*)원$/)?.[1]?.trim() ?? '');
      }
    }
  }
  const normalized = (values: BlogToken[]) => values.map(t => t.kind === 'photo' ? ['photo', photoIdentity(t.identity)] : ['text', compact(t.text)]);
  if (JSON.stringify(normalized(expectedOrder)) !== JSON.stringify(normalized(tokens))) all.push('EDITOR_ORDER_MISMATCH');
  if (actual.tags.length && !plan.steps.some(s => s.kind === 'text' && s.role === 'hashtags')) all.push('UNEXPECTED_TAGS');
  result.text = all.join('\n'); return result;
}
export function createBlogExecution(plan: InputPlan, files: readonly MediaFile[], services: BlogServices,
  hooks: Pick<ConstructorParameters<typeof BlogExecution>[2], 'check' | 'progress' | 'beforeSave' | 'mode' | 'visibility'>) {
  const execution: BlogExecution = new BlogExecution(plan, files, { ...services, ...hooks, verify: actual => {
    const comparison = compareDocuments(observePlan(plan), blogObservation(plan, execution.files, actual));
    if (!comparison.matches) throw new Error(`BLOG_READBACK_MISMATCH:${comparison.differences.map(d => d.field).join(',')}`);
  } });
  return execution;
}
