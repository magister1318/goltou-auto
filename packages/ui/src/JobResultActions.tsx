import React from 'react';
import type { Job } from '@goltou/core/protocol';
import { canRetryJob, existingServiceResult } from '@goltou/core/job-safety';
export type ResultAction = 'history' | 'close' | 'home' | 'stop' | 'login' | 'cancel' | 'record' | 'band' | 'resume';
export const needsServiceReview = (job: Job) => !['running','draft_saved','published'].includes(job.status) && !!existingServiceResult(job);
export function serviceReviewHeading(job: Job) {
  const state = existingServiceResult(job);
  return state === 'published' ? job.targets.every(t=>t.channel==='band') ? '게시는 됐지만 확인할 점이 있습니다' : '발행됨, 확인할 점 있음'
    : state === 'draft_saved' ? '임시저장은 됐지만 확인할 점이 있습니다' : '저장 또는 게시 여부를 확인해 주세요';
}
export function JobResultActions({job,busy,act}:{job:Job;busy:boolean;act(action:ResultAction):void}) {
  const button = (label:string,action:ResultAction,primary=false,disabled=busy) => <button className={`btn ${primary?'primary':action==='close'||action==='history'?'secondary':'quiet'}`} disabled={disabled} onClick={()=>act(action)}>{label}</button>;
  if (needsServiceReview(job)) return <>{button('닫기','close',false,false)}{button('등록 기록에서 보기','history',true,false)}</>;
  if (job.status==='running') return button('중단','stop',false,job.activity?.stage==='submit');
  if (job.status==='login_paused') return <>{button('나중에 하기','home',false,false)}{button('다시 로그인','login',true)}</>;
  if (['draft_saved','published','stopped'].includes(job.status)) return <>{button('등록 기록','history',false,false)}{button('다른 상품 옮기기','home',true,false)}</>;
  return <>{button('그만두기','cancel')}{job.status==='record_failed' ? button('기록 다시 시도','record',true)
    : job.status==='channel_paused' ? button('블로그 실패 확인 · 밴드 진행','band',true)
    : job.status==='user_paused' ? button('이어하기','resume',true)
    : canRetryJob(job) ? button('다시 시도','resume',true) : button('등록 기록','history',true,false)}</>;
}
