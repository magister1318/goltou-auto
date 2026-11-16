import { lstat, open, unlink } from 'node:fs/promises';
export interface BandPostAllowance {
  available(): Promise<boolean>;
  consume(): Promise<boolean>;
}
/** Presence-only private flag, never read as content. Exclusive lock serializes
 * consumers on Windows and Android; a crash leaves the lock closed for safety. */
export function fileBandPostAllowance(file: string): BandPostAllowance {
  const present = async () => {
    try {
      return (await lstat(file)).isFile();
    } catch {
      return false;
    }
  };
  const available = async () => {
    try {
      await lstat(`${file}.lock`);
      return false;
    } catch (e) {
      return (
        (e as NodeJS.ErrnoException).code === 'ENOENT' && (await present())
      );
    }
  };
  return {
    available,
    async consume() {
      let lock;
      try {
        lock = await open(`${file}.lock`, 'wx', 0o600);
      } catch {
        return false;
      }
      try {
        if (!(await present())) return false;
        await unlink(file);
        return true;
      } catch {
        return false;
      } finally {
        await lock.close();
        await unlink(`${file}.lock`).catch(() => {});
      }
    },
  };
}
