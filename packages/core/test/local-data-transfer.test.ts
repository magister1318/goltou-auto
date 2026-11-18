import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileLocalDataTransfer } from '../src/local-data-transfer';
import { filePreferencesStore } from '../src/preferences';
import { filePostMetadata } from '../src/post-metadata';
import { filePolishStrengthStore } from '../src/polish/setting';
import { AppCore } from '../src/app';
import type { ApiClient } from '@goltou/api-client';
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function directory() { const dir = await mkdtemp(path.join(os.tmpdir(), 'local-data-test-')); directories.push(dir); return dir; }
async function populated() {
  const dir = await directory();
  await filePreferencesStore(path.join(dir, 'preferences.json')).write({ polish: true, closing: false, linkCard: false, lastBandKeys: ['111'] });
  await filePolishStrengthStore(path.join(dir, 'polish-strength.txt')).write('natural');
  await writeFile(path.join(dir, 'post-metadata.json'), JSON.stringify({ 91: 'private', 92: { tableFallback: true, visibility: 'public' } }));
  // Files outside the fixed allowlist must never be copied.
  for (const name of ['session.bin', 'Cookies', 'one-band-post.allow', 'last-blog-title.txt', '.salt']) await writeFile(path.join(dir, name), 'SYNTHETIC_PRIVATE_VALUE');
  return { dir, transfer: fileLocalDataTransfer(dir) };
}
it('round-trips options and history metadata without sessions, titles, allowances or private salt', async () => {
  const source = await populated(), target = await directory();
  const text = await source.transfer.export();
  expect(text).not.toContain('SYNTHETIC_PRIVATE_VALUE');
  await fileLocalDataTransfer(target).import(text);
  expect(await filePreferencesStore(path.join(target, 'preferences.json')).read()).toEqual({ polish: true, closing: false, linkCard: false, lastBandKeys: ['111'] });
  expect(await filePolishStrengthStore(path.join(target, 'polish-strength.txt')).read()).toBe('natural');
  expect(await filePostMetadata(path.join(target, 'post-metadata.json')).get(91)).toBe('private');
  expect(await filePostMetadata(path.join(target, 'post-metadata.json')).getTableFallback(92)).toBe(true);
  expect((await readdir(target)).sort()).toEqual(['polish-strength.txt', 'post-metadata.json', 'preferences.json']);
});
it.each(['cookie', 'token', 'password', 'files', 'settings', '__proto__'])('rejects an unexpected backup field before writing: %s', async key => {
  const source = await populated(), target = await directory();
  const text = (await source.transfer.export()).replace('{', `{"${key}":"synthetic",`);
  await expect(fileLocalDataTransfer(target).import(text)).rejects.toThrow('LOCAL_DATA_INVALID');
  expect(await readdir(target)).toEqual([]);
});
it.each(['preferences', 'postMetadata'])('rejects credential fields nested in %s', async key => {
  const { transfer } = await populated(); const data = JSON.parse(await transfer.export());
  if (key === 'preferences') data.preferences.password = 'synthetic';
  else data.postMetadata[91].cookie = 'synthetic';
  await expect(transfer.import(JSON.stringify(data))).rejects.toThrow('LOCAL_DATA_INVALID');
});
it('merges existing metadata and refuses conflicting visibility without changing options', async () => {
  const { transfer } = await populated(); const target = await directory();
  const metadata = filePostMetadata(path.join(target, 'post-metadata.json'));
  await metadata.setTableFallback(93);
  await fileLocalDataTransfer(target).import(await transfer.export());
  expect(await metadata.getTableFallback(93)).toBe(true);
  const before = await readFile(path.join(target, 'preferences.json'), 'utf8');
  await metadata.set(91, 'public');
  await expect(fileLocalDataTransfer(target).import(await transfer.export())).rejects.toThrow('LOCAL_DATA_METADATA_CONFLICT');
  expect(await readFile(path.join(target, 'preferences.json'), 'utf8')).toBe(before);
});
it('exports safe defaults without creating any local files', async () => {
  const dir = await directory(); const data = JSON.parse(await fileLocalDataTransfer(dir).export());
  expect(data.preferences).toEqual({ polish: false, closing: false, linkCard: false, lastBandKeys: [] });
  expect(data.postMetadata).toEqual({}); expect(await readdir(dir)).toEqual([]);
});
it.each([['natural'], { value: 'natural' }, false])('requires a literal polish level rather than a coercible value (%j)', async polishStrength => {
  const { transfer } = await populated(); const dir = await directory();
  const data = JSON.parse(await transfer.export()); data.polishStrength = polishStrength;
  await expect(fileLocalDataTransfer(dir).import(JSON.stringify(data))).rejects.toThrow('LOCAL_DATA_INVALID');
  expect(await readdir(dir)).toEqual([]);
});
it('rejects a merged backup exceeding the export limit before any file changes', async () => {
  const { transfer } = await populated(); const target = await directory();
  const data = JSON.parse(await transfer.export());
  data.postMetadata = Object.fromEntries(Array.from({ length: 6500 }, (_, i) => [String(i + 1), { visibility: 'public', tableFallback: true }]));
  const existing = JSON.stringify(Object.fromEntries(Array.from({ length: 6500 }, (_, i) => [String(i + 10000), { visibility: 'public', tableFallback: true }])));
  expect(Buffer.byteLength(JSON.stringify(data))).toBeLessThan(512 * 1024);
  expect(Buffer.byteLength(existing)).toBeLessThan(512 * 1024);
  await writeFile(path.join(target, 'post-metadata.json'), existing);
  await expect(fileLocalDataTransfer(target).import(JSON.stringify(data))).rejects.toThrow('LOCAL_DATA_TOO_LARGE');
  expect(await readFile(path.join(target, 'post-metadata.json'), 'utf8')).toBe(existing);
  expect(await readdir(target)).toEqual(['post-metadata.json']);
});
it.each(['not JSON', ' '.repeat(512 * 1024 + 1)])('rejects malformed or oversized imports', async text => {
  const dir = await directory(); await expect(fileLocalDataTransfer(dir).import(text)).rejects.toThrow(/^LOCAL_DATA_/);
  expect(await readdir(dir)).toEqual([]);
});
it('owner file-picker commands round-trip locally without calling any server or exporting a session', async () => {
  const source = await populated(); let document: string | null = null;
  const request = vi.fn(async () => { throw Error('NO_SERVER_ACCESS'); });
  const app = new AppCore({ request } as ApiClient, undefined, undefined, undefined, {
    device: async () => ({ kind: 'synthetic', model: '', appVersion: '1.0.0' }),
    localData: source.transfer,
    transferLocalData: async (mode, text) => mode === 'export' ? (document = text!, '') : document,
    preferences: filePreferencesStore(path.join(source.dir, 'preferences.json')),
    polishStrength: filePolishStrengthStore(path.join(source.dir, 'polish-strength.txt')),
  });
  try {
    expect(await app.handle({ id: 1, type: 'app', command: 'localData.export', input: {} })).toEqual({ cancelled: false });
    expect(document).not.toContain('SYNTHETIC_PRIVATE_VALUE');
    expect(await app.handle({ id: 2, type: 'app', command: 'localData.import', input: {} })).toMatchObject({ cancelled: false, polishStrength: 'natural', preferences: { polish: true } });
    document = null;
    expect(await app.handle({ id: 3, type: 'app', command: 'localData.import', input: {} })).toEqual({ cancelled: true });
    expect(request).not.toHaveBeenCalled();
  } finally { app.dispose(); }
});
it('locks other state-changing commands while the owner is choosing a document and unlocks on cancel', async () => {
  const { transfer } = await populated(); let finish!: (value: string | null) => void;
  const app = new AppCore({ request: vi.fn() } as ApiClient, undefined, undefined, undefined, {
    device: async () => ({ kind: 'synthetic', model: '', appVersion: '1.0.0' }), localData: transfer,
    transferLocalData: async () => new Promise(resolve => { finish = resolve; }),
  });
  try {
    const pending = app.handle({ id: 1, type: 'app', command: 'localData.import', input: {} });
    await expect(app.handle({ id: 2, type: 'app', command: 'preferences.save', input: { polish: true, closing: true, linkCard: true, lastBandKeys: [] } })).rejects.toThrow('데이터 옮기기를 먼저');
    finish(null); expect(await pending).toEqual({ cancelled: true });
    expect(await app.handle({ id: 3, type: 'app', command: 'preferences.get', input: {} })).toMatchObject({ polish: false });
  } finally { app.dispose(); }
});
