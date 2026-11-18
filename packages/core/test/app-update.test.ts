import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppUpdater, updateJobBusy, type ReadyRelease, type UpdateMemory, type UpdatePort } from '../src/app-update';
import { fileUpdateStore } from '../src/app-update-store';
import { JobLogStore } from '../src/job-logs';
const release: ReadyRelease = { ready: true, version: '1.0.5 (9)', code: 9, date: '2026-11-20', size: 56124432,
  sha256: 'a'.repeat(64), url: 'auto_app/get/NEVER_LOG_DOWNLOAD_TOKEN', expiresIn: 900 };
function fixture(initial: UpdateMemory = {}, logs?: JobLogStore) {
  let now = new Date(2026, 10, 20, 12).getTime(); let memory = structuredClone(initial);
  const port = { info: vi.fn(async () => ({ name: '1.0.4', code: 8 })), download: vi.fn<UpdatePort['download']>(async () => {}),
    cancel: vi.fn(async () => {}), install: vi.fn<UpdatePort['install']>(async () => 'launched'), settings: vi.fn(async () => {}) };
  const latest = vi.fn(async (_log: (code: string) => void) => release as import('@goltou/api-client').AppRelease);
  const updater = new AppUpdater({ port, latest, ...(logs ? { logs } : {}), store: { read: async () => memory, write: async v => { memory = structuredClone(v); } }, now: () => now });
  updater.setBlocked(false);
  return { updater, port, latest, memory: () => memory, setNow: (v: number) => { now = v; }, now: () => now };
}
const directories: string[] = [];
afterEach(async () => { for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
describe('app update policy', () => {
  it('persists the 24h boundary; manual bypasses and resets it', async () => {
    const f = fixture(); await f.updater.check('auto');
    f.setNow(f.now() + 86400000 - 1); await f.updater.check('auto'); expect(f.latest).toHaveBeenCalledTimes(1);
    f.setNow(f.now() + 1); await f.updater.check('auto'); expect(f.latest).toHaveBeenCalledTimes(2);
    await f.updater.check('manual'); expect(f.latest).toHaveBeenCalledTimes(3);
    const restored = fixture(f.memory()); await restored.updater.check('auto'); expect(restored.latest).not.toHaveBeenCalled();
  });
  it.each(['running', 'dialog_paused', 'login_paused', 'user_paused', 'recovery_paused', 'channel_paused', 'record_failed', 'failed', 'stopped_before_post'])(
    'defers checks and hides cached notices during %s; shows when job ends', async status => {
      const f = fixture(); await f.updater.check('auto'); expect(f.updater.snapshot().notice).toBe(true);
      f.updater.setBlocked(updateJobBusy({ status }));
      await f.updater.check('manual');
      expect(f.latest).toHaveBeenCalledTimes(1); expect(f.updater.snapshot()).toMatchObject({ notice: false, sheet: false });
      expect(f.updater.snapshot().release).toBeUndefined();
      f.updater.setBlocked(updateJobBusy({ status: 'stopped' }));
      await vi.waitFor(() => expect(f.latest).toHaveBeenCalledTimes(2));
      expect(f.updater.snapshot().notice).toBe(true);
    });
  it('defers the first auto check until job completion', async () => {
    const f = fixture(); f.updater.setBlocked(true); await f.updater.check('auto'); expect(f.latest).not.toHaveBeenCalled();
    f.updater.setBlocked(false); await vi.waitFor(() => expect(f.latest).toHaveBeenCalledTimes(1));
  });
  it('hides later for the local calendar day across restart and restores on next day', async () => {
    const f = fixture(); await f.updater.check('manual'); await f.updater.later();
    expect(f.updater.snapshot()).toMatchObject({ notice: false, sheet: false });
    await f.updater.check('manual'); expect(f.updater.snapshot().notice).toBe(false);
    f.setNow(new Date(2026, 10, 21, 0, 0, 1).getTime()); expect(f.updater.snapshot().notice).toBe(true);
    const restored = fixture(f.memory()); await restored.updater.check('manual'); expect(restored.updater.snapshot().notice).toBe(false);
  });
  it.each([7, 8])('suppresses code %i regardless of the displayed name', async code => {
    const f = fixture(); f.latest.mockResolvedValue({ ...release, code, version: '99.0.0 (99)' }); await f.updater.check('manual');
    expect(f.updater.snapshot()).toMatchObject({ notice: false, sheet: false, phase: 'idle' });
    await f.updater.download(); expect(f.port.download).not.toHaveBeenCalled();
  });
  it('fetches a fresh link for download, refetches only once after 4xx, and installs only after success', async () => {
    const f = fixture(); await f.updater.check('manual');
    f.port.download.mockRejectedValueOnce(Error('UPDATE_LINK_EXPIRED'));
    await f.updater.download();
    expect(f.latest).toHaveBeenCalledTimes(3); expect(f.port.download).toHaveBeenCalledTimes(2); expect(f.port.install).toHaveBeenCalledTimes(1);
  });
  it.each(['UPDATE_HASH_MISMATCH', 'UPDATE_PACKAGE_MISMATCH', 'UPDATE_NOT_NEWER', 'UPDATE_SIGNER_MISMATCH', 'UPDATE_LINK_EXPIRED'])(
    'blocks installer and cleans up on %s', async reason => {
      const f = fixture(); await f.updater.check('manual'); f.port.download.mockRejectedValue(Error(reason));
      await f.updater.download(); expect(f.port.install).not.toHaveBeenCalled(); expect(f.port.cancel).toHaveBeenCalled();
      expect(f.updater.snapshot().phase).toBe('error');
      expect(f.port.download).toHaveBeenCalledTimes(reason === 'UPDATE_LINK_EXPIRED' ? 2 : 1);
    });
  it('does not retry a transient non-4xx error', async () => {
    const f = fixture(); await f.updater.check('manual'); f.port.download.mockRejectedValue(Error('UPDATE_DOWNLOAD_FAILED'));
    await f.updater.download(); expect(f.port.download).toHaveBeenCalledTimes(1); expect(f.latest).toHaveBeenCalledTimes(2);
  });
  it('cancel during a link fetch never starts a download or installer', async () => {
    const f = fixture(); await f.updater.check('manual');
    let finish!: (v: ReadyRelease) => void; f.latest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const download = f.updater.download(); await f.updater.cancel(); finish(release); await download;
    expect(f.port.download).not.toHaveBeenCalled(); expect(f.port.install).not.toHaveBeenCalled();
    expect(f.updater.snapshot().sheet).toBe(false);
  });
  it('cancel during download cleans up and prevents a late completion from installing', async () => {
    const f = fixture(); await f.updater.check('manual');
    let finish!: () => void; f.port.download.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const download = f.updater.download(); await vi.waitFor(() => expect(f.port.download).toHaveBeenCalled());
    f.updater.progress(1000000); expect(f.updater.snapshot().bytes).toBe(1000000);
    await f.updater.cancel(); finish(); await download;
    expect(f.port.install).not.toHaveBeenCalled(); expect(f.port.cancel).toHaveBeenCalled();
  });
  it('rechecks permission automatically on return from settings; later stops continuation', async () => {
    const f = fixture(); f.port.install.mockResolvedValueOnce('permission'); await f.updater.check('manual'); await f.updater.download();
    expect(f.updater.snapshot().phase).toBe('permission'); await f.updater.settings(); expect(f.port.settings).toHaveBeenCalledTimes(1);
    await f.updater.resume(); expect(f.port.install).toHaveBeenCalledTimes(2);
    const g = fixture(); g.port.install.mockResolvedValue('permission'); await g.updater.check('manual'); await g.updater.download();
    await g.updater.settings(); await g.updater.later(); await g.updater.resume(); expect(g.port.install).toHaveBeenCalledTimes(1);
  });
  it('never exposes a download URL or hash in UI snapshots or local update memory', async () => {
    const f = fixture(); await f.updater.check('manual');
    const serialized = JSON.stringify([f.updater.snapshot(), f.memory()]);
    expect(serialized).not.toContain('NEVER_LOG'); expect(serialized).not.toContain('sha256'); expect(serialized).not.toContain('url');
  });
});
describe('persistent update logs', () => {
  it('projects event fields, removes token injection, survives reopening, and records update_done once', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'goltou-update-')); directories.push(dir);
    const logs = new JobLogStore(path.join(dir, 'logs'));
    const f = fixture({ installed: { name: '1.0.3', code: 7 } }, logs);
    await f.updater.check('manual');
    f.port.download.mockImplementation(async () => {
      f.updater.diagnostic({ event: 'download_start', url: release.url, code: release.url, from: release.url } as never);
      f.updater.diagnostic({ event: 'verify_hash', code: 'UPDATE_HASH_MISMATCH' });
      throw Error('UPDATE_HASH_MISMATCH');
    });
    await f.updater.download();
    const restored = fixture(f.memory(), logs); await restored.updater.initialize();
    const files = (await readdir(path.join(dir, 'logs'))).filter(d => /^\d{8}$/.test(d));
    const content = (await Promise.all(files.flatMap(async day => Promise.all((await readdir(path.join(dir, 'logs', day))).map(file => readFile(path.join(dir, 'logs', day, file), 'utf8')))))).flat().join('');
    expect(content).not.toContain('NEVER_LOG'); expect(content).not.toContain('auto_app/get');
    expect(content.match(/"event":"update_done"/g)).toHaveLength(1);
    expect(content).toContain('"from":"1.0.3 (7)"'); expect(content).toContain('"to":"1.0.4 (8)"');
    expect(content).toContain('UPDATE_HASH_MISMATCH'); expect(new JobLogStore(path.join(dir, 'logs')).list()).toHaveLength(3);
    const store = fileUpdateStore(path.join(dir, 'update.json')); await store.write(f.memory());
    expect(await fileUpdateStore(path.join(dir, 'update.json')).read()).toEqual(f.memory());
    expect(await readFile(path.join(dir, 'update.json'), 'utf8')).not.toContain('NEVER_LOG');
  });
});
