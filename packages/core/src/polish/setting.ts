import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PolishStrength } from '@goltou/api-client';

export interface PolishStrengthStore {
  read(): Promise<PolishStrength>;
  write(strength: PolishStrength): Promise<void>;
}
export class MemoryPolishStrengthStore implements PolishStrengthStore {
  private strength: PolishStrength = 'natural';
  async read() { return this.strength; }
  async write(strength: PolishStrength) { this.strength = strength; }
}
/** The shell supplies an app-private path outside the versioned bundle. Only the level is stored. */
export function filePolishStrengthStore(file: string): PolishStrengthStore {
  return {
    async read() {
      try { return (await readFile(file, 'utf8')).trim() === 'spelling' ? 'spelling' : 'natural'; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'natural'; throw error; }
    },
    async write(strength) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, `${strength}\n`, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    },
  };
}
