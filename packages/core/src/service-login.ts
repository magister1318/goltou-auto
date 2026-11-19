import { traceStep, trace, reasonCode, traceJob } from '@goltou/surface/telemetry';
import { ApiError } from '@goltou/api-client';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { loginLocation, serviceCheckUrls, serviceLoginState, serviceLoginUrls, serviceNavigationPolicy, type LoginService, type LoginState } from '@goltou/sites';

export interface LoginUpdate { service: LoginService; state: LoginState | 'checking'; visible: boolean; error?: string }
const mobileUA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const loadError = '로그인 페이지를 불러오지 못했습니다. 연결을 확인하고 다시 열어 주세요.';
const retryError = '로그인을 마치지 못했습니다. 다시 시도해 주세요.';

function interruptible<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('LOGIN_DISPOSED'));
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Separate from editors, sharing only the shell's existing persistent service profile. */
export class ServiceLoginController {
  private surfaces = new Map<LoginService, Surface>();
  private unsubscribes = new Map<LoginService, () => void>();
  private listeners = new Set<(update: LoginUpdate) => void>();
  private landings = new Set<LoginService>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private operation: Promise<unknown> | undefined;
  private disposed = false;
  private generation = 0;
  private visible: LoginService | null = null;
  private states = new Map<LoginService, LoginUpdate['state']>();
  private retries = 0;
  private backgroundTimer: ReturnType<typeof setTimeout> | undefined;
  private backgroundOperation: Promise<void> | undefined;
  private backgroundAbort: AbortController | undefined;
  get active() { return !!this.operation || this.visible !== null; }
  constructor(private readonly host: SurfaceHost, private readonly timing = { pollMs: 1500, signalMs: 12000, loadMs: 30000 }) {}
  subscribe(listener: (update: LoginUpdate) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(service: LoginService, state: LoginUpdate['state'], error?: string) {
    this.states.set(service, state);
    if (!this.disposed) for (const listener of this.listeners) listener({ service, state, visible: this.visible === service, ...(error ? { error } : {}) });
  }
  private run<T>(work: () => Promise<T>): Promise<T> {
    if (this.disposed || this.operation) return Promise.reject(new ApiError('conflict', '로그인 상태를 확인 중입니다. 잠시 뒤 다시 시도해 주세요.'));
    const operation = work(); this.operation = operation;
    return operation.finally(() => { if (this.operation === operation) this.operation = undefined; });
  }
  private async surface(service: LoginService) {
    return traceStep('core.service-login.ServiceLoginController.surface', async () => {
    let surface = this.surfaces.get(service);
    if (!surface) {
      surface = await this.host.create(service);
      try {
        if (!surface.restrictNavigation) throw new Error('LOGIN_NAVIGATION_GUARD_REQUIRED');
        await surface.restrictNavigation(serviceNavigationPolicy(service));
        if (this.disposed) throw new Error('LOGIN_DISPOSED');
        this.surfaces.set(service, surface);
        const cancel = surface.onUserHidden?.(() => { void this.cancel().catch(() => {}); });
        const landing = surface.onNavigationHidden?.(() => {
          if (this.visible !== service) return;
          this.landings.add(service);
          if (!this.operation) this.schedulePoll(0);
        });
        this.unsubscribes.set(service, () => { cancel?.(); landing?.(); });
      } catch (error) { trace('core.service-login.ServiceLoginController.surface', 'fail', { reason: reasonCode(error) });  await this.host.destroy(surface).catch(() => {}); throw error; }
    }
    return surface;

    });
  }
  private async drop(service: LoginService) {
    return traceStep('core.service-login.ServiceLoginController.drop', async () => {
    const surface = this.surfaces.get(service);
    this.surfaces.delete(service); this.unsubscribes.get(service)?.(); this.unsubscribes.delete(service);
    this.landings.delete(service);
    if (surface) await this.host.destroy(surface).catch(() => {});

    });
  }
  private async load(service: LoginService, url: string) {
    return traceStep('core.service-login.ServiceLoginController.load', async () => {
    const surface = await this.surface(service);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        surface.open({ url, session: service, userAgent: mobileUA, width: 412, height: 800 }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('LOGIN_LOAD_TIMEOUT')), this.timing.loadMs); }),
      ]);
      const state = await surface.readState();
      if (this.disposed || state.loading || loginLocation(service, state.url) === 'blocked') throw new Error('LOGIN_PAGE_NOT_READY');
      return surface;
    } catch (error) { trace('core.service-login.ServiceLoginController.load', 'fail', { reason: reasonCode(error) });
      await this.drop(service); throw error;
    }
    finally { clearTimeout(timeout); }

    });
  }
  private async signal(surface: Surface, abort?: AbortSignal) {
    return traceStep('core.service-login.ServiceLoginController.signal', async () => {
    const deadline = Date.now() + this.timing.signalMs;
    do {
      if (this.disposed || abort?.aborted) throw new Error('LOGIN_DISPOSED');
      const read = serviceLoginState(surface);
      const state = await (abort ? interruptible(read, abort) : read);
      if (state !== 'unknown') {
        trace('core.service-login.ServiceLoginController.signal', 'ok', state === 'expired' ? { reason: 'LOGIN_REQUIRED' } : undefined);
        trace(state === 'confirmed' ? 'CONNECTION_CHECK_CONFIRMED' : 'CONNECTION_CHECK_NOT_CONFIRMED', 'ok');
        return state;
      }
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(new Error('LOGIN_DISPOSED')); };
        const timer = setTimeout(() => { abort?.removeEventListener('abort', stop); resolve(); }, this.timing.pollMs);
        abort?.addEventListener('abort', stop, { once: true });
      });
    } while (Date.now() < deadline);
    trace('CONNECTION_CHECK_NOT_CONFIRMED', 'ok');
    return 'unknown' as const;

    });
  }
  check(service: LoginService): Promise<LoginState> {
    let failure = reasonCode('LOGIN_UNCONFIRMED');
    return traceJob('login_check', service === 'naver' ? 'naver' : 'band', async () => {
      if (this.visible) throw new ApiError('conflict', '로그인 화면을 먼저 닫아 주세요.');
      return this.run(async () => {
      this.emit(service, 'checking');
      try {
        const state = await this.signal(await this.load(service, serviceCheckUrls[service]));
        this.emit(service, state, state === 'unknown' ? '연결 상태를 확인하지 못했습니다. 다시 확인을 눌러 주세요.' : undefined); return state;
      } catch (error) { failure = reasonCode(error); trace('core.service-login.ServiceLoginController.load', 'fail', { reason: failure }); this.emit(service, 'unknown', '연결 상태를 확인하지 못했습니다. 다시 확인을 눌러 주세요.'); return 'unknown'; }
    });
    }, value => value !== 'unknown' ? { result: 'succeeded' } : { result: 'failed', reason: failure });
  }
  show(service: LoginService): Promise<void> {
    return traceJob('login_check', service === 'naver' ? 'naver' : 'band', async () => {
    if (this.visible) return Promise.reject(new ApiError('conflict', '열린 로그인 화면을 먼저 닫아 주세요.'));
    return this.run(async () => {
      this.emit(service, 'checking');
      try {
        // An existing authenticated profile never needs a visible login screen.
        const checked = await this.signal(await this.load(service, serviceCheckUrls[service]));
        if (checked === 'confirmed') { this.emit(service, checked); return; }
        const surface = await this.load(service, serviceLoginUrls[service]);
        const state = await this.signal(surface);
        if (state === 'confirmed') { this.emit(service, state); return; }
        if (loginLocation(service, (await surface.readState()).url) !== 'auth') throw new Error('LOGIN_PAGE_NOT_READY');
        this.visible = service; this.generation++; this.retries = 0;
        await surface.show();
        this.emit(service, state); this.schedulePoll(); this.scheduleBackground(service, this.generation);
      } catch (error) {
        trace('core.service-login.ServiceLoginController.load', 'fail', { reason: reasonCode(error) });
        await this.drop(service); this.visible = null; this.emit(service, 'unknown', loadError);
        throw new ApiError('server', loadError);
      }
    });
    }, () => this.visible ? { result: 'stopped', reason: 'LOGIN_UNCONFIRMED' } : { result: 'succeeded' });
  }
  private schedulePoll(delay = this.timing.pollMs) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.poll(); }, delay);
  }
  private scheduleBackground(service: LoginService, generation: number, delay = 3000) {
    clearTimeout(this.backgroundTimer);
    this.backgroundTimer = setTimeout(() => {
      if (this.disposed || generation !== this.generation || this.visible !== service) return;
      if (this.operation) { this.scheduleBackground(service, generation, this.timing.pollMs); return; }
      const operation = traceJob('login_check', service, async () => {
        try {
          if (await this.backgroundCheck(service) === 'confirmed') await this.confirm(service, generation);
        } catch (error) {
          if (generation === this.generation) trace('CONNECTION_CHECK_NOT_CONFIRMED', 'fail', { reason: reasonCode(error) });
        }
      });
      this.backgroundOperation = operation;
      void operation.finally(() => {
        if (this.backgroundOperation === operation) this.backgroundOperation = undefined;
        if (!this.disposed && generation === this.generation && this.visible === service) this.scheduleBackground(service, generation);
      }).catch(() => {});
    }, delay);
  }
  private async backgroundCheck(service: LoginService): Promise<LoginState> {
    const abort = new AbortController(); this.backgroundAbort = abort;
    let surface: Surface | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // A distinct target shares only the service profile, never the visible document.
      const creating = this.host.create(service).then(async created => {
        if (abort.signal.aborted) { await this.host.destroy(created); throw new Error('LOGIN_DISPOSED'); }
        return created;
      });
      surface = await interruptible(creating, abort.signal);
      if (!surface.restrictNavigation) throw new Error('LOGIN_NAVIGATION_GUARD_REQUIRED');
      await interruptible(surface.restrictNavigation(serviceNavigationPolicy(service)), abort.signal);
      const opening = surface.open({ url: serviceCheckUrls[service], session: service, userAgent: mobileUA, width: 412, height: 800 });
      await interruptible(Promise.race([opening, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('LOGIN_LOAD_TIMEOUT')), this.timing.loadMs);
      })]), abort.signal);
      return await this.signal(surface, abort.signal);
    } finally {
      clearTimeout(timeout);
      if (surface) await this.host.destroy(surface).catch(() => {});
      if (this.backgroundAbort === abort) this.backgroundAbort = undefined;
    }
  }
  private async confirm(service: LoginService, generation: number, hidden = false) {
    if (generation !== this.generation) return;
    const finishing = ++this.generation;
    clearTimeout(this.timer); clearTimeout(this.backgroundTimer); this.backgroundAbort?.abort();
    if (!hidden) await this.surfaces.get(service)?.hide();
    if (finishing !== this.generation) return;
    this.visible = null; clearTimeout(this.timer); this.emit(service, 'confirmed');
  }
  private async recover(service: LoginService, generation: number) {
    clearTimeout(this.backgroundTimer); this.backgroundAbort?.abort();
    await this.backgroundOperation;
    if (generation !== this.generation) return;
    this.landings.delete(service);
    const surface = this.surfaces.get(service)!;
    await surface.hide();
    const state = await this.signal(await this.load(service, serviceCheckUrls[service]));
    if (generation !== this.generation) return;
    if (state === 'confirmed') { await this.confirm(service, generation, true); return; }
    if (++this.retries >= 3) {
      trace('CONNECTION_RETRY_LIMIT', 'ok', { counts: { attempt: this.retries } });
      this.visible = null; this.emit(service, 'unknown', retryError); return;
    }
    const login = await this.load(service, serviceLoginUrls[service]);
    if (generation !== this.generation) return;
    await login.show();
    if (generation !== this.generation) { await login.hide(); return; }
    this.emit(service, state); this.scheduleBackground(service, generation);
  }
  private async poll() {
    const service = this.visible;
    if (!service || this.disposed || this.operation) return;
    return traceJob('login_check', service === 'naver' ? 'naver' : 'band', async () => {
    return traceStep('core.service-login.ServiceLoginController.poll', async () => {
    const generation = this.generation;
    const operation = (async () => {
      try {
        const surface = this.surfaces.get(service)!;
        const location = await surface.readState();
        if (generation !== this.generation) return;
        if (this.landings.has(service) || loginLocation(service, location.url) !== 'auth') { await this.recover(service, generation); return; }
        if (location.loading) return;
        const state = await serviceLoginState(surface);
        if (generation !== this.generation) return;
        if (state === 'confirmed') {
          trace('CONNECTION_CHECK_CONFIRMED', 'ok');
          await this.confirm(service, generation);
        }
      } catch { trace('core.service-login.ServiceLoginController.poll', 'fail', { reason: 'CAUGHT_FAILURE' });
        if (generation !== this.generation) return;
        clearTimeout(this.backgroundTimer); this.backgroundAbort?.abort();
        await this.backgroundOperation;
        await this.drop(service); this.visible = null; this.emit(service, 'unknown', loadError);
      }
    })();
    this.operation = operation;
    try { await operation; } finally { if (this.operation === operation) this.operation = undefined; }
    if (this.visible && generation === this.generation) this.schedulePoll(this.landings.has(service) ? 0 : this.timing.pollMs);

    });
    }, () => this.states.get(service) === 'confirmed' ? { result: 'succeeded' } : { result: this.visible ? 'stopped' : 'failed', reason: 'LOGIN_UNCONFIRMED' });
  }
  async cancel() {
    const service = this.visible;
    if (!service) return;
    return traceJob('login_check', service === 'naver' ? 'naver' : 'band', async () => {
    return traceStep('core.service-login.ServiceLoginController.cancel', async () => {
    this.generation++; clearTimeout(this.timer); clearTimeout(this.backgroundTimer);
    this.backgroundAbort?.abort();
    await this.surfaces.get(service)?.hide();
    // Keep the visible lock until the in-flight read and final hidden recheck finish.
    await Promise.all([this.operation, this.backgroundOperation]);
    return this.run(async () => {
      this.landings.delete(service);
      this.visible = null; this.emit(service, 'checking');
      try { this.emit(service, await this.signal(await this.load(service, serviceCheckUrls[service]))); }
      catch { trace('core.service-login.ServiceLoginController.cancel', 'fail', { reason: 'CAUGHT_FAILURE' });  this.emit(service, 'unknown'); }
    });

    });
    }, () => this.states.get(service) === 'confirmed' ? { result: 'succeeded' } : { result: 'stopped', reason: 'USER_STOPPED' });
  }
  clear(service: LoginService): Promise<void> {
    return traceJob('login_check', service === 'naver' ? 'naver' : 'band', async () => {
    if (this.visible) return Promise.reject(new ApiError('conflict', '로그인 화면을 먼저 닫아 주세요.'));
    return this.run(async () => {
      await this.drop(service);
      try { await this.host.clearSession(service); this.emit(service, 'expired'); }
      catch (error) { trace('core.service-login.ServiceLoginController.drop', 'fail', { reason: reasonCode(error) }); this.emit(service, 'unknown', '연결을 끊지 못했습니다. 다시 확인해 주세요.'); throw new ApiError('server', '연결을 끊지 못했습니다. 다시 확인해 주세요.'); }
    });
    });
  }
  dispose() {
    this.disposed = true; this.generation++; clearTimeout(this.timer); clearTimeout(this.backgroundTimer); this.visible = null;
    this.backgroundAbort?.abort();
    for (const service of this.surfaces.keys()) void this.drop(service);
    this.listeners.clear();
  }
}
