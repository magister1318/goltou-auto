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

const noteLabels = {
  title:'제목', text:'문단', number:'가격·출발일', href:'링크', links:'링크', photo:'사진', photos:'사진',
  order:'사진 순서', table:'표', hashtags:'태그', visibility:'공개 범위', line_breaks:'줄바꿈', bold:'굵기',
  cursor:'입력 위치', input:'입력 내용', stability:'상세 화면',
} as const;

function publishedNotes(result: TargetResult) {
  const notes = result.readbackNotes ?? [];
  return [...new Set(notes.map(note => {
    const label = noteLabels[note.field];
    if (note.field === 'photo' && note.expected !== undefined && note.observed !== undefined && note.observed !== note.expected) {
      if (note.missing && note.observed < note.expected) return `사진 ${note.expected}장 중 ${note.observed}장 게시 확인 · ${note.expected - note.observed}장 누락`;
      if (note.observed > note.expected) return `사진 ${note.expected}장 계획 · ${note.observed}장 확인`;
      return `사진 ${note.expected}장 중 ${note.observed}장까지 확인`;
    }
    return `${label}${note.paragraph && note.field === 'text' ? ' ' + note.paragraph : ''} ${note.missing ? '누락·변경 확인' : '확인 필요'}`;
  }))].join(' · ');
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
        <span><strong>{channelLabel(target.channel)}</strong> · {target.name}<small>{description}</small>{state === 'done' && result?.readbackNotes?.length ? <small>{publishedNotes(result)}</small> : null}</span>
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
