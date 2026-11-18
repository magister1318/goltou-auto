import type { Job, TargetResult } from '@goltou/core/protocol';
import { channelLabel } from './ProductPosting';
import { jobMessage } from './job-message';
import { uncertainReason } from './ux-state';

export const isPublishResult = (job: Job) => job.mode === 'publish' && !!job.targetResults?.length &&
  (job.completedSteps.includes(7) || job.targets.length > 1 && job.status === 'stopped' ||
    job.status === 'failed' && job.targets.length === 1 && job.targetResults[0]?.outcome === 'unconfirmed');

export const retryableTargets = (job: Job) => job.completedSteps.includes(7) &&
  ['failed', 'published'].includes(job.status)
  ? (job.targetResults ?? []).filter(row => row.outcome === 'failed' && !row.postUrl && !uncertainReason(row.reason))
  : [];

function rowState(result: TargetResult | undefined) {
  if (result?.outcome === 'unconfirmed' || result?.status === 'failed' && (result.postUrl || uncertainReason(result.reason))) return 'unconfirmed';
  if (result?.status === 'published' || result?.status === 'draft_saved') return 'done';
  if (result?.status === 'failed') return 'failed';
  if (result?.status === 'stopped') return 'stopped';
  return 'waiting';
}

function failedMessage(job: Job, result: TargetResult | undefined) {
  const { postUrl, failureCode, readbackIssues, ...rest } = job;
  return jobMessage({ ...rest, targetResults: [], creationState: 'none', publicationUncertain: false, status: 'failed',
    ...(result?.reason ? { failureCode: result.reason } : {}) })[0];
}

export function PostingTargets({ job, detail, open }: { job: Job; detail?: string; open?(url: string): void }) {
  const finished = isPublishResult(job);
  const current = !finished && job.status === 'running' && !job.bandPause
    ? job.targets.find(target => job.activeTargetKey ? target.channel === 'band' && target.key === job.activeTargetKey : target.channel === 'blog')
      ?? job.targets[0]
    : undefined;
  return <ul className="posting-targets" aria-label={finished ? '올린 결과' : '올릴 곳 진행 상태'}>
    {job.targets.map(target => {
      const result = job.targetResults?.find(row => row.channel === target.channel && row.key === target.key);
      const outcome = rowState(result);
      const state = outcome === 'waiting' && current === target ? 'now' : outcome;
      const description = state === 'done' ? target.channel === 'band' ? '게시했습니다' : '발행했습니다'
        : state === 'unconfirmed' ? `게시됐는지 확인하지 못했습니다. 다시 올리면 중복될 수 있으니 ${target.channel === 'band' ? '밴드' : '블로그'}에서 먼저 확인해 주세요.`
        : state === 'failed' ? failedMessage(job, result)
        : state === 'now' ? detail || '올리는 중'
        : state === 'stopped' || finished ? '올리기를 멈췄습니다'
        : '차례를 기다리는 중';
      return <li className={state} key={`${target.channel}:${target.key}`}>
        <i aria-hidden="true">{state === 'done' ? '✓' : state === 'failed' || state === 'unconfirmed' ? '!' : ''}</i>
        <span><strong>{channelLabel(target.channel)}</strong> · {target.name}<small>{description}</small></span>
        {state === 'done' && result?.postUrl && open && <button className="green post-link" onClick={() => open(result.postUrl!)}>글 보기</button>}
      </li>;
    })}
  </ul>;
}

export function PublishResult({ job, open }: { job: Job; open(url: string): void }) {
  const posted = job.targetResults?.filter(row => rowState(row) === 'done' && row.status === 'published').length ?? 0;
  const remaining = job.targets.length - posted;
  return <main className="batch-result">
    <p className="meta">{job.title}</p>
    <h1>{job.targets.length}곳 중 {posted}곳에 올렸습니다</h1>
    {!!remaining && <p className="meta">{remaining}곳은 올리지 못했거나 확인이 필요합니다.</p>}
    <PostingTargets job={job} open={open} />
  </main>;
}
