import { useEffect, useRef, useState } from 'react';
import type { Job } from '@goltou/core/protocol';
import type { InputPlan, PreparedPreview } from '@goltou/core';
import { ProductPhoto } from './ProductPhoto';
type Activity = NonNullable<Job['activity']>;
const checks = {
  title: '제목',
  body: '본문',
  photos: '사진 수·순서',
  facts: '가격·날짜 숫자',
  tags: '해시태그',
};
const seconds = (value: number) =>
  `${value >= 60 ? `${Math.floor(value / 60)}분 ` : ''}${Math.max(0, Math.floor(value % 60))}초`;
export function progressFraction(job: Job, now: number, previous = 0) {
  const a = job.activity;
  let base = Math.max(0, job.step - 1) / 7;
  if (a) {
    const fraction =
      a.phase === 'finish'
        ? 1
        : Math.min(
            0.94,
            (a.fraction ?? 0) +
              (1 - (a.fraction ?? 0)) *
                0.85 *
                (1 -
                  Math.exp(
                    -Math.max(0, now - a.at) /
                      (a.blockKind === 'photos'
                        ? (job.photoUploadMilliseconds ?? 4500) /
                          Math.max(1, job.photoUploadSamples ?? 1)
                        : 2400),
                  )),
          );
    const local =
      a.stage === 'open'
        ? 0.02
        : a.stage === 'write'
          ? 0.08 +
            (0.62 *
              ((a.blockIndex ?? a.photoIndex ?? 0) +
                (a.blockKind === 'photos' && a.blockIndex !== undefined
                  ? ((a.photoIndex ?? 0) + fraction) /
                    Math.max(1, a.photoTotal ?? 1)
                  : fraction))) /
              Math.max(1, a.blockTotal ?? a.photoTotal ?? 1)
          : a.stage === 'verify'
            ? 0.78
            : 0.92;
    base += local / 7;
  } else
    base +=
      (0.85 / 7) *
      (1 - Math.exp(-Math.max(0, now - (job.startedAt ?? now)) / 20000));
  return Math.max(previous, Math.min(0.985, base));
}
function textOf(step: InputPlan['steps'][number]) {
  return step.kind === 'text'
    ? step.text
    : step.kind === 'table'
      ? step.rows.map((row) => row.join(' | ')).join('\n')
      : '';
}
export function LiveProgress({
  job,
  preview,
}: {
  job: Job;
  preview: PreparedPreview | null;
}) {
  const [now, setNow] = useState(Date.now());
  const monotonic = useRef(0),
    paper = useRef<HTMLDivElement>(null);
  const reduced =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), reduced ? 1000 : 80);
    return () => clearInterval(timer);
  }, [reduced]);
  const channel = job.activity?.channel ?? (job.step === 6 ? 'band' : 'blog');
  const plan = preview?.[channel];
  const log = job.activityLog?.filter((a) => a.channel === channel) ?? [];
  const a = job.activity;
  const photos =
    plan?.steps.flatMap((s) => (s.kind === 'photos' ? s.urls : [])) ?? [];
  const completedPhotos = new Set(
    log
      .filter(
        (e) =>
          e.stage === 'write' &&
          e.blockKind === 'photos' &&
          e.phase === 'finish' &&
          e.photoIndex !== undefined,
      )
      .map((e) => e.photoIndex!),
  );
  const lastFor = (index: number) =>
    log
      .filter(
        (e) =>
          e.stage === 'write' &&
          e.blockIndex === index &&
          e.blockKind !== 'photos',
      )
      .at(-1);
  const doneFor = (index: number) =>
    log.some(
      (e) =>
        e.stage === 'write' &&
        e.blockIndex === index &&
        e.blockKind !== 'photos' &&
        e.phase === 'finish',
    );
  const percent =
    Math.floor(progressFraction(job, now, monotonic.current) * 1000) / 10;
  monotonic.current = percent / 100;
  const elapsed = Math.max(0, (now - (job.startedAt ?? now)) / 1000);
  const measured = log.filter(
    (e) => e.phase === 'finish' && e.stage === 'write',
  );
  const perBlock =
    measured.length > 1
      ? Math.max(
          0.5,
          (measured.at(-1)!.at - measured[0]!.at) /
            (measured.length - 1) /
            1000,
        )
      : 3;
  const blocks = plan?.steps.filter((s) => s.kind !== 'break').length ?? 10;
  const remaining = Math.max(
    1,
    (blocks - measured.filter((e) => e.blockKind !== 'photos').length) *
      perBlock +
      Math.max(0, photos.length - completedPhotos.size) *
        ((job.photoUploadMilliseconds ?? 4500) /
          Math.max(1, job.photoUploadSamples ?? 1) /
          1000) +
      (job.step < 5 ? 12 : 5),
  );
  let headline =
    job.step === 2
      ? '사진 원본을 내려받는 중'
      : job.step === 3
        ? '본문을 정리하는 중'
        : '글쓰기 화면을 여는 중';
  let subtitle = '빈 글을 준비하고 있습니다.';
  const animatedFraction = (event: Activity) =>
    event.phase === 'finish'
      ? 1
      : Math.min(
          0.94,
          (event.fraction ?? 0) +
            (1 - (event.fraction ?? 0)) *
              0.8 *
              (1 - Math.exp(-Math.max(0, now - event.at) / 3000)),
        );
  if (a?.stage === 'write') {
    headline =
      a.blockKind === 'photos'
        ? '사진을 올리는 중'
        : a.blockKind === 'title'
          ? '제목을 쓰는 중'
          : a.blockKind === 'tags'
            ? '해시태그를 넣는 중'
            : '본문을 쓰는 중';
    const paragraphs =
      plan?.steps
        .map((s, i) => ({ s, i }))
        .filter((v) => v.s.kind === 'text' && v.s.role === 'body') ?? [];
    subtitle =
      a.blockKind === 'photos'
        ? `${photos.length}장 중 ${(a.photoIndex ?? 0) + 1}번째 · ${Math.floor(animatedFraction(a) * 100)}%`
        : a.blockKind === 'paragraph'
          ? `${paragraphs.length}문단 중 ${Math.max(1, paragraphs.findIndex((v) => v.i === a.blockIndex) + 1)}번째 문단`
          : '상품 원문을 순서대로 옮깁니다.';
  } else if (a?.stage === 'verify') {
    headline = '올라간 내용을 확인하는 중';
    subtitle = `${checks[a.verification ?? 'body']} 확인`;
  } else if (a?.stage === 'submit') {
    headline =
      channel === 'band'
        ? '밴드에 게시하는 중'
        : job.mode === 'draft'
          ? '임시저장하는 중'
          : '블로그에 발행하는 중';
    subtitle =
      job.mode === 'draft' ? '공개되지 않습니다.' : '저장 결과를 확인합니다.';
  }
  useEffect(() => {
    if (paper.current) paper.current.scrollTop = paper.current.scrollHeight;
  }, [job.activityLog?.length, a?.at]);
  let photoIndex = 0;
  function photo(url: string, index: number) {
    const done = completedPhotos.has(index),
      current = a?.blockKind === 'photos' && a.photoIndex === index;
    if (!done && !current) return null;
    return (
      <div className="live-photo" key={index}>
        {done ? (
          <ProductPhoto url={url} preview />
        ) : (
          <>
            <small>사진 {index + 1} 올리는 중</small>
            <progress
              aria-label={`사진 ${index + 1} 진행`}
              max={1}
              value={a ? animatedFraction(a) : 0}
            />
          </>
        )}
      </div>
    );
  }
  return (
    <div className="live-progress">
      <div className="dest">
        {job.targets.some((t) => t.channel === 'blog') && (
          <span className={channel === 'blog' ? 'now' : 'ok'}>
            블로그 {job.mode === 'draft' ? '임시저장' : '발행'}
          </span>
        )}
        {job.targets.some((t) => t.channel === 'band') && (
          <>
            <em>→</em>
            <span className={channel === 'band' ? 'now' : ''}>밴드 게시</span>
          </>
        )}
      </div>
      <h1 className="progress-headline">{headline}</h1>
      <p className="meta" aria-live="polite">
        {subtitle}
      </p>
      <span className="meta">
        지금 만들어지는 {channel === 'blog' ? '블로그' : '밴드'} 글
      </span>
      <div ref={paper} className="live-paper" aria-label="지금 만들어지는 글">
        <div className="paper-content">
          {!log.length && <p className="meta">빈 글을 준비하고 있습니다.</p>}
          {plan?.steps.map((step, index) => {
            if (step.kind === 'break') return null;
            if (step.kind === 'photos') {
              const start = photoIndex;
              photoIndex += step.urls.length;
              return channel === 'band' ? null : (
                <div key={index}>
                  {step.urls.map((url, n) => photo(url, start + n))}
                </div>
              );
            }
            const event = lastFor(index);
            if (!event) return null;
            const text = textOf(step),
              done = doneFor(index),
              chars = Array.from(text);
            return (
              <p
                key={index}
                className={
                  step.kind === 'text' && step.role === 'title'
                    ? 'live-title'
                    : step.kind === 'text' && step.role === 'hashtags'
                      ? 'green'
                      : ''
                }
              >
                {done
                  ? text
                  : chars
                      .slice(
                        0,
                        Math.floor(
                          chars.length *
                            (reduced
                              ? (event.fraction ?? 0)
                              : animatedFraction(event)),
                        ),
                      )
                      .join('')}
                {!done && <span className="caret" />}
              </p>
            );
          })}
          {channel === 'band' && (
            <div className="photo-grid">{photos.map(photo)}</div>
          )}
        </div>
      </div>
      <div className="row-label">
        <span>사진</span>
        <span>
          {completedPhotos.size}/{photos.length}
        </span>
      </div>
      <div className="photo-strip">
        {photos.map((_, index) => (
          <i
            key={index}
            className={
              completedPhotos.has(index)
                ? 'ok'
                : a?.blockKind === 'photos' && a.photoIndex === index
                  ? 'now'
                  : ''
            }
          />
        ))}
      </div>
      <div className="row-label">
        <span>올린 뒤 확인</span>
        <span>
          {a?.stage === 'verify'
            ? '원문과 대조합니다'
            : '글을 다 쓴 뒤 확인합니다'}
        </span>
      </div>
      <div className="check-pills">
        {Object.entries(checks).map(([key, label], index) => {
          const event = log
            .filter((e) => e.stage === 'verify' && e.verification === key)
            .at(-1);
          const first = log.find((e) => e.stage === 'verify');
          const due = (first?.at ?? now) + (reduced ? 0 : index * 220);
          const done = event?.phase === 'finish' && now >= due;
          return (
            <span
              key={key}
              className={done ? 'ok' : event && now >= due - 220 ? 'now' : ''}
            >
              {done ? '✓ ' : ''}
              {label}
            </span>
          );
        })}
      </div>
      <progress
        className="overall"
        aria-label="등록 진행률"
        max={100}
        value={percent}
      />
      <div className="row-label">
        <span>
          {percent.toFixed(0)}% · {seconds(elapsed)} 지남
        </span>
        <span>
          {a?.stage === 'submit'
            ? '결과 확인 중'
            : `약 ${seconds(remaining)} 남음`}
        </span>
      </div>
    </div>
  );
}
