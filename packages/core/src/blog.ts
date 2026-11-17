import { BlogExecution, expectedBlogTags, sameBlogTags, sameServiceBlogTags, ReadbackMismatch, type BlogReadback, type BlogToken } from '@goltou/sites';
import type { SurfaceHost } from '@goltou/surface';
import type { InputPlan } from './convert';
import { compact, compareDocuments, observePlan, type Observation } from './verify';
import type { MediaFile } from './media';
import { verificationProgress } from './verify-progress';

export interface BlogServices {
  host: SurfaceHost;
  lastTypedTitle?: import('./blog-title-store').BlogTitleStore;
  editorUrl?: string;
  localPublish?: boolean;
  publishedSettleMs?: number;
  publishEnabled?: boolean;
  draftSaveLimit?: number;
  publishProbe?: NonNullable<import('@goltou/sites').BlogEnvironment['publishProbe']>;
  recordPublishResponse?: NonNullable<import('@goltou/sites').BlogEnvironment['recordPublishResponse']>;
  capture?(surface: import('@goltou/surface').Surface, name: string): Promise<Record<string, unknown>>;
  recordFailure?(failure: { jobId: number; step: number; code: string; evidence: string }): Promise<void>;
}
// Naver can transcode an upload (jpg -> png). The source-byte hash and ordinal
// in our filename remain the identity; a server-chosen suffix is not identity.
const photoIdentity = (value: string) => /^(goltou-[a-f0-9]{16}-[0-9]+)(?:\.[a-z]+)?$/i.exec(value)?.[1] ?? '';
export function blogObservation(plan: InputPlan, files: readonly MediaFile[], actual: BlogReadback, saved = false): Observation {
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
    // Metadata is checked separately against its exact planned/body-derived set.
    // Keep the source observation unchanged, including its explicit tag wording.
    if (step.kind === 'text' && step.role === 'hashtags') { all.push(step.text); continue; }
    let nativeRows: string[][] | undefined;
    if (step.kind === 'table' && tokens[offset]?.kind === 'table') {
      const token = tokens[offset++] as Extract<BlogToken,{kind:'table'}>;
      nativeRows = token.rows;
      expectedOrder.push({kind:'table',rows:step.rows});
    }
    const lines = step.kind === 'table' ? step.rows.map(row => row.join(' | ')) : [step.text];
    for (const [rowIndex,line] of lines.entries()) {
      // An internal newline is entered through keyboard input and may become multiple DOM paragraphs.
      const pieces = nativeRows ? [line] : line.split('\n').filter(t => compact(t));
      const observed: string[] = [];
      for (const piece of pieces) {
        if (nativeRows) observed.push(nativeRows[rowIndex]?.join(' | ') ?? 'MISSING_TEXT');
        else { expectedOrder.push({ kind: 'text', text: piece });
          const token = tokens[offset++]; observed.push(token?.kind === 'text' ? token.text : 'MISSING_TEXT'); }

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
  const normalized = (values: BlogToken[]) => values.map(t => t.kind === 'photo' ? ['photo', photoIdentity(t.identity)] : t.kind === 'table' ? ['table',t.rows] : ['text', compact(t.text)]);
  if (JSON.stringify(normalized(expectedOrder)) !== JSON.stringify(normalized(tokens))) all.push('EDITOR_ORDER_MISMATCH');
  if (!(saved ? sameServiceBlogTags(plan, actual.tags) : sameBlogTags(expectedBlogTags(plan), actual.tags))) all.push('UNEXPECTED_TAGS');
  result.text = all.join('\n'); return result;
}
export function createBlogExecution(plan: InputPlan, files: readonly MediaFile[], services: BlogServices,
  hooks: Pick<ConstructorParameters<typeof BlogExecution>[2], 'check' | 'progress' | 'beforeSave' | 'mode' | 'visibility'>) {
  let last: import('@goltou/sites').BlogProgress = { characters: 0, totalCharacters: 0, photos: 0, totalPhotos: files.length };
  const progress = (value: import('@goltou/sites').BlogProgress) => { last = value; hooks.progress(value); };
  const execution: BlogExecution = new BlogExecution(plan, files, { ...services, ...hooks, progress, verify: (actual, stage) => {
    const comparison = compareDocuments(observePlan(plan), blogObservation(plan, execution.files, actual, !!stage && ['AFTER_SAVE','REOPENED','PUBLISHED'].includes(stage)));
    verificationProgress('blog', comparison, last, hooks.progress);
    if (!comparison.matches) throw new ReadbackMismatch(`BLOG_READBACK_MISMATCH:${comparison.differences.map(d => d.field).join(',')}`, comparison.differences.map(d=>({field:d.field==='title'?'title':d.field==='photos'?'photos':'text'})));
  } });
  return execution;
}
