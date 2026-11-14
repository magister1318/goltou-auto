import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Surface, SurfaceHost, SurfaceSession, SurfaceState } from '@goltou/surface';
import { serviceCheckUrls, serviceLoginUrls } from '@goltou/sites';
import { createFakeApi } from '@goltou/api-client';
import { ServiceLoginController, type LoginUpdate } from '../src/service-login';
import { AppCore } from '../src/app';
import { ChannelRegistrationRunner } from '../src/band-runner';
import { BlogRegistrationRunner } from '../src/blog-runner';
import type { AppRequest, Job, JobInput } from '../src/protocol';
import type { RegistrationRunner } from '../src/runner';

const disposals: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { disposals.splice(0).forEach(fn => fn()); vi.useRealTimers(); });
function fixture() {
  const signals = { naver: 'expired', band: 'expired', ai: 'unknown' } as Record<SurfaceSession, 'expired' | 'confirmed' | 'unknown'>;
  const surfaces: Surface[] = [];
  const hiddenListeners: (() => void)[] = [];
  const navigationListeners: (() => void)[] = [];
  const host: SurfaceHost = {
    create: vi.fn(async (session: SurfaceSession) => {
      let state: SurfaceState = { url: 'about:blank', loading: false, title: '' };
      const surface: Surface = {
        session, open: vi.fn(async options => { state = { url: options.url, title: '', loading: false }; }),
        readState: vi.fn(async () => state), waitForNavigation: vi.fn(async () => state),
        evaluateReadOnly: vi.fn(async () => signals[session]) as Surface['evaluateReadOnly'],
        restrictNavigation: vi.fn(async () => {}),
        onUserHidden: listener => { hiddenListeners.push(listener); return () => {}; },
        onNavigationHidden: listener => { navigationListeners.push(listener); return () => {}; },
        show: vi.fn(async () => {}), hide: vi.fn(async () => {}), close: vi.fn(async () => {}),
        click: vi.fn(), typeText: vi.fn(), pressKey: vi.fn(), attachFiles: vi.fn(),
      };
      surfaces.push(surface); return surface;
    }),
    destroy: vi.fn(async surface => { await surface.close(); }), clearSession: vi.fn(),
  };
  const controller = new ServiceLoginController(host, { pollMs: 1500, signalMs: 3000, loadMs: 5000 });
  disposals.push(() => controller.dispose());
  const updates: LoginUpdate[] = [];
  controller.subscribe(update => updates.push(update));
  return { host, signals, surfaces, hiddenListeners, navigationListeners, controller, updates };
}

describe('WP15 on-demand login lifecycle', () => {
  it.each(['naver', 'band'] as const)('creates %s in its persistent session, guards and loads before showing, then reuses it', async service => {
    const f = fixture(); await f.controller.show(service);
    expect(f.host.create).toHaveBeenCalledExactlyOnceWith(service);
    const s = f.surfaces[0]!;
    expect(s.restrictNavigation).toHaveBeenCalledOnce();
    expect(s.open).toHaveBeenNthCalledWith(1, expect.objectContaining({ url: serviceCheckUrls[service], session: service }));
    expect(s.open).toHaveBeenLastCalledWith(expect.objectContaining({ url: serviceLoginUrls[service] }));
    expect(vi.mocked(s.restrictNavigation!).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(s.open).mock.invocationCallOrder[0]!);
    expect(vi.mocked(s.open).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(s.show).mock.invocationCallOrder[0]!);
    await f.controller.cancel(); await f.controller.show(service); expect(f.host.create).toHaveBeenCalledOnce();
    for (const method of [s.click, s.typeText, s.pressKey, s.attachFiles, f.host.clearSession]) expect(method).not.toHaveBeenCalled();
  });
  it.each(['open failure', 'blank', 'loading', 'outside', 'timeout', 'missing guard'] as const)('never shows a surface on %s and supports retry', async failure => {
    const f = fixture();
    const create = f.host.create;
    f.host.create = vi.fn(async session => {
      const s = await create(session);
      if (failure === 'open failure') s.open = vi.fn(async () => { throw Error('PRIVATE_NETWORK_DETAILS'); });
      if (failure === 'timeout') s.open = vi.fn(() => new Promise<void>(() => {}));
      if (['blank', 'loading', 'outside'].includes(failure)) s.readState = vi.fn(async () => ({ url: failure === 'outside' ? 'https://example.com/' : 'about:blank', title: '', loading: failure === 'loading' }));
      if (failure === 'missing guard') delete s.restrictNavigation;
      return s;
    });
    const result = expect(f.controller.show('naver')).rejects.toMatchObject({ message: expect.stringContaining('다시 열어') });
    await vi.advanceTimersByTimeAsync(6000); await result;
    expect(f.surfaces[0]!.show).not.toHaveBeenCalled(); expect(f.updates.at(-1)).toMatchObject({ state: 'unknown', visible: false });
    expect(JSON.stringify(f.updates)).not.toContain('PRIVATE');
    f.host.create = create; await f.controller.show('naver'); expect(f.surfaces[1]!.show).toHaveBeenCalledOnce();
  });
  it.each(['naver', 'band'] as const)('does not show %s when its hidden profile is already authenticated', async service => {
    const f = fixture(); f.signals[service] = 'confirmed'; await f.controller.show(service);
    expect(f.updates.at(-1)).toMatchObject({ state: 'confirmed', visible: false }); expect(f.surfaces[0]!.show).not.toHaveBeenCalled(); expect(f.controller.active).toBe(false);
  });
  it('polls gently, confirms and hides automatically without a cancel input', async () => {
    const f = fixture(); await f.controller.show('band'); const s = f.surfaces[0]!;
    const reads = vi.mocked(s.evaluateReadOnly).mock.calls.length;
    await vi.advanceTimersByTimeAsync(1499); expect(s.evaluateReadOnly).toHaveBeenCalledTimes(reads);
    f.signals.band = 'confirmed'; await vi.advanceTimersByTimeAsync(1);
    expect(s.hide).toHaveBeenCalledOnce(); expect(f.updates.at(-1)).toEqual({ service: 'band', state: 'confirmed', visible: false });
    const done = vi.mocked(s.evaluateReadOnly).mock.calls.length; await vi.advanceTimersByTimeAsync(10000); expect(s.evaluateReadOnly).toHaveBeenCalledTimes(done);
  });
  it('checks the profile after the shell hides a post-auth landing, even while that page is loading', async () => {
    const f = fixture(); await f.controller.show('naver'); const s = f.surfaces[0]!;
    f.signals.naver = 'confirmed';
    vi.mocked(s.readState).mockResolvedValueOnce({ url: serviceLoginUrls.naver, title: '', loading: true });
    f.navigationListeners[0]!(); await vi.advanceTimersByTimeAsync(1500);
    expect(s.open).toHaveBeenLastCalledWith(expect.objectContaining({ url: serviceCheckUrls.naver }));
    expect(s.show).toHaveBeenCalledOnce(); expect(f.updates.at(-1)).toMatchObject({ state: 'confirmed', visible: false });
  });
  it('cancels an in-flight poll before its final hidden recheck, with no late confirmation or re-show', async () => {
    const f = fixture(); await f.controller.show('naver'); const s = f.surfaces[0]!;
    let release!: (state: 'confirmed') => void;
    vi.mocked(s.evaluateReadOnly).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await vi.advanceTimersByTimeAsync(1500); const cancel = f.controller.cancel();
    release('confirmed'); await cancel;
    expect(f.updates.at(-1)).toMatchObject({ state: 'expired', visible: false });
    expect(s.show).toHaveBeenCalledOnce(); expect(f.controller.active).toBe(false);
  });
  it('does not show a page when the native load/HTTP readiness gate rejects visibility', async () => {
    const f = fixture();
    const create = f.host.create;
    f.host.create = async session => { const s = await create(session); vi.mocked(s.show).mockRejectedValue(Error('LOGIN_PAGE_NOT_READY')); return s; };
    await expect(f.controller.show('naver')).rejects.toMatchObject({ code: 'server' });
    expect(f.host.destroy).toHaveBeenCalledOnce(); expect(f.updates.at(-1)).toMatchObject({ visible: false, state: 'unknown' });
  });
  it.each(['expired', 'confirmed', 'unknown'] as const)('cancel rechecks the hidden profile once and reports %s', async state => {
    const f = fixture(); await f.controller.show('naver'); f.signals.naver = state;
    f.hiddenListeners[0]!(); await vi.advanceTimersByTimeAsync(5000);
    expect(f.surfaces[0]!.hide).toHaveBeenCalledOnce(); expect(f.surfaces[0]!.open).toHaveBeenCalledTimes(3);
    expect(f.updates.at(-1)).toMatchObject({ state, visible: false }); expect(f.controller.active).toBe(false);
  });
  it('returns to the guarded login entry if history changes to a forbidden location', async () => {
    const f = fixture(); await f.controller.show('naver'); const s = f.surfaces[0]!;
    vi.mocked(s.readState).mockResolvedValueOnce({ url: 'https://blog.naver.com/GoBlogWrite.naver', title: '', loading: false });
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.hide).toHaveBeenCalledOnce(); expect(s.open).toHaveBeenLastCalledWith(expect.objectContaining({ url: serviceLoginUrls.naver }));
    expect(s.show).toHaveBeenCalledTimes(2);
  });
  it('hides and reports a retryable error when polling loses the page', async () => {
    const f = fixture(); await f.controller.show('naver'); vi.mocked(f.surfaces[0]!.readState).mockRejectedValue(Error('offline'));
    await vi.advanceTimersByTimeAsync(1500); expect(f.updates.at(-1)).toMatchObject({ state: 'unknown', visible: false, error: expect.stringContaining('다시 열어') });
    expect(f.host.destroy).toHaveBeenCalledOnce();
  });
  it('serializes checks and opening across services', async () => {
    const f = fixture(); f.signals.naver = 'unknown'; const check = f.controller.check('naver');
    await expect(f.controller.show('band')).rejects.toMatchObject({ code: 'conflict' });
    await vi.advanceTimersByTimeAsync(4000); await check; expect(f.host.create).toHaveBeenCalledTimes(1);
  });
});

const input: JobInput = { productNo: 1237, mode: 'draft', targets: [{ channel: 'blog', name: '해외골프', key: 'overseas' }], options: { polish: false, closing: false, linkCard: false } };
async function appFixture() {
  const f = fixture();
  const runner: RegistrationRunner = {
    job: null, serviceLogin: f.controller, checkLogin: () => f.controller.check('naver'), checkBandLogin: () => f.controller.check('band'),
    listBands: async () => [], showService: async s => { if (s !== 'ai') await f.controller.show(s); }, hideService: () => f.controller.cancel(),
    start: vi.fn(async () => { Object.assign(runner, { job: { status: 'running' } as Job }); }),
    stop: vi.fn(), resume: vi.fn(), dispose: () => f.controller.dispose(),
  };
  const api = createFakeApi(), request = vi.spyOn(api, 'request');
  const app = new AppCore(api, undefined, () => runner);
  disposals.push(() => app.dispose());
  const call = (command: AppRequest['command'], value: unknown = {}) => app.handle({ id: 1, type: 'app', command, input: value } as AppRequest);
  return { ...f, app, call, runner, request };
}
describe('WP15 background scheduling and job exclusion', () => {
  it('checks after launch without Goltou login, one service at a time, exposing checking', async () => {
    const f = await appFixture(); f.signals.naver = 'unknown'; f.signals.band = 'confirmed';
    expect(f.app.snapshot().services).toMatchObject({ naver: 'unknown', band: 'unknown' });
    await vi.advanceTimersByTimeAsync(800); expect(f.app.snapshot().services.naver).toBe('checking'); expect(f.host.create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000); expect(f.host.create).toHaveBeenCalledTimes(2); expect(f.app.snapshot().services).toMatchObject({ naver: 'unknown', band: 'confirmed' });
  });
  it('rechecks after Goltou login and only after a long background interval', async () => {
    const f = await appFixture(); f.signals.naver = f.signals.band = 'confirmed'; await vi.advanceTimersByTimeAsync(2000);
    expect(f.app.snapshot().services).toMatchObject({ naver: 'confirmed', band: 'confirmed' });
    const naver = f.surfaces[0]!; expect(naver.open).toHaveBeenCalledTimes(1);
    f.app.serviceRuntimeReady(); await vi.advanceTimersByTimeAsync(2000); expect(naver.open).toHaveBeenCalledTimes(2);
    f.app.foregrounded(1000); await vi.advanceTimersByTimeAsync(2000); expect(naver.open).toHaveBeenCalledTimes(2);
    f.app.foregrounded(300000); await vi.advanceTimersByTimeAsync(2000); expect(naver.open).toHaveBeenCalledTimes(3);
    await f.call('login', { loginId: 'manager', password: 'demo', device: { kind: 'android', model: 'fixture', appVersion: '0.1.0' } });
    await vi.advanceTimersByTimeAsync(2000); expect(naver.open).toHaveBeenCalledTimes(4);
  });
  it('defers background checks for every unfinished job, then checks when idle', async () => {
    const f = await appFixture(); Object.assign(f.runner, { job: { status: 'running' } });
    await vi.advanceTimersByTimeAsync(10000); expect(f.host.create).not.toHaveBeenCalled();
    Object.assign(f.runner, { job: { status: 'login_paused' } }); await vi.advanceTimersByTimeAsync(2000); expect(f.host.create).not.toHaveBeenCalled();
    Object.assign(f.runner, { job: { status: 'draft_saved' } }); await vi.advanceTimersByTimeAsync(2000); expect(f.host.create).toHaveBeenCalledTimes(2);
  });
  it('blocks a job before any product/record request during loading, visible login and hidden check', async () => {
    const f = await appFixture();
    await f.call('login', { loginId: 'manager', password: 'demo', device: { kind: 'android', model: 'fixture', appVersion: '0.1.0' } });
    for (const operation of [() => f.controller.show('naver'), () => f.controller.check('band')]) {
      const pending = operation(); const before = f.request.mock.calls.length;
      await expect(f.call('job.start', input)).rejects.toMatchObject({ code: 'conflict' }); expect(f.request).toHaveBeenCalledTimes(before);
      await pending;
      if (f.app.snapshot().visibleService) { await expect(f.call('job.start', input)).rejects.toMatchObject({ code: 'conflict' }); await f.controller.cancel(); }
    }
  });
  it.each(['running', 'user_paused', 'dialog_paused', 'recovery_paused', 'record_failed', 'failed', 'stopped_before_post'] as const)('rejects login opening/check while job is %s', async status => {
    const f = await appFixture(); await f.call('login', { loginId: 'manager', password: 'demo', device: { kind: 'android', model: 'fixture', appVersion: '0.1.0' } });
    Object.assign(f.runner, { job: { status } }); f.app.state.job = f.runner.job;
    await expect(f.call('service.show', { service: 'naver' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(f.call('service.check', { service: 'naver' })).rejects.toMatchObject({ code: 'conflict' }); expect(f.host.create).not.toHaveBeenCalled();
  });
  it('allows relogin only in login_paused, auto-confirms and preserves the paused job', async () => {
    const f = await appFixture(); await f.call('login', { loginId: 'manager', password: 'demo', device: { kind: 'android', model: 'fixture', appVersion: '0.1.0' } });
    Object.assign(f.runner, { job: { status: 'login_paused', service: 'naver' } });
    await f.call('service.show', { service: 'naver' }); expect(f.app.snapshot().visibleService).toBe('naver');
    await expect(f.call('job.resume')).rejects.toMatchObject({ code: 'conflict' });
    f.signals.naver = 'confirmed'; await vi.advanceTimersByTimeAsync(1500);
    expect(f.app.snapshot()).toMatchObject({ services: { naver: 'confirmed' }, visibleService: null }); expect(f.runner.job?.status).toBe('login_paused');
  });
  it.each(['channel', 'blog'] as const)('%s runner opens on demand without a job and enforces its own job guard', async kind => {
    const f = fixture(); const runner = kind === 'channel' ? new ChannelRegistrationRunner({ band: { host: f.host }, blog: { host: f.host } }, async () => {}, () => {}) : new BlogRegistrationRunner({ host: f.host }, async () => {}, () => {});
    disposals.push(() => runner.dispose()); await runner.showService('naver'); expect(f.host.create).toHaveBeenCalledWith('naver');
    await expect(runner.start(input, 'fixture', 0)).rejects.toMatchObject({ code: 'conflict' });
    await runner.hideService(); runner.job = { status: 'running' } as Job;
    await expect(runner.showService('naver')).rejects.toMatchObject({ code: 'conflict' });
  });
});
