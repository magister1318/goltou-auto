import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UpdateMemory, UpdateStore } from './app-update';
export function fileUpdateStore(file: string): UpdateStore {
  let writes = Promise.resolve();
  return {
    async read() {
      try {
        const v = JSON.parse(await readFile(file, 'utf8')) as UpdateMemory;
        return { ...(Number.isFinite(v.lastCheck) ? { lastCheck: v.lastCheck } : {}),
          ...(typeof v.hiddenDay === 'string' ? { hiddenDay: v.hiddenDay } : {}),
          ...(v.installed && Number.isSafeInteger(v.installed.code) && /^\d+\.\d+\.\d+$/.test(v.installed.name) ? { installed: v.installed } : {}) };
      } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError || e instanceof TypeError) return {}; throw e; }
    },
    write(value) {
      const text = JSON.stringify(value);
      writes = writes.catch(() => {}).then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, text, { mode: 0o600 }); await rename(`${file}.tmp`, file);
      });
      return writes;
    },
  };
}
