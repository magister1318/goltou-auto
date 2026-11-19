import { BlogFormattingError } from '@goltou/sites';
import type { Job } from './protocol';

/** Persist paragraph positions and controlled reasons only, through the existing record path. */
export function markBlogFormattingFailure(job: Job, error: unknown): boolean {
  if (!(error instanceof BlogFormattingError)) return false;
  job.blogFormattingIssues = error.issues;
  job.readbackIssues = error.issues.flatMap(issue=>issue.fields.map(field=>({field,paragraph:issue.paragraph})));
  if (error.stage==='PUBLISHED') job.creationState = 'published';
  else if (['AFTER_SAVE','REOPENED'].includes(error.stage) && job.creationState!=='uncertain') job.creationState = 'draft_saved';
  job.failureCode = error.message;
  const saved = ['AFTER_SAVE', 'REOPENED'].includes(error.stage);
  job.status = saved ? 'draft_unverified' : 'failed';
  job.message = '확인 필요 · 문단의 입력 내용을 확인하지 못했습니다.';
  const blog = job.targetResults?.find(t => t.channel === 'blog');
  if (blog) { blog.status = saved ? 'stopped' : 'failed'; blog.reason = error.message; blog.outcome = saved || error.stage === 'PUBLISHED' ? 'unconfirmed' : 'failed'; }
  if (job.mode !== 'publish') for (const target of job.targetResults ?? []) if (target.status === 'running') target.status = 'stopped';
  return true;
}
