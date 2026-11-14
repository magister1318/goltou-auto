// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
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
