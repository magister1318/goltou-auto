import type { Job } from '@goltou/core/protocol';

export function RecordFailureActions({ job, busy, retry, showBand, discard }: {
  job: Pick<Job, 'step' | 'activeTargetKey' | 'targetResults'>; busy: boolean;
  retry(): void; showBand(): void; discard(): void;
}) {
  const composer = job.step === 6 && job.targetResults?.some(t => t.channel === 'band' && t.key === job.activeTargetKey && ['stopped_before_post', 'running', 'failed'].includes(t.status));
  return <>
    {composer && <button className="action-button" disabled={busy} onClick={discard}>쓰던 글 버리기</button>}
    <button className="chosen" disabled={busy} onClick={retry}>기록 다시 시도</button>
  </>;
}
