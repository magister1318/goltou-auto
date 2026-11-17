import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultPreferences, validPreferences, type Preferences } from './preferences';

export interface LocalDataTransfer { export(): Promise<string>; import(text: string): Promise<void> }
type Metadata = Record<string, { visibility?: 'public' | 'private'; tableFallback?: true }>;
interface Backup { format: 'goltou-auto-local'; version: 1; preferences: Preferences; polishStrength: 'spelling' | 'natural'; postMetadata: Metadata }
const maximumBytes = 512 * 1024;
const names = ['preferences.json', 'polish-strength.txt', 'post-metadata.json'] as const;
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
}
function preferences(value: unknown): Preferences {
  if (!exact(value, ['polish', 'closing', 'linkCard', 'lastBandKey']) || !validPreferences(value) || !/^[A-Za-z0-9_-]{0,100}$/.test(value.lastBandKey)) throw Error('LOCAL_DATA_INVALID');
  return { polish: value.polish, closing: value.closing, linkCard: value.linkCard, lastBandKey: value.lastBandKey };
}
function metadata(value: unknown): Metadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('LOCAL_DATA_INVALID');
  const result: Metadata = {};
  for (const [key, original] of Object.entries(value)) {
    const entry = original === 'public' || original === 'private' ? { visibility: original } : original;
    if (!/^[1-9][0-9]{0,14}$/.test(key) || !exact(entry, ['visibility', 'tableFallback']) ||
        ('visibility' in entry && entry.visibility !== 'public' && entry.visibility !== 'private') ||
        ('tableFallback' in entry && entry.tableFallback !== true)) throw Error('LOCAL_DATA_INVALID');
    result[key] = { ...(entry.visibility ? { visibility: entry.visibility as 'public' | 'private' } : {}), ...(entry.tableFallback ? { tableFallback: true } : {}) };
  }
  return result;
}
function decode(text: string): Backup {
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) throw Error('LOCAL_DATA_TOO_LARGE');
  try {
    const v: unknown = JSON.parse(text);
    if (!exact(v, ['format', 'version', 'preferences', 'polishStrength', 'postMetadata']) || v.format !== 'goltou-auto-local' || v.version !== 1 || v.polishStrength !== 'spelling' && v.polishStrength !== 'natural') throw Error();
    return { format: 'goltou-auto-local', version: 1, preferences: preferences(v.preferences), polishStrength: v.polishStrength as Backup['polishStrength'], postMetadata: metadata(v.postMetadata) };
  } catch { throw Error('LOCAL_DATA_INVALID'); }
}
/** Fixed allowlist only. No directory walk, sessions, WebView storage, logs or server writes. */
export function fileLocalDataTransfer(directory: string): LocalDataTransfer {
  async function read(name: typeof names[number]) {
    try { const data = await readFile(path.join(directory, name), 'utf8'); if (Buffer.byteLength(data) > maximumBytes) throw Error('LOCAL_DATA_TOO_LARGE'); return data; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  async function atomic(name: typeof names[number], data: string) {
    const file = path.join(directory, name);
    await writeFile(`${file}.transfer`, data, { mode: 0o600 });
    await rename(`${file}.transfer`, file);
  }
  return {
    async export() {
      const [prefs, strength, posts] = await Promise.all(names.map(read));
      const backup: Backup = { format: 'goltou-auto-local', version: 1,
        preferences: preferences(prefs === undefined ? defaultPreferences() : JSON.parse(prefs)),
        polishStrength: strength?.trim() === 'natural' ? 'natural' : 'spelling',
        postMetadata: metadata(posts === undefined ? {} : JSON.parse(posts)) };
      // Validate the total bound and reconstruct every exported field.
      return JSON.stringify(decode(JSON.stringify(backup)));
    },
    async import(text) {
      const backup = decode(text); // Validate everything before any write.
      const previous = await Promise.all(names.map(read));
      const current = metadata(previous[2] === undefined ? {} : JSON.parse(previous[2]));
      for (const [key, entry] of Object.entries(backup.postMetadata)) {
        if (current[key]?.visibility && entry.visibility && current[key]!.visibility !== entry.visibility) throw Error('LOCAL_DATA_METADATA_CONFLICT');
        current[key] = { ...current[key], ...entry };
      }
      // Merging must not produce a state that cannot subsequently be exported.
      const merged = decode(JSON.stringify({ ...backup, postMetadata: current }));
      const values = [JSON.stringify(merged.preferences), merged.polishStrength + '\n', JSON.stringify(merged.postMetadata)];
      await mkdir(directory, { recursive: true });
      let written = 0;
      try {
        for (let i = 0; i < names.length; i++) { await atomic(names[i]!, values[i]!); written++; }
      } catch {
        try {
          for (let i = written - 1; i >= 0; i--) {
            if (previous[i] === undefined) await unlink(path.join(directory, names[i]!));
            else await atomic(names[i]!, previous[i]!);
          }
        } catch { throw Error('LOCAL_DATA_RESTORE_FAILED_KEEP_BACKUP'); }
        throw Error('LOCAL_DATA_IMPORT_FAILED');
      } finally {
        for (const name of names) await unlink(path.join(directory, `${name}.transfer`)).catch(() => {});
      }
    },
  };
}
