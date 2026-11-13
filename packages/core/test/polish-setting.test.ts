import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppCore } from '../src/app';
import { filePolishStrengthStore } from '../src/polish/setting';
import type { ApiClient } from '@goltou/api-client';
import type { AppRequest } from '../src/protocol';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(path.join(directory, 'strength.txt'), { force: true });
    await rm(path.join(directory, 'strength.txt.tmp'), { force: true });
    await rmdir(directory);
  }
});
async function storage() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'goltou-polish-'));
  directories.push(directory); const file = path.join(directory, 'strength.txt');
  return { file, store: filePolishStrengthStore(file) };
}
describe('app-private polish strength persistence', () => {
  it('defaults missing/invalid files to spelling and persists only the chosen level across store recreation', async () => {
    const { file, store } = await storage();
    expect(await store.read()).toBe('spelling');
    await writeFile(file, 'unknown'); expect(await store.read()).toBe('spelling');
    for (const level of ['spelling', 'natural'] as const) {
      await store.write(level);
      expect(await readFile(file, 'utf8')).toBe(`${level}\n`);
      expect(await filePolishStrengthStore(file).read()).toBe(level);
    }
  });
  it('restores the level in a new app core without API or authentication calls', async () => {
    const { file } = await storage();
    const api: ApiClient = { request: vi.fn(async () => { throw Error('NO_API'); }) };
    for (const level of ['spelling', 'natural'] as const) {
      const app = new AppCore(api, undefined, undefined, undefined, { device: async () => ({ kind: 'test', model: '', appVersion: '' }), polishStrength: filePolishStrengthStore(file) });
      try { expect(await app.handle({ id: 1, type: 'app', command: 'polish.setting.save', input: { strength: level } })).toBe(level); } finally { app.dispose(); }
      const restarted = new AppCore(api, undefined, undefined, undefined, { device: async () => ({ kind: 'test', model: '', appVersion: '' }), polishStrength: filePolishStrengthStore(file) });
      try { expect(await restarted.handle({ id: 2, type: 'app', command: 'polish.setting.get', input: {} })).toBe(level); } finally { restarted.dispose(); }
    }
    expect(api.request).not.toHaveBeenCalled();
  });
  it('rejects an unknown setting before writing and surfaces a storage failure', async () => {
    const api: ApiClient = { request: vi.fn() }, write = vi.fn(async () => { throw Error('STORAGE_FAILURE'); });
    const app = new AppCore(api, undefined, undefined, undefined, { device: vi.fn(), polishStrength: { read: async () => 'natural', write } });
    try {
      await expect(app.handle({ id: 1, type: 'app', command: 'polish.setting.save', input: { strength: 'unknown' } } as unknown as AppRequest)).rejects.toMatchObject({ code: 'invalid' });
      expect(write).not.toHaveBeenCalled();
      await expect(app.handle({ id: 2, type: 'app', command: 'polish.setting.save', input: { strength: 'spelling' } })).rejects.toThrow('STORAGE_FAILURE');
      expect(api.request).not.toHaveBeenCalled();
    } finally { app.dispose(); }
  });
});
