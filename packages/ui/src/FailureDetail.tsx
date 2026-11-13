import type { Job } from '@goltou/core/protocol';

export function FailureDetail({ job }: { job: Pick<Job, 'step' | 'failureCode'> }) {
  if (!job.failureCode) return null;
  return <details className="small muted failure-detail"><summary>실패 상세</summary>
    <p>작업 단계 {job.step}/7 · 오류 코드: <code>{job.failureCode}</code></p>
  </details>;
}
