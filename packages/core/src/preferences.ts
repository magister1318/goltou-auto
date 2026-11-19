import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export interface Preferences { polish: boolean; closing: boolean; linkCard: boolean; lastBandKeys: string[] }
export const defaultPreferences = (): Preferences => ({ polish: false, closing: false, linkCard: false, lastBandKeys: [] });
export interface PreferencesStore { read(): Promise<Preferences>; write(value: Preferences): Promise<void> }
const bandKey = (key: unknown): key is string => typeof key === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(key);
export function migratePreferences(value: unknown): Preferences | null {
  if (!value || typeof value !== 'object') return null;
  const { polish, closing, linkCard, lastBandKeys, lastBandKey } = value as Record<string, unknown>;
  if (typeof polish !== 'boolean' || typeof closing !== 'boolean' || typeof linkCard !== 'boolean') return null;
  if (lastBandKeys !== undefined && (!Array.isArray(lastBandKeys) || !lastBandKeys.every(bandKey))) return null;
  if (lastBandKeys === undefined && lastBandKey !== '' && !bandKey(lastBandKey)) return null;
  return { polish, closing, linkCard, lastBandKeys: [...new Set<string>(lastBandKeys ?? (lastBandKey ? [lastBandKey as string] : []))] };
}
export class MemoryPreferencesStore implements PreferencesStore {
  private value = defaultPreferences();
  async read() { return structuredClone(this.value); }
  async write(value: Preferences) { this.value = structuredClone(value); }
}
/** The shell supplies a private, stable path, independent of the local UI port. */
export function filePreferencesStore(file: string): PreferencesStore {
  return {
    async read() {
      try { const value: unknown = JSON.parse(await readFile(file, 'utf8')); return migratePreferences(value) ?? defaultPreferences(); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return defaultPreferences(); throw e; }
    },
    async write(value) {
      const migrated = migratePreferences(value);
      if (!migrated) throw Error('INVALID_PREFERENCES');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(migrated), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    },
  };
}
