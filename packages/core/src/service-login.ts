import { ApiError } from '@goltou/api-client';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { loginLocation, safeFailureCode, serviceCheckUrls, serviceLoginState, serviceLoginUrls, serviceNavigationPolicy, type LoginService, type LoginState } from '@goltou/sites';

export interface LoginUpdate { service: LoginService; state: LoginState | 'checking'; visible: boolean; error?: string }
const mobileUA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const loadError = '로그인 페이지를 불러오지 못했습니다. 연결을 확인하고 다시 열어 주세요.';

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
  get active() { return !!this.operation || this.visible !== null; }
  constructor(private readonly host: SurfaceHost, private readonly timing = { pollMs: 1500, signalMs: 12000, loadMs: 30000 }) {}
  subscribe(listener: (update: LoginUpdate) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(service: LoginService, state: LoginUpdate['state'], error?: string) {
    if (!this.disposed) for (const listener of this.listeners) listener({ service, state, visible: this.visible === service, ...(error ? { error } : {}) });
  }
  private run<T>(work: () => Promise<T>): Promise<T> {
    if (this.disposed || this.operation) return Promise.reject(new ApiError('conflict', '로그인 상태를 확인 중입니다. 잠시 뒤 다시 시도해 주세요.'));
    const operation = work(); this.operation = operation;
    return operation.finally(() => { if (this.operation === operation) this.operation = undefined; });
  }
  private async surface(service: LoginService) {
    let surface = this.surfaces.get(service);
    if (!surface) {
      surface = await this.host.create(service);
      try {
        if (!surface.restrictNavigation) throw new Error('LOGIN_NAVIGATION_GUARD_REQUIRED');
        await surface.restrictNavigation(serviceNavigationPolicy(service));
        if (this.disposed) throw new Error('LOGIN_DISPOSED');
        this.surfaces.set(service, surface);
        const cancel = surface.onUserHidden?.(() => { void this.cancel().catch(() => {}); });
        const landing = surface.onNavigationHidden?.(() => { this.landings.add(service); });
        this.unsubscribes.set(service, () => { cancel?.(); landing?.(); });
      } catch (error) { await this.host.destroy(surface).catch(() => {}); throw error; }
    }
    return surface;
  }
  private async drop(service: LoginService) {
    const surface = this.surfaces.get(service);
    this.surfaces.delete(service); this.unsubscribes.get(service)?.(); this.unsubscribes.delete(service);
    this.landings.delete(service);
    if (surface) await this.host.destroy(surface).catch(() => {});
  }
  private async load(service: LoginService, url: string) {
    const surface = await this.surface(service);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let stage = 'OPEN';
    try {
      await Promise.race([
        surface.open({ url, session: service, userAgent: mobileUA, width: 412, height: 800 }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('LOGIN_LOAD_TIMEOUT')), this.timing.loadMs); }),
      ]);
      stage = 'STATE';
      const state = await surface.readState();
      if (this.disposed || state.loading || loginLocation(service, state.url) === 'blocked') throw new Error('LOGIN_PAGE_NOT_READY');
      return surface;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = /^net::ERR_[A-Z_]+$/.test(message) ? message.slice(5) : safeFailureCode(error, 'NAVIGATION_FAILED');
      console.info('SERVICE_LOGIN_LOAD_FAILED', service, stage, code);
      await this.drop(service); throw error;
    }
    finally { clearTimeout(timeout); }
  }
  private async signal(surface: Surface) {
    const deadline = Date.now() + this.timing.signalMs;
    do {
      if (this.disposed) throw new Error('LOGIN_DISPOSED');
      const state = await serviceLoginState(surface);
      if (state !== 'unknown') return state;
      await new Promise(resolve => setTimeout(resolve, this.timing.pollMs));
    } while (Date.now() < deadline);
    return 'unknown' as const;
  }
  check(service: LoginService): Promise<LoginState> {
    if (this.visible) return Promise.reject(new ApiError('conflict', '로그인 화면을 먼저 닫아 주세요.'));
    return this.run(async () => {
      this.emit(service, 'checking');
      try {
        const state = await this.signal(await this.load(service, serviceCheckUrls[service]));
        this.emit(service, state, state === 'unknown' ? '연결 상태를 확인하지 못했습니다. 다시 확인을 눌러 주세요.' : undefined); return state;
      } catch { this.emit(service, 'unknown', '연결 상태를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 확인을 눌러 주세요.'); return 'unknown'; }
    });
  }
  show(service: LoginService): Promise<void> {
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
        await surface.show(); this.visible = service; this.generation++;
        this.emit(service, state); this.schedulePoll();
      } catch {
        await this.drop(service); this.visible = null; this.emit(service, 'unknown', loadError);
        throw new ApiError('server', loadError);
      }
    });
  }
  private schedulePoll() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.poll(); }, this.timing.pollMs);
  }
  private async poll() {
    const service = this.visible, generation = this.generation;
    if (!service || this.disposed) return;
    const operation = (async () => {
      try {
        let surface = this.surfaces.get(service)!;
        const location = await surface.readState();
        if (this.landings.delete(service) || loginLocation(service, location.url) === 'landing') {
          await surface.hide();
          const result = await this.signal(await this.load(service, serviceCheckUrls[service]));
          if (generation !== this.generation) return;
          this.visible = null; this.emit(service, result, result === 'unknown' ? loadError : undefined);
          return;
        }
        if (location.loading) return;
        if (loginLocation(service, location.url) === 'blocked') {
          await surface.hide(); surface = await this.load(service, serviceLoginUrls[service]);
          if (generation !== this.generation) return;
          await surface.show();
        }
        const state = await serviceLoginState(surface);
        if (generation !== this.generation) return;
        if (state === 'confirmed') {
          await surface.hide(); this.visible = null; this.emit(service, state);
        }
      } catch {
        if (generation !== this.generation) return;
        await this.drop(service); this.visible = null; this.emit(service, 'unknown', loadError);
      }
    })();
    this.operation = operation;
    try { await operation; } finally { if (this.operation === operation) this.operation = undefined; }
    if (this.visible && generation === this.generation) this.schedulePoll();
  }
  async cancel() {
    const service = this.visible;
    if (!service) return;
    this.generation++; clearTimeout(this.timer);
    // Keep the visible lock until the in-flight read and final hidden recheck finish.
    await this.operation;
    return this.run(async () => {
      await this.surfaces.get(service)?.hide();
      this.visible = null; this.emit(service, 'checking');
      try { this.emit(service, await this.signal(await this.load(service, serviceCheckUrls[service]))); }
      catch { this.emit(service, 'unknown'); }
    });
  }
  clear(service: LoginService): Promise<void> {
    if (this.visible) return Promise.reject(new ApiError('conflict', '로그인 화면을 먼저 닫아 주세요.'));
    return this.run(async () => {
      await this.drop(service);
      try { await this.host.clearSession(service); this.emit(service, 'expired'); }
      catch { this.emit(service, 'unknown', '연결을 끊지 못했습니다. 다시 확인해 주세요.'); throw new ApiError('server', '연결을 끊지 못했습니다. 다시 확인해 주세요.'); }
    });
  }
  dispose() {
    this.disposed = true; this.generation++; clearTimeout(this.timer); this.visible = null;
    for (const service of this.surfaces.keys()) void this.drop(service);
    this.listeners.clear();
  }
}
