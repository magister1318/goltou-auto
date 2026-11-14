import type { Job } from './protocol';

/** Keep the server's existing status contract; retain the distinct outcome in its reason. */
export function markDraftUnverified(job: Job) {
  job.status = 'draft_unverified';
  job.failureCode = 'BLOG_DRAFT_SAVED_UNVERIFIED';
  job.message = '임시저장은 됐지만 내용을 다시 확인하지 못했습니다';
  const blog = job.targetResults?.find(t => t.channel === 'blog');
  if (blog) { blog.status = 'stopped'; blog.reason = job.failureCode; }
  for (const target of job.targetResults ?? []) if (target.status === 'running') target.status = 'stopped';
}
