import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { MediaStorage } from './index';

/** The shell supplies an app-private temporary root. No Android/Electron/iOS API. */
export function fileMediaStorage(root: string): MediaStorage {
  const absolute = path.resolve(root);
  const workDirectories = new Set<string>();
  const requireOwned = (directory: string) => {
    if (!workDirectories.has(directory) || path.dirname(directory) !== absolute || !path.basename(directory).startsWith('job-')) throw new Error('INVALID_MEDIA_DIRECTORY');
  };
  return {
    async createWorkDirectory() {
      await mkdir(absolute, { recursive: true, mode: 0o700 });
      const directory = await mkdtemp(path.join(absolute, 'job-')); workDirectories.add(directory); return directory;
    },
    async write(directory, name, bytes) {
      requireOwned(directory);
      if (!/^(?:\d+|goltou-[a-f0-9]{16}-\d+)\.[a-z0-9]+$/i.test(name)) throw new Error('INVALID_MEDIA_FILENAME');
      const file = path.join(directory, name);
      await writeFile(file, bytes, { mode: 0o600, flag: 'wx' }); return file;
    },
    async removeWorkDirectory(directory) {
      requireOwned(directory); await rm(directory, { recursive: true, force: true }); workDirectories.delete(directory);
    },
  };
}
