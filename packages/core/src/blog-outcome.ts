import { ReadbackMismatch, type BlogExecution } from '@goltou/sites';
import type { Job, TargetResult } from './protocol';

/** The known URL is the publication result. A viewer error only qualifies its readback. */
export function retainPublishedReadback(result: TargetResult, url: string | undefined, error: unknown) {
  if (!url) throw error;
  result.postUrl = url;
  result.readbackNotes = error instanceof ReadbackMismatch && error.issues.length
    ? error.issues : [{ field: 'stability' }];
  result.reason = result.readbackNotes.some(issue => issue.missing) ? 'PUBLISHED_CONTENT_MISSING' : 'PUBLISHED_READBACK_INCOMPLETE';
  return url;
}

export function retainBlogOutcome(job: Job, execution: BlogExecution | undefined, error?: unknown) {
  if (!execution) return;
  job.creationState = execution.creationState;
  if (execution.publishedPost) {
    job.postUrl = execution.publishedPost.url;
    const target = job.targetResults?.find(t=>t.channel==='blog');
    if (target) target.postUrl = job.postUrl;
    job.publicationUncertain = false;
  }
  if (error instanceof ReadbackMismatch) job.readbackIssues = error.issues;
}

export function blogOutcomeFailure(job: Job, fallback: string) {
  const fields = [...new Set(job.readbackIssues?.map(issue => issue.field).filter(field => ['title', 'text', 'number', 'href', 'photo', 'cursor', 'input'].includes(field)))];
  const outcome = job.readbackIssues?.length ? 'MISMATCH' + (fields.length ? ':' + fields.join(',') : '') : 'UNAVAILABLE';
  if (job.creationState === 'published') return 'BLOG_PUBLISHED_READBACK_' + outcome;
  if (job.creationState === 'draft_saved') return 'BLOG_SAVED_READBACK_' + outcome;
  if (job.creationState === 'uncertain') return job.publicationUncertain ? 'BLOG_PUBLISH_UNCONFIRMED' : 'DRAFT_SAVE_UNCONFIRMED';
  return fallback;
}
