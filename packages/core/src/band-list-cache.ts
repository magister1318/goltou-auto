import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BandChoice, BandDirectory } from '@goltou/sites';
import { trace, traceJob, reasonCode } from '@goltou/surface/telemetry';

export interface SavedBandList { savedAt: number; rows: { key: string; name: string }[] }
export interface BandListStore { read(): Promise<SavedBandList | null>; write(value: SavedBandList | null): Promise<void> }
export interface BandListResult { rows: BandChoice[]; source: 'cache' | 'band'; savedAt: number | null; stale: boolean; refreshing?: boolean; failure?: string; revision?: number }
export type BandCacheClearReason = 'BAND_LOGIN_LOST' | 'BAND_LOGOUT' | 'BAND_SERVICE_RESET' | 'BAND_ACCOUNT_CHANGED' | 'BAND_TARGET_INVALID';
export const bandListMaxAge = 24 * 60 * 60 * 1000;
let revision = 0;
function decode(value: unknown): SavedBandList | null {
  const v = value as SavedBandList | null;
  if (!v || !Number.isSafeInteger(v.savedAt) || v.savedAt <= 0 || !Array.isArray(v.rows) ||
      !v.rows.every(r => r && typeof r.key === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(r.key) && typeof r.name === 'string' && r.name.length <= 1000) ||
      new Set(v.rows.map(r => r.key)).size !== v.rows.length) return null;
  return { savedAt: v.savedAt, rows: v.rows.map(({ key, name }) => ({ key, name })) };
}
/** Same app-private atomic file storage as preferences; excluded from local-data/log exports. */
export function fileBandListStore(file: string): BandListStore {
  let writes = Promise.resolve();
  return {
    async read() {
      await writes;
      try { return decode(JSON.parse(await readFile(file, 'utf8'))); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return null; throw e; }
    },
    write(value) {
      const clean = value === null ? null : decode(value);
      if (value !== null && !clean) return Promise.reject(new Error('INVALID_BAND_CACHE'));
      const operation = writes.then(async () => {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(`${file}.tmp`, JSON.stringify(clean), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      });
      writes = operation.catch(() => {}); return operation;
    },
  };
}

export class BandListCache {
  private saved: SavedBandList | null = null;
  private loaded: Promise<void> | undefined;
  private pending: Promise<BandListResult> | undefined;
  private generation = 0;
  private autoAttempt: number | undefined;
  private failure: string | undefined;
  private disposed = false;
  constructor(private readonly directory: BandDirectory, private readonly store: BandListStore,
    private readonly update: (value: BandListResult) => void, private readonly now = Date.now) {}
  private publish(value: BandListResult) { value.revision = ++revision; this.update(value); }
  private async load() {
    const generation = this.generation;
    this.loaded ??= this.store.read().then(value => { if (generation === this.generation) this.saved = value; });
    await this.loaded;
  }
  private cached(refreshing = !!this.pending): BandListResult {
    this.directory.seedChoices(this.saved?.rows ?? []);
    const age = this.saved ? this.now() - this.saved.savedAt : 0;
    return { rows: structuredClone(this.directory.choices), source: 'cache', savedAt: this.saved?.savedAt ?? null,
      stale: !!this.saved && (age < 0 || age >= bandListMaxAge), refreshing, ...(this.failure ? { failure: this.failure } : {}) };
  }
  private log(value: BandListResult, refresh: boolean, cleared = false, reason?: BandCacheClearReason) {
    trace('band.list.cache', 'ok', { ...(reason ? { reason } : {}), bandList: { cacheSource: value.source,
      cacheAgeMinutes: value.savedAt === null ? 0 : Math.max(0, Math.floor((this.now() - value.savedAt) / 60000)),
      stale: value.stale, refreshRequested: refresh, rowCount: value.rows.length, cacheCleared: cleared } });
  }
  async list(input: { refresh?: boolean } = {}): Promise<BandListResult> {
    await this.load();
    const refresh = input.refresh === true;
    if (this.saved && !refresh) {
      const value = this.cached();
      const background = value.stale && !this.pending && this.autoAttempt !== this.saved.savedAt;
      if (background) value.refreshing = true;
      this.publish(value);
      if (background) {
        this.autoAttempt = this.saved.savedAt;
        void this.read(false).catch(() => {});
      }
      await traceJob('band_list', 'band', async () => { this.log(value, false); });
      return value;
    }
    return this.read(refresh);
  }
  private read(refresh: boolean): Promise<BandListResult> {
    if (this.pending) {
      const pending = this.pending;
      return traceJob('band_list', 'band', async () => { const value = await pending; this.log(value, refresh); return value; },
        value => value.failure ? { result: 'failed', reason: reasonCode(value.failure) } : { result: 'succeeded' });
    }
    const generation = this.generation;
    const previous = structuredClone(this.directory.choices);
    this.failure = undefined;
    const operation = traceJob('band_list', 'band', async () => {
      this.log({ ...this.cached(false), source: 'band' }, refresh);
      try {
        const rows = await this.directory.list();
        if (generation !== this.generation || this.disposed) throw new Error('BAND_CACHE_INVALIDATED');
        const saved = { savedAt: this.now(), rows: rows.map(({ key, name }) => ({ key, name })) };
        await this.store.write(saved);
        if (generation !== this.generation || this.disposed) throw new Error('BAND_CACHE_INVALIDATED');
        this.saved = saved; this.autoAttempt = undefined;
        const value: BandListResult = { rows, source: 'band', savedAt: saved.savedAt, stale: false, refreshing: false };
        this.log(value, refresh); this.publish(value); return value;
      } catch (error) {
        const code = reasonCode(error);
        if (code === 'BAND_LOGIN_LOST') { this.log({ ...this.cached(false), source: 'band' }, refresh); await this.clear('BAND_LOGIN_LOST'); }
        if (generation !== this.generation || this.disposed) { this.directory.seedChoices(this.saved?.rows ?? []); throw error; }
        if (!this.saved) { this.log({ ...this.cached(false), source: 'band' }, refresh); throw error; }
        this.directory.choices = previous; this.failure = code;
        const value = this.cached(false);
        this.log(value, refresh); this.publish(value); return value;
      }
    }, value => value.failure ? { result: 'failed', reason: reasonCode(value.failure) } : { result: 'succeeded', ...(this.directory.listReason ? { reason: this.directory.listReason } : {}) });
    this.pending = operation;
    void operation.finally(() => { if (this.pending === operation) this.pending = undefined; }).catch(() => {});
    return operation;
  }
  async settle() { await this.pending; }
  async clear(reason: BandCacheClearReason) {
    ++this.generation; this.saved = null; this.failure = undefined; this.autoAttempt = undefined;
    this.loaded = Promise.resolve(); this.directory.seedChoices([]);
    const value = this.cached(false);
    this.publish(value);
    await traceJob('band_list', 'band', async () => { this.log(value, false, true, reason); await this.store.write(null); });
  }
  dispose() { this.disposed = true; ++this.generation; }
}
