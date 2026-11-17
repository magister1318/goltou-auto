import { ReadbackMismatch, type BlogExecution } from '@goltou/sites';
import type { Job } from './protocol';

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
  if (job.creationState === 'published') return 'BLOG_PUBLISHED_READBACK_' + (job.readbackIssues?.length ? 'MISMATCH' : 'UNAVAILABLE');
  if (job.creationState === 'draft_saved') return 'BLOG_SAVED_READBACK_' + (job.readbackIssues?.length ? 'MISMATCH' : 'UNAVAILABLE');
  if (job.creationState === 'uncertain') return job.publicationUncertain ? 'BLOG_PUBLISH_UNCONFIRMED' : 'DRAFT_SAVE_UNCONFIRMED';
  return fallback;
}
