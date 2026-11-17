import { expect, it } from 'vitest';
import { ReadbackMismatch, type BlogExecution } from '@goltou/sites';
import type { Job } from '../src/protocol';
import { retainBlogOutcome, blogOutcomeFailure } from '../src/blog-outcome';
import { existingServiceResult } from '../src/job-safety';

it.each(['published','draft_saved','uncertain','none'] as const)('retains %s evidence independently of readback success',creationState=>{
  const job={publicationUncertain:creationState==='uncertain',targetResults:[{channel:'blog',status:'running'}]} as Job;
  const url='https://blog.naver.com/synthetic/9001';
  const execution={creationState,publishedPost:creationState==='published'?{url}:undefined} as BlogExecution;
  retainBlogOutcome(job,execution,new ReadbackMismatch('BLOG_READBACK_MISMATCH:photos',[{field:'photos'}]));
  expect(job.readbackIssues).toEqual([{field:'photos'}]);
  expect(existingServiceResult(job)).toBe(creationState==='none'?null:creationState);
  expect(blogOutcomeFailure(job,'BLOG_READBACK_MISMATCH:photos')).toBe(creationState==='published'?'BLOG_PUBLISHED_READBACK_MISMATCH':creationState==='draft_saved'?'BLOG_SAVED_READBACK_MISMATCH':creationState==='uncertain'?'BLOG_PUBLISH_UNCONFIRMED':'BLOG_READBACK_MISMATCH:photos');
  if(creationState==='published') {
    expect(job.postUrl).toBe(url);
    expect(job.targetResults?.[0]?.postUrl).toBe(url);
    expect(job.publicationUncertain).toBe(false);
    expect(job.targetResults?.[0]?.status).toBe('running');
  }
});
