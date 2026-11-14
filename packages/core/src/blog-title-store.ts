import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** One title, private to this installation. Never part of records or diagnostics. */
export interface BlogTitleStore { read(): Promise<string | null>; write(title: string): Promise<void> }
export function fileBlogTitleStore(file: string): BlogTitleStore {
  return {
    async read() {
      try { return await readFile(file, 'utf8') || null; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    async write(title) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, title, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    },
  };
}
