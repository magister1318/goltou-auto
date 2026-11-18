import type { Job } from './protocol';

export function existingServiceResult(job: Job): 'published' | 'draft_saved' | 'uncertain' | null {
  const reasons = [job.failureCode ?? '', ...(job.targetResults ?? []).map(t=>t.reason ?? '')].join(' ');
  if (job.creationState === 'published' || job.postUrl || job.targetResults?.some(t=>t.postUrl || t.status === 'published') || /BAND_PUBLISHED_READBACK_|BLOG_PUBLISHED_|BLOG_FORMATTING_PUBLISHED:/.test(reasons)) return 'published';
  if (job.creationState === 'uncertain' || job.publicationUncertain) return 'uncertain';
  if (job.creationState === 'draft_saved' || job.status === 'draft_unverified' || job.targetResults?.some(t=>t.status === 'draft_saved') || /BLOG_DRAFT_SAVED_UNVERIFIED|BLOG_SAVED_|BLOG_FORMATTING_(AFTER_SAVE|REOPENED):/.test(reasons)) return 'draft_saved';
  if (/BAND_POST_UNCONFIRMED|BLOG_PUBLISH_|DRAFT_SAVE_UNCONFIRMED|PUBLICATION_UNCERTAIN/.test(reasons)) return 'uncertain';
  return null;
}
/** A new attempt is offered only with affirmative evidence of no creation. */
export const canRetryJob = (job: Job) => job.status === 'failed' && job.creationState === 'none' && !existingServiceResult(job) && !/^BAND_(POST_BLOCKED|CREATE_REJECTED|TARGET_INVALID)/.test(job.failureCode ?? '');
