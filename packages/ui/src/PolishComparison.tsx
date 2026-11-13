import React from 'react';
import type { PolishParagraph, PolishResult } from '@goltou/core';

export function polishParagraphLabel(p: PolishParagraph): string {
  if (p.reverted) return '원문 사용 · 직접 되돌림';
  if (p.accepted) return p.polished === p.original ? '바뀐 곳 없음' : '다듬음';
  if (p.outcome === 'kept_digits') return '유지 · 숫자 포함';
  if (p.outcome === 'kept_format') return '유지 · 서식·일정·요금';
  if (p.failureCode === 'AI_INVALID_FORMAT') return '원문 유지: 응답 형식이 맞지 않음';
  if (p.failureCode === 'AI_VALIDATION_REJECTED') {
    const reason = p.reasons[0] ?? '';
    return `원문 유지: ${reason.startsWith('숫자') ? '숫자가 달라짐' : reason === '주소 변경' ? '주소가 달라짐' : reason}`;
  }
  return `원문 유지: ${p.reasons[0] ?? '다듬지 못함'}`;
}

export function PolishComparison({ result, busy, onRevert, onOpen, onRetry }: {
  result: PolishResult; busy: boolean; onRevert(id: string): void; onOpen(): void; onRetry(): void;
}) {
  const sent = result.paragraphs.filter(p => p.sent).length;
  const changed = result.paragraphs.filter(p => p.accepted && !p.reverted && p.original !== p.polished).length;
  const unchanged = result.paragraphs.filter(p => p.accepted && !p.reverted && p.original === p.polished).length;
  const fallback = result.paragraphs.filter(p => p.outcome === 'fallback').length;
  return <section className="polish-comparison" aria-label="문장 다듬기 문단별 확인">
    <h2>문장 다듬기 확인</h2><p role="status">{result.notice}</p>
    <p className="small">전송 {sent} · 다듬음 {changed} · 바뀐 곳 없음 {unchanged} · 원문 유지 {fallback}</p>
    <p><button disabled={busy} onClick={onOpen}>AI 화면 열기</button> · <button disabled={busy} onClick={onRetry}>다듬기 다시 시도</button></p>
    {result.paragraphs.map((p, i) => <div className="polish-row" key={p.id} data-outcome={p.outcome}>
      <strong className="polish-status">문단 {i + 1} · {polishParagraphLabel(p)}{p.sent && ` · ${(p.elapsedMs / 1000).toFixed(1)}초`}</strong>
      <div><strong>원문</strong><p>{p.original}</p></div>
      <div><strong>{p.accepted && !p.reverted ? '다듬은 글' : '사용할 원문'}</strong><p>{p.reverted ? p.original : p.polished}</p><small className="warn">{p.reasons.join(' · ')}</small></div>
      {p.accepted && p.polished !== p.original && <button disabled={busy || p.reverted} onClick={() => onRevert(p.id)}>{p.reverted ? '원문 사용 중' : '이 문단 되돌리기'}</button>}
    </div>)}
    <p className="small muted">두 글을 대조한 뒤 등록 시작을 선택해 주세요.</p>
  </section>;
}
