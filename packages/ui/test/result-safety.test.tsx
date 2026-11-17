import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Job, JobStatus } from '@goltou/core/protocol';
import type { Post } from '@goltou/api-client';
import { JobResultActions, serviceReviewHeading } from '../src/JobResultActions';
import { canRetryHistory } from '../src/ux-state';
import { jobMessage } from '../src/job-message';
import { PostDeleteAction } from '../src/PostDeleteAction';

const job = (extra: Partial<Job> = {}): Job => ({id:1,productNo:1,title:'합성 제목',mode:'publish',status:'failed',step:6,current:0,total:0,completedSteps:[],targets:[{channel:'band',key:'synthetic',name:'합성'}],service:null,message:'',...extra});
const buttons = (value: Job) => Array.from(renderToStaticMarkup(<JobResultActions job={value} busy={false} act={()=>{}}/>).matchAll(/<button[^>]*>(.*?)<\/button>/g),match=>match[1]);
describe('terminal result actions',()=>{
  it.each([
    ['draft_saved',['등록 기록','다른 상품 옮기기']],
    ['published',['등록 기록','다른 상품 옮기기']],
    ['stopped',['등록 기록','다른 상품 옮기기']],
    ['stopped_before_post',['그만두기','등록 기록']],
    ['draft_unverified',['닫기','등록 기록에서 보기']],
    ['record_failed',['그만두기','기록 다시 시도']],
    ['failed',['그만두기','등록 기록']],
  ] as [JobStatus,string[]][])('renders the buttons for %s', (status,expected)=>expect(buttons(job({status}))).toEqual(expected));
  it.each([
    {failureCode:'BAND_PUBLISHED_READBACK_MISMATCH'},
    {failureCode:'BAND_PUBLISHED_READBACK_UNAVAILABLE'},
    {failureCode:'BAND_POST_UNCONFIRMED:IDENTITY_NOT_FOUND'},
    {failureCode:'BLOG_PUBLISHED_READBACK_MISMATCH'},
    {failureCode:'BLOG_SAVED_READBACK_MISMATCH'},
    {failureCode:'BLOG_FORMATTING_PUBLISHED:2'},
    {failureCode:'BLOG_FORMATTING_AFTER_SAVE:2'},
    {failureCode:'BLOG_FORMATTING_REOPENED:2'},
    {failureCode:'DRAFT_SAVE_UNCONFIRMED'},
    {creationState:'uncertain'},
    {publicationUncertain:true},
    {postUrl:'https://example.invalid/synthetic'},
    {targetResults:[{channel:'blog',key:'synthetic',name:'',status:'draft_saved'}]},
    {status:'record_failed',creationState:'published'},
    {status:'channel_paused',creationState:'draft_saved'},
    {status:'user_paused',creationState:'uncertain'},
    {status:'stopped',creationState:'published'},
    {status:'login_paused',creationState:'uncertain'},
  ] satisfies Partial<Job>[])('never offers retry or resume after creation (%j)', extra=>{
    const value=job(extra);
    expect(buttons(value)).toEqual(['닫기','등록 기록에서 보기']);
    expect(jobMessage(value).join(' ')).not.toContain('다시 시도');
  });
  it('offers retry only for proven no-creation failure; pauses retain their own actions',()=>{
    expect(buttons(job({creationState:'none',failureCode:'PHOTO_DOWNLOAD_FAILED'}))).toEqual(['그만두기','다시 시도']);
    expect(buttons(job({status:'user_paused',creationState:'none'}))).toEqual(['그만두기','이어하기']);
    expect(buttons(job({status:'channel_paused',creationState:'none'}))).toEqual(['그만두기','블로그 실패 확인 · 밴드 진행']);
    expect(buttons(job({status:'login_paused',creationState:'none'}))).toEqual(['나중에 하기','다시 로그인']);
  });
  it('states known publication or draft saving and shows the specific difference without content',()=>{
    const value=job({creationState:'published',readbackIssues:[{field:'links',index:2}]});
    expect(serviceReviewHeading(value)).toBe('게시는 됐지만 확인할 점이 있습니다');
    expect(jobMessage(value)[0]).toBe('링크 주소 2번째가 계획과 다릅니다.');
    expect(serviceReviewHeading(job({creationState:'draft_saved'}))).toBe('임시저장은 됐지만 확인할 점이 있습니다');
    expect(serviceReviewHeading(job({creationState:'uncertain'}))).not.toContain('됐지만');
    expect(jobMessage(job({readbackIssues:[{field:'title'}]}))[0]).toBe('제목이 계획과 다릅니다.');
    expect(jobMessage(job({readbackIssues:[{field:'bold',paragraph:2}]}))[0]).toBe('2번 문단의 문단 굵기가 계획과 다릅니다.');
  });
  it.each(['band','blog'] as const)('retains open/delete eligibility for a created %s post with failed readback',channel=>{
    const post={channel,status:'failed',mode:'publish',failReason:channel==='band'?'BAND_PUBLISHED_READBACK_MISMATCH':'BLOG_PUBLISHED_READBACK_MISMATCH',postUrl:channel==='band'?'https://band.us/band/111/post/9001':'https://blog.naver.com/synthetic/9001'} as Post;
    expect(canRetryHistory(post)).toBe(false);
    expect(renderToStaticMarkup(<PostDeleteAction post={post} scope="mine" busy={false} prepare={async()=>({confirmation:'synthetic',productTitle:'합성'})} remove={async()=>{}}/>)).toContain('글 삭제');
    expect(canRetryHistory({...post,postUrl:'',failReason:'UNKNOWN'})).toBe(false);
  });
});
