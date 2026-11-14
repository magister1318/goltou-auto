// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { RecordingCheckpoint } from '../../core/src/record-checkpoint';
import { updateInputProgress } from '../../core/src/input-progress';
import { activeNow, progressFraction, remainingSeconds } from '../src/progress-model';
import { LiveProgress } from '../src/LiveProgress';
import type { Job } from '@goltou/core/protocol';
import type { PreparedPreview } from '@goltou/core';
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
it('keeps displayed text and percent moving forward as measured engine events replace estimates', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const preview = { blog: { steps: [{ kind: 'text', role: 'body', text: '가'.repeat(300) }] } } as PreparedPreview;
  const activity = { channel: 'blog', stage: 'write', phase: 'progress', blockKind: 'paragraph', blockIndex: 0, blockTotal: 2, fraction: 0, at: 0 } as const;
  const job = { id: 1, step: 4, status: 'running', startedAt: 0, targets: [{ channel: 'blog' }], activity, activityLog: [activity] } as unknown as Job;
  const render = async (value: Job) => act(async () => { root.render(createElement(LiveProgress, { job: value, preview })); });
  try {
    await render(job); await act(async () => { vi.advanceTimersByTime(1500); });
    const characters = host.querySelector('.paper-content')!.textContent!.length;
    const percent = (host.querySelector('.overall') as HTMLProgressElement).value;
    const next = { ...activity, fraction: 0.01, at: Date.now() };
    await render({ ...job, activity: next, activityLog: [next] });
    expect(host.querySelector('.paper-content')!.textContent!.length).toBeGreaterThanOrEqual(characters);
    let previous = percent;
    for(let n=0;n<200;n++) {
      await act(async () => { vi.advanceTimersByTime(80); });
      const current = (host.querySelector('.overall') as HTMLProgressElement).value;
      expect(current).toBeGreaterThanOrEqual(previous); expect(host.textContent).not.toContain('NaN'); previous=current;
    }
    const photo = { ...next, blockKind: 'photos' as const, blockIndex: 1, photoIndex: 0, photoTotal: 1, at: Date.now(), fraction: 0 };
    await render({ ...job, photoUploadMilliseconds: 0, photoUploadSamples: 0, activity: photo, activityLog: [next, photo] });
    expect((host.querySelector('.overall') as HTMLProgressElement).value).toBeGreaterThanOrEqual(previous);
    expect(host.textContent).not.toContain('NaN');
  } finally { await act(async () => root.unmount()); }
});

it('shows elapsed work time during preparation and excludes a long recovery choice from the work clock', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const a = { channel: 'blog', stage: 'open', phase: 'start', opening: 'navigate', at: 0 } as const;
  const job = { id: 2, step: 1, status: 'running', startedAt: 0, targets: [{ channel: 'blog' }], activity: a, activityLog: [a] } as unknown as Job;
  const checkpoint = new RecordingCheckpoint(async () => {}, () => {});
  const render = () => act(async () => { root.render(createElement(LiveProgress, { job: structuredClone(job), preview: null })); });
  try {
    await render();
    let last = '', percent = 0;
    for (let n = 0; n < 30; n++) {
      await act(async () => { vi.advanceTimersByTime(2000); });
      const visible = host.querySelector('.live-progress > .row-label:last-child')!.textContent;
      expect(visible).not.toBe(last); last = visible!;
      const next = (host.querySelector('.overall') as HTMLProgressElement).value;
      expect(next).toBeGreaterThanOrEqual(percent); expect(next).toBeLessThan(6); percent = next;
    }
    job.status = 'recovery_paused'; await checkpoint.emit(job); await render();
    const frozen = activeNow(job, Date.now());
    await act(async () => { vi.advanceTimersByTime(54000); });
    expect(activeNow(job, Date.now())).toBe(frozen);
    expect(host.textContent).toContain('선택을 기다리는 중');
    job.status = 'running'; await checkpoint.emit(job); await render();
    expect(job.pausedMilliseconds).toBe(54000); expect(activeNow(job, Date.now())).toBe(frozen);
    expect(host.textContent).toContain('1분 0초 지남');
  } finally { await act(async () => root.unmount()); }
});
it('retains all five completed verification pills during the second readback pass', async () => {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const job = { id: 3, step: 5, status: 'running', startedAt: 0, targets: [{ channel: 'blog' }] } as unknown as Job;
  const update = (verification: 'title' | 'body' | 'photos' | 'facts' | 'tags', phase: 'start' | 'finish') => updateInputProgress(job, { characters: 10, totalCharacters: 10, photos: 1, totalPhotos: 1, activity: { channel: 'blog', stage: 'verify', phase, verification } });
  const render = () => act(async () => { root.render(createElement(LiveProgress, { job: structuredClone(job), preview: null })); });
  try {
    for (const key of ['title', 'body', 'photos', 'facts', 'tags'] as const) { update(key, 'start'); update(key, 'finish'); }
    await render(); await act(async () => { vi.advanceTimersByTime(1200); });
    expect(host.querySelectorAll('.check-pills .ok')).toHaveLength(5);
    for (const key of ['title', 'body', 'photos', 'facts', 'tags'] as const) {
      update(key, 'start'); await render(); expect(host.querySelectorAll('.check-pills .ok')).toHaveLength(5);
      update(key, 'finish'); await render(); expect(host.querySelectorAll('.check-pills .ok')).toHaveLength(5);
    }
  } finally { await act(async () => root.unmount()); }
});
it('allocates writing by character and photo work, with a finite estimate at zero photo samples', () => {
  const preview = { steps: [{ kind: 'text', role: 'title', text: '제목' }, { kind: 'text', role: 'body', text: '가'.repeat(1000) }, { kind: 'photos', urls: ['fixture'] }] } as unknown as PreparedPreview['blog'];
  const a = { channel: 'blog', stage: 'write', phase: 'finish', blockKind: 'title', blockIndex: 0, blockTotal: 3, at: 0 } as const;
  const job = { id: 4, step: 4, startedAt: 0, targets: [{ channel: 'blog' }], activity: a, activityLog: [a], photoUploadMilliseconds: 0, photoUploadSamples: 0 } as unknown as Job;
  expect(progressFraction(job, 0, 0, preview)).toBeLessThan(.12);
  expect(remainingSeconds(job, 0, preview)).toBeGreaterThan(80);
  expect(Number.isFinite(remainingSeconds(job, 0, preview))).toBe(true);
});

it('keeps the short own-leftover note on the progress screen after subsequent engine updates', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const job = { id: 5, step: 1, status: 'running', targets: [{ channel: 'blog' }] } as unknown as Job;
  const progress = { characters: 0, totalCharacters: 0, photos: 0, totalPhotos: 0 };
  try {
    updateInputProgress(job, { ...progress, ownRecoveryDiscarded: true });
    updateInputProgress(job, progress);
    await act(async () => root.render(createElement(LiveProgress, { job, preview: null })));
    expect(host.querySelector('.recovery-note')?.textContent).toBe('앱이 남긴 쓰다 만 글을 정리했습니다.');
  } finally { await act(async () => root.unmount()); }
});
