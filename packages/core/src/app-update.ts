import type { AppRelease } from '@goltou/api-client';
import type { TraceJob } from '@goltou/surface/telemetry';
import { reasonCode } from '@goltou/surface/telemetry';
import type { UpdateDiagnostic } from '../../surface/src/update-diagnostics';
import type { JobLogStore } from './job-logs';

export type ReadyRelease = Extract<AppRelease, { ready: true }>;
export interface InstalledVersion { name: string; code: number }
export interface UpdateMemory { lastCheck?: number; hiddenDay?: string; installed?: InstalledVersion }
export interface UpdateStore { read(): Promise<UpdateMemory>; write(value: UpdateMemory): Promise<void> }
export interface UpdatePort {
  info(): Promise<InstalledVersion>;
  download(release: ReadyRelease): Promise<void>;
  cancel(): Promise<void>;
  install(): Promise<'permission' | 'launched'>;
  settings(): Promise<void>;
}
export interface UpdateSnapshot {
  current: string;
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'permission' | 'installing' | 'error';
  release?: { version: string; date: string; size: number };
  notice: boolean; sheet: boolean; bytes: number; percent: number;
}
export const updateFailureMessage = '업데이트 파일을 확인하지 못했습니다. 잠시 뒤 다시 해 주세요.';
const finalStatuses = ['draft_saved', 'draft_unverified', 'published', 'stopped'];
/** Same conservative boundary as registration UI: paused/failed/record pending are unfinished. */
export function updateJobBusy(job: { status: string } | null | undefined) { return !!job && !finalStatuses.includes(job.status); }
export function localUpdateDay(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
export function releaseVersionName(version: string) { return version.replace(/\s*\(\d+\)$/, ''); }
const versionLabel = (v: InstalledVersion) => `${v.name} (${v.code})`;

/** Platform-independent policy. Links remain private to this controller and the native download. */
export class AppUpdater {
  private memory: UpdateMemory = {};
  private initialized: Promise<void> | undefined;
  private installed: InstalledVersion = { name: '', code: 0 };
  private release: ReadyRelease | undefined;
  private phase: UpdateSnapshot['phase'] = 'idle';
  private sheet = false;
  private blocked = true;
  private pending: 'auto' | 'manual' | undefined;
  private checking = false;
  private transfer = false;
  private generation = 0;
  private bytes = 0;
  private awaitingSettings = false;
  private installPending = false;
  private log: TraceJob | undefined;
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  dispose() { clearTimeout(this.hiddenTimer); this.listeners.clear(); ++this.generation; this.pending = undefined; }
  constructor(private readonly options: {
    port: UpdatePort; store: UpdateStore; latest(logError: (code: string) => void): Promise<AppRelease>;
    logs?: JobLogStore; now?: () => number;
  }) {}
  private now() { return (this.options.now ?? Date.now)(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
  get busy() { return this.checking || this.transfer || this.installPending || this.phase === 'permission' || this.phase === 'installing'; }
  snapshot(): UpdateSnapshot {
    const visible = !this.blocked;
    return { current: this.installed.code ? versionLabel(this.installed) : '', phase: visible ? this.phase : 'idle',
      ...(visible && this.release ? { release: { version: releaseVersionName(this.release.version), date: this.release.date, size: this.release.size } } : {}),
      notice: visible && !!this.release && this.memory.hiddenDay !== localUpdateDay(this.now()),
      sheet: visible && this.sheet, bytes: this.bytes,
      percent: this.release ? Math.min(100, Math.floor(this.bytes / this.release.size * 100)) : 0 };
  }
  initialize() {
    this.initialized ??= (async () => {
      this.memory = await this.options.store.read();
      this.installed = await this.options.port.info();
      const old = this.memory.installed;
      if (old && this.installed.code > old.code) {
        const log = this.options.logs?.begin('app_update', 'app');
        log?.line('update', 'ok', { update: { event: 'update_done', from: versionLabel(old), to: versionLabel(this.installed) } });
        log?.end('succeeded');
      }
      this.memory.installed = this.installed;
      await this.save(); this.scheduleHiddenDay(); this.emit();
    })().catch(error => { this.initialized = undefined; throw error; });
    return this.initialized;
  }
  private save() { return this.options.store.write({ ...this.memory }); }
  private scheduleHiddenDay() {
    clearTimeout(this.hiddenTimer);
    if (this.memory.hiddenDay !== localUpdateDay(this.now())) return;
    const midnight = new Date(this.now()); midnight.setHours(24, 0, 0, 0);
    this.hiddenTimer = setTimeout(() => this.emit(), Math.max(1, midnight.getTime() - this.now()));
    this.hiddenTimer.unref?.();
  }
  setBlocked(blocked: boolean) {
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    if (!blocked && this.pending) { const source = this.pending; this.pending = undefined; void this.check(source); }
  }
  async check(source: 'auto' | 'manual') {
    if (this.blocked) { if (this.pending !== 'manual') this.pending = source; return; }
    if (this.busy) return;
    this.checking = true;
    let log: TraceJob | undefined;
    try {
      await this.initialize();
      if (this.blocked) { this.pending = source; return; }
      if (source === 'auto' && this.memory.lastCheck !== undefined && this.now() - this.memory.lastCheck < 86400000) return;
      this.memory.lastCheck = this.now(); await this.save();
      this.phase = 'checking'; this.emit();
      log = this.options.logs?.begin('app_update', 'app');
      log?.line('update', 'start', { update: { event: source === 'auto' ? 'check_auto' : 'check_manual' } });
      let errorCode: string | undefined;
      const result = await this.options.latest(code => { errorCode = code; });
      this.release = result.ready && result.code > this.installed.code ? result : undefined;
      log?.line('update', errorCode ? 'fail' : 'ok', { ...(errorCode ? { reason: reasonCode(errorCode) } : {}), update: { event: errorCode ? 'error' : this.release ? 'newer' : result.ready ? 'same' : 'none', ...(errorCode ? { code: errorCode } : {}) } });
      log?.end(errorCode ? 'failed' : 'succeeded', errorCode ? reasonCode(errorCode) : undefined);
      this.phase = this.release ? 'available' : 'idle';
      this.sheet = source === 'manual' && !!this.release;
    } catch {
      log ??= this.options.logs?.begin('app_update', 'app');
      log?.line('update', 'fail', { reason: 'UPDATE_CHECK_SERVER', update: { event: 'error', code: 'UPDATE_CHECK_SERVER' } });
      log?.end('failed', 'UPDATE_CHECK_SERVER');
      this.phase = 'idle';
    } finally { this.checking = false; this.emit(); }
  }
  open() { if (!this.blocked && this.release && !this.busy) { this.sheet = true; this.phase = 'available'; this.emit(); } }
  async later() {
    if (this.transfer) return;
    this.awaitingSettings = false;
    this.memory.hiddenDay = localUpdateDay(this.now()); await this.save();
    this.scheduleHiddenDay();
    this.sheet = false; this.phase = this.release ? 'available' : 'idle';
    this.log?.end('stopped'); this.log = undefined;
    // A verified file awaiting permission is discarded if installation is postponed.
    await this.options.port.cancel(); this.emit();
  }
  diagnostic(value: UpdateDiagnostic) {
    if (!this.log) return;
    this.log.line('update', value.code ? 'fail' : 'ok', { ...(value.code ? { reason: reasonCode(value.code) } : {}), update: value });
  }
  progress(bytes: number) {
    if (this.phase !== 'downloading' || !Number.isSafeInteger(bytes) || bytes < this.bytes) return;
    this.bytes = bytes; this.emit();
  }
  private async freshLink() {
    const result = await this.options.latest(code => this.diagnostic({ event: 'error', code }));
    if (!result.ready || result.code <= this.installed.code) throw Error('UPDATE_METADATA_INVALID');
    this.release = result;
    this.diagnostic({ event: 'link_fetched' });
    return result;
  }
  async download() {
    if (this.blocked || this.busy || !this.release) return;
    this.transfer = true; const generation = ++this.generation;
    this.phase = 'downloading'; this.sheet = true; this.bytes = 0;
    try {
      this.log = this.options.logs?.begin('app_update', 'app'); this.emit();
      let release = await this.freshLink();
      if (generation !== this.generation) return;
      for (let attempt = 0; ; attempt++) {
        try { await this.options.port.download(release); break; }
        catch (error) {
          if (generation !== this.generation) return;
          if (!(error instanceof Error) || error.message !== 'UPDATE_LINK_EXPIRED' || attempt !== 0) throw error;
          release = await this.freshLink(); this.bytes = 0; this.emit();
        }
      }
      if (generation !== this.generation) return;
      await this.install();
    } catch (error) {
      if (generation !== this.generation) return;
      await this.options.port.cancel().catch(() => {});
      const code = error instanceof Error ? error.message : 'UPDATE_DOWNLOAD_FAILED';
      this.diagnostic({ event: 'error', code }); this.log?.end('failed', reasonCode(code)); this.log = undefined;
      this.phase = 'error';
    } finally { this.transfer = false; this.emit(); }
  }
  private async install() {
    if (this.blocked) return;
    const result = await this.options.port.install();
    this.phase = result === 'permission' ? 'permission' : 'installing';
    this.sheet = result === 'permission';
    if (result === 'launched') { this.log?.end('succeeded'); this.log = undefined; }
  }
  async settings() {
    if (this.blocked || this.phase !== 'permission') return;
    await this.options.port.settings(); this.awaitingSettings = true;
  }
  async resume() {
    this.emit();
    if (this.blocked || this.installPending) return;
    if (this.phase === 'installing') { this.phase = 'available'; this.emit(); return; }
    if (this.phase !== 'permission' || !this.awaitingSettings) return;
    this.installPending = true;
    try { await this.install(); }
    catch { this.diagnostic({ event: 'error', code: 'UPDATE_INSTALL_FAILED' }); await this.options.port.cancel().catch(() => {}); this.log?.end('failed'); this.log = undefined; this.phase = 'error'; }
    finally { this.installPending = false; this.emit(); }
  }
  async cancel() {
    ++this.generation;
    this.diagnostic({ event: 'cancel' });
    await this.options.port.cancel();
    this.log?.end('stopped', 'UPDATE_CANCELLED'); this.log = undefined;
    this.sheet = false; this.phase = this.release ? 'available' : 'idle'; this.emit();
  }
}
