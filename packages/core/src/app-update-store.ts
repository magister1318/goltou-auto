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
          ...(v.available && /^\d+\.\d+\.\d+(?:\s*\(\d+\))?$/.test(v.available.version) &&
            Number.isSafeInteger(v.available.code) && v.available.code > 0 && /^\d{4}-\d{2}-\d{2}$/.test(v.available.date) &&
            Number.isSafeInteger(v.available.size) && v.available.size > 0 ?
            { available: { version: v.available.version, code: v.available.code, date: v.available.date, size: v.available.size } } : {}),
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
