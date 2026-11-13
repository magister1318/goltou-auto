import React from 'react';
import type { PolishResult } from '@goltou/core';

export function PolishComparison({ result, busy, onRevert, onOpen, onRetry }: {
  result: PolishResult; busy: boolean; onRevert(id: string): void; onOpen(): void; onRetry(): void;
}) {
  const sent = result.paragraphs.filter(p => p.sent).length;
  const accepted = result.paragraphs.filter(p => p.accepted && !p.reverted).length;
  const fallback = result.paragraphs.filter(p => p.outcome === 'fallback').length;
  return <section className="polish-comparison" aria-label="문장 다듬기 문단별 확인">
    <h2>문장 다듬기 확인</h2><p role="status">{result.notice}</p>
    <p className="small">전송 {sent} · 다듬음 {accepted} · 원문으로 복구 {fallback}</p>
    <p><button disabled={busy} onClick={onOpen}>AI 화면 열기</button> · <button disabled={busy} onClick={onRetry}>다듬기 다시 시도</button></p>
    {result.paragraphs.map((p, i) => <div className="polish-row" key={p.id} data-outcome={p.outcome}>
      <strong className="polish-status">문단 {i + 1} · {p.reverted ? '원문 사용 · 직접 되돌림' : p.outcome === 'polished' ? '다듬음' : p.outcome === 'kept_digits' ? '유지 · 숫자 포함' : p.outcome === 'kept_format' ? '유지 · 서식·일정·요금' : '원문으로 복구'}{p.sent && ` · ${(p.elapsedMs / 1000).toFixed(1)}초`}</strong>
      <div><strong>원문</strong><p>{p.original}</p></div>
      <div><strong>{p.accepted && !p.reverted ? '다듬은 글' : '사용할 원문'}</strong><p>{p.reverted ? p.original : p.polished}</p><small className="warn">{p.reasons.join(' · ')}</small></div>
      {p.accepted && <button disabled={busy || p.reverted} onClick={() => onRevert(p.id)}>{p.reverted ? '원문 사용 중' : '이 문단 되돌리기'}</button>}
    </div>)}
    <p className="small muted">두 글을 대조한 뒤 등록 시작을 선택해 주세요.</p>
  </section>;
}
