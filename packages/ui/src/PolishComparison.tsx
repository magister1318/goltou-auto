import React from 'react';
import type { PolishParagraph, PolishResult } from '@goltou/core';

export function polishParagraphLabel(p: PolishParagraph): string {
  if (p.reverted) return '원문 사용 · 직접 되돌림';
  if (p.accepted) return p.polished === p.original ? '바뀐 곳 없음' : '다듬음';
  if (p.outcome === 'kept_digits') return '유지 · 숫자 포함';
  if (p.outcome === 'kept_format') return '유지 · 서식·일정·요금';
  if (p.failureCode === 'AI_INVALID_FORMAT')
    return '원문 유지: 응답 형식이 맞지 않음';
  if (p.failureCode === 'AI_VALIDATION_REJECTED') {
    const reason = p.reasons[0] ?? '';
    return `원문 유지: ${reason.startsWith('숫자') ? '숫자가 달라짐' : reason === '주소 변경' ? '주소가 달라짐' : reason}`;
  }
  return `원문 유지: ${p.reasons[0] ?? '다듬지 못함'}`;
}

/** Match unchanged characters, preserving separate edits inside one paragraph. */
export function changedCharacters(original: string, polished: string) {
  const a = Array.from(original),
    b = Array.from(polished);
  const left: { text: string; changed: boolean }[] = [],
    right: typeof left = [];
  const add = (out: typeof left, text: string, changed: boolean) => {
    const last = out[out.length - 1];
    if (last?.changed === changed) last.text += text;
    else if (text) out.push({ text, changed });
  };
  let i = 0,
    j = 0;
  // Look ahead locally rather than allocating a paragraph-sized quadratic matrix
  // on the phone. Distant unmatched spans stay marked until an anchor is found.
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      add(left, a[i++]!, false);
      add(right, b[j++]!, false);
      continue;
    }
    let nextA = -1,
      nextB = -1,
      best = Infinity;
    for (let x = i; x < Math.min(a.length, i + 64); x++)
      for (let y = j; y < Math.min(b.length, j + 64); y++) {
        if (a[x] === b[y] && x - i + y - j < best) {
          nextA = x;
          nextB = y;
          best = x - i + y - j;
        }
      }
    if (nextA < 0) {
      add(left, a.slice(i).join(''), true);
      add(right, b.slice(j).join(''), true);
      break;
    }
    add(left, a.slice(i, nextA).join(''), true);
    add(right, b.slice(j, nextB).join(''), true);
    i = nextA;
    j = nextB;
  }
  return { original: left, polished: right };
}
const marked = (
  parts: ReturnType<typeof changedCharacters>['original'],
  kind: 'original' | 'polished',
) =>
  parts.map((p, i) =>
    !p.changed ? (
      <React.Fragment key={i}>{p.text}</React.Fragment>
    ) : kind === 'original' ? (
      <del key={i}>{p.text}</del>
    ) : (
      <ins key={i}>{p.text}</ins>
    ),
  );
export function PolishComparison({
  result,
  busy,
  onRevert,
  onOpen,
  onRetry,
}: {
  result: PolishResult;
  busy: boolean;
  onRevert(id: string): void;
  onOpen(): void;
  onRetry(): void;
}) {
  const changed = result.paragraphs.filter(
    (p) => p.accepted && p.original !== p.polished,
  );
  const unchanged = result.paragraphs.filter((p) => !changed.includes(p));
  return (
    <section className="polish-comparison" aria-label="문장 다듬기 문단별 확인">
      <h2>다듬은 문장을 확인하세요</h2>
      <p role="status">{result.notice}</p>
      <p className="meta">
        {result.paragraphs.length}문단 중{' '}
        {changed.filter((p) => !p.reverted).length}문단을 고쳤습니다. 숫자,
        날짜, 가격은 바꾸지 않았습니다.
      </p>
      {changed.map((p) => {
        const diff = changedCharacters(p.original, p.polished);
        return (
          <div className="polish-row" key={p.id} data-outcome={p.outcome}>
            <div className="original">
              <strong>{p.reverted ? polishParagraphLabel(p) : '원문'}</strong>
              <p>{marked(diff.original, 'original')}</p>
            </div>
            {!p.reverted && (
              <div className="polished">
                <strong>다듬은 글</strong>
                <p>{marked(diff.polished, 'polished')}</p>
              </div>
            )}
            <button
              className="green"
              disabled={busy || p.reverted}
              onClick={() => onRevert(p.id)}
            >
              {p.reverted ? '원문 사용 중' : '원문으로 되돌리기'}
            </button>
          </div>
        );
      })}
      {!!unchanged.length && (
        <details className="unchanged-paragraphs">
          <summary>바뀌지 않은 문단 {unchanged.length}개</summary>
          {unchanged.map((p) => (
            <div className="polish-row" key={p.id}>
              <strong>{polishParagraphLabel(p)}</strong>
              <p>{p.original}</p>
              <small>{p.reasons.join(' · ')}</small>
            </div>
          ))}
        </details>
      )}
      <div className="inline-feedback">
        <button className="action-button" disabled={busy} onClick={onOpen}>
          다듬기 안내
        </button>
        <button className="action-button" disabled={busy} onClick={onRetry}>
          다듬기 다시 시도
        </button>
      </div>
    </section>
  );
}
