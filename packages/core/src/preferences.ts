import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export interface Preferences { polish: boolean; closing: boolean; linkCard: boolean; lastBandKey: string }
export const defaultPreferences = (): Preferences => ({ polish: false, closing: false, linkCard: false, lastBandKey: '' });
export interface PreferencesStore { read(): Promise<Preferences>; write(value: Preferences): Promise<void> }
export function validPreferences(value: unknown): value is Preferences {
  if (!value || typeof value !== 'object') return false;
  const v = value as Preferences;
  return ['polish', 'closing', 'linkCard'].every(k => typeof v[k as keyof Preferences] === 'boolean') && typeof v.lastBandKey === 'string' && v.lastBandKey.length <= 100;
}
export class MemoryPreferencesStore implements PreferencesStore {
  private value = defaultPreferences();
  async read() { return { ...this.value }; }
  async write(value: Preferences) { this.value = { ...value }; }
}
/** The shell supplies a private, stable path, independent of the local UI port. */
export function filePreferencesStore(file: string): PreferencesStore {
  return {
    async read() {
      try { const value: unknown = JSON.parse(await readFile(file, 'utf8')); return validPreferences(value) ? value : defaultPreferences(); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return defaultPreferences(); throw e; }
    },
    async write(value) {
      if (!validPreferences(value)) throw Error('INVALID_PREFERENCES');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    },
  };
}
