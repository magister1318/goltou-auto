import { useEffect, useState } from 'react';
import type { JobLogRow } from '@goltou/core/job-logs';
import { request } from './store';

export const jobKindLabel: Record<JobLogRow['kind'], string> = {
  blog_draft: '블로그 임시저장', blog_publish: '블로그 발행', blog_delete: '블로그 글 삭제',
  unfinished_cleanup: '작성 중인 글 정리', band_post: '밴드 게시', band_delete: '밴드 글 삭제', login_check: '로그인 확인', band_list: '밴드 목록 읽기',
};
export function failedStepLabel(step = '') {
  if (/download/i.test(step)) return '사진 내려받기';
  if (/arrange/i.test(step)) return '본문 정리';
  if (/record|checkpoint/i.test(step) && !/record-read/.test(step)) return '결과 기록';
  if (/delete|verifyGone/i.test(step)) return '글 삭제와 삭제 확인';
  if (/publish|submit/i.test(step)) return '게시와 게시 확인';
  if (/save|reopen|draft/i.test(step)) return '임시저장과 다시 읽기';
  if (/photo|attach|settle/i.test(step)) return '사진 첨부와 순서 확인';
  if (/write|input|type/i.test(step)) return '본문 입력';
  if (/login|ready|guard/i.test(step)) return '로그인과 편집기 확인';
  if (/list/i.test(step)) return '목록 읽기';
  if (/cdp|surface|native|navigation|open/i.test(step)) return '화면 연결과 이동';
  if (/verification|observe|read/i.test(step)) return '다시 읽어 비교';
  if (/barrier/i.test(step)) return '요청 허용 여부 확인';
  if (step === 'recovery') return '중단된 작업 복구';
  return '작업 진행';
}
export function logReasonLabel(reason = '') {
  if (reason === 'INTERRUPTED') return '앱이 종료되어 작업이 중단됐습니다.';
  if (reason === 'LOG_STORAGE_LIMIT') return '작업 로그 보관 한도에 도달해 멈췄습니다. 로그를 내보낸 뒤 작업 결과를 확인해 주세요.';
  if (reason === 'STOPPED_BEFORE_POST') return '게시 전 내용을 확인하도록 멈췄습니다.';
  if (reason === 'USER_STOPPED') return '사용자가 작업을 멈췄습니다.';
  if (reason === 'DELETE_CONFIRMATION_MISMATCH') return '삭제 확인이 선택한 글과 맞지 않아 멈췄습니다. 글을 다시 선택해 주세요.';
  if (/RECORD/.test(reason)) return '결과 기록을 저장하거나 확인하지 못했습니다.';
  if (/LOGIN/.test(reason)) return '로그인 상태를 확인하지 못했습니다.';
  if (/IDENTITY|TARGET/.test(reason)) return '저장된 대상과 현재 글이 같은지 확인하지 못했습니다.';
  if (/BLOCK|NOT_ARMED|ALREADY_SENT|BODY_|METHOD_|ORIGIN_|ROUTE_|QUERY_/.test(reason)) return '앱의 요청 검사에서 허용 조건을 확인하지 못해 차단했습니다.';
  if (/PHOTO|CURSOR/.test(reason)) return '사진 수·순서 또는 입력 위치를 확인하지 못했습니다.';
  if (/MISMATCH|VERIFICATION|FORMATTING/.test(reason)) return '다시 읽은 내용이 계획과 일치하지 않습니다.';
  if (/CONTROL|SELECTOR/.test(reason)) return '필요한 화면 버튼이나 입력칸을 찾지 못했습니다.';
  if (/TIMEOUT|TIME_OUT/.test(reason)) return '화면이나 응답을 기다리는 시간이 초과됐습니다.';
  if (/UNCERTAIN|UNCONFIRMED/.test(reason)) return '서비스에서 작업 결과를 확인하지 못했습니다. 다시 실행하기 전에 확인해 주세요.';
  if (reason === 'NOT_STARTED') return '작업 조건을 확인하지 못해 진행을 멈췄습니다.';
  return '이 단계의 처리를 마치지 못했습니다. 작업 로그에서 진행 순서를 확인해 주세요.';
}
export function JobLogFailure({ log, reason, step }: { log?: JobLogRow | undefined; reason?: string | undefined; step?: number }) {
  const legacyStep = ['runner.ready', 'runner.download', 'runner.arrange', 'runner.blog_write', 'runner.blog_save', 'runner.band_write', 'runner.record'][(step ?? 0) - 1];
  const code = log?.reason ?? reason;
  const label = code === 'BAND_POST_UNCONFIRMED' || code === 'BLOG_PUBLISH_UNCONFIRMED' ? '게시와 게시 확인' : failedStepLabel(log?.failedStep ?? legacyStep);
  return <p className="meta">{label} · {logReasonLabel(code)}</p>;
}
export function JobLogs({ back }: { back(): void }) {
  const [rows, setRows] = useState<JobLogRow[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { request('logs.list', {}).then(setRows).catch(() => setError('작업 로그를 읽지 못했습니다.')); }, []);
  return <main className="pad">
    <button className="back" onClick={back}>← 설정</button><h1 className="title">작업 로그</h1>
    <p className="meta">최근 30일, 최대 50MB까지 이 기기에 보관합니다.</p>
    <button className="green log-export" disabled={busy} onClick={() => { setBusy(true); void request('logs.export', {}).catch(() => setError('로그를 내보내지 못했습니다. 다시 시도해 주세요.')).finally(() => setBusy(false)); }}>로그 내보내기</button>
    {error && <p role="alert">{error}</p>}
    {!rows.length && !error && <p>아직 작업 로그가 없습니다.</p>}
    <ol className="job-log-list">{rows.map(row => <li key={row.jobId}>
      <time>{new Date(row.at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
      <strong>{jobKindLabel[row.kind]}</strong><span>{({ succeeded: '완료', failed: '실패', stopped: '멈춤', uncertain: '확인 필요', running: '진행 중' })[row.result]}</span>
      {row.result !== 'succeeded' && row.result !== 'running' && <JobLogFailure log={row} />}
    </li>)}</ol>
  </main>;
}
