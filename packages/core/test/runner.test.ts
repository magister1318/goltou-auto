import { createFakeApi } from '@goltou/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRegistrationRunner } from '../src/runner';
import { AppCore } from '../src/app';
import type { AppRequest, Job, JobInput, Simulation } from '../src/protocol';
const input: JobInput = { productNo: 1237, mode: 'draft', targets: [{ channel: 'blog', name: '해외골프', key: 'overseas' }, { channel: 'band', name: '여행', key: 'travel' }], options: { polish: false, closing: false, linkCard: false } };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function runnerFixture(extra: Partial<Simulation> = {}) {
  const states: Job[] = [];
  const runner = new FakeRegistrationRunner(() => ({ tickMs: 10, loginAt: null, failAt: null, ...extra }), async () => {}, job => states.push(job));
  return { runner, states };
}
describe('fake registration transitions', () => {
  it('allows one task, preserves the substep on stop, resumes and finishes as a draft', async () => {
    const { runner } = runnerFixture(); await runner.start(input, '예시', 5);
    await vi.advanceTimersByTimeAsync(50); await runner.stop();
    const paused = structuredClone(runner.job); expect(paused?.status).toBe('user_paused');
    await expect(runner.start(input, '다른 상품', 5)).rejects.toMatchObject({ code: 'conflict' });
    await vi.advanceTimersByTimeAsync(500); expect(runner.job).toEqual(paused);
    await runner.resume(); expect(runner.job?.step).toBe(paused?.step); expect(runner.job?.current).toBe(paused?.current);
    await vi.advanceTimersByTimeAsync(500); expect(runner.job?.status).toBe('draft_saved'); expect(runner.job?.completedSteps).toEqual([1, 2, 3, 4, 5, 6, 7]); runner.dispose();
  });
  it('pauses at photo 3/5 after login expires and resumes without replaying saved steps', async () => {
    const { runner, states } = runnerFixture({ loginAt: 4 }); await runner.start(input, '예시', 5);
    await vi.advanceTimersByTimeAsync(500); expect(runner.job).toMatchObject({ step: 4, current: 3, status: 'login_paused', service: 'naver' });
    const completed = states.filter(j => j.step === 2).length;
    await runner.resume(); await vi.advanceTimersByTimeAsync(500); expect(runner.job?.status).toBe('draft_saved'); expect(states.filter(j => j.step === 2)).toHaveLength(completed); runner.dispose();
  });
  it('exposes failure and supports retry at the checkpoint; publish is a separate outcome', async () => {
    const { runner } = runnerFixture({ failAt: 6 }); await runner.start({ ...input, mode: 'publish', publishConfirmed: true }, '예시', 5);
    await vi.advanceTimersByTimeAsync(500); expect(runner.job).toMatchObject({ step: 6, status: 'failed' });
    await runner.resume(); await vi.advanceTimersByTimeAsync(500); expect(runner.job?.status).toBe('published'); runner.dispose();
  });
});
describe('UI/core boundary', () => {
  const publishInput = { ...input, mode: 'publish' as const, publishConfirmed: true };
  async function fixture() {
    const app = new AppCore(createFakeApi()); const call = (command: AppRequest['command'], value: unknown = {}) => app.handle({ id: 1, type: 'app', command, input: value } as AppRequest);
    await call('login', { loginId: 'manager', password: 'demo', device: { kind: 'android', model: 'test', appVersion: '0.1.0' } });
    await call('simulation.configure', { tickMs: 10 }); return { app, call };
  }
  it('keeps bearer tokens out of snapshots and rejects publish without confirmation', async () => {
    const { app, call } = await fixture(); expect(JSON.stringify(app.snapshot())).not.toContain('token');
    await expect(call('job.start', { ...input, mode: 'publish' })).rejects.toMatchObject({ code: 'invalid' });
    await Promise.all([call('job.start', publishInput), expect(call('job.start', publishInput)).rejects.toMatchObject({ code: 'conflict' })]);
    await expect(call('logout')).rejects.toMatchObject({ code: 'conflict' }); app.dispose();
  });
  it('keeps already saved blog records while a band task expires, then resumes the same records', async () => {
    const { app, call } = await fixture(); await call('simulation.configure', { loginAt: 6 }); await call('job.start', publishInput);
    await vi.advanceTimersByTimeAsync(500); expect(app.snapshot().job?.status).toBe('login_paused');
    await expect(call('job.resume')).rejects.toMatchObject({ code: 'auth' });
    const before = await call('posts.list', { scope: 'mine' }) as { items: { productNo: number; postNo: number; channel: string; status: string }[] };
    const records = before.items.filter(p => p.productNo === input.productNo); expect(records).toHaveLength(2); expect(records.find(p => p.channel === 'blog')?.status).toBe('published');
    await call('service.check', { service: 'band' }); await call('job.resume'); await vi.advanceTimersByTimeAsync(500);
    const after = await call('posts.list', { scope: 'mine' }) as typeof before;
    expect(after.items.filter(p => p.productNo === input.productNo).map(p => p.postNo)).toEqual(records.map(p => p.postNo)); expect(app.snapshot().job?.status).toBe('published'); app.dispose();
  });
});
