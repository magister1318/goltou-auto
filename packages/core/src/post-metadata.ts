import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
export interface PostMetadataStore {
  get(postNo: number): Promise<'public' | 'private' | undefined>;
  set(postNo: number, visibility: 'public' | 'private'): Promise<void>;
  getTableFallback(postNo: number): Promise<boolean>;
  setTableFallback(postNo: number): Promise<void>;
}
export class MemoryPostMetadata implements PostMetadataStore {
  private readonly values = new Map<number, 'public' | 'private'>();
  private readonly tableFallbacks = new Set<number>();
  async getTableFallback(postNo: number) { return this.tableFallbacks.has(postNo); }
  async setTableFallback(postNo: number) { this.tableFallbacks.add(postNo); }
  async get(postNo: number) {
    return this.values.get(postNo);
  }
  async set(postNo: number, visibility: 'public' | 'private') {
    this.values.set(postNo, visibility);
  }
}
/** No account text, URLs or authentication data. The shell supplies app-private storage. */
export function filePostMetadata(file: string): PostMetadataStore {
  type Entry = { visibility?: 'public' | 'private'; tableFallback?: true };
  async function read(): Promise<Record<string, Entry>> {
    try {
      const data: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw Error('INVALID_POST_METADATA');
      const result: Record<string, Entry> = {};
      for (const [key, value] of Object.entries(data)) {
        if (!/^\d+$/.test(key)) throw Error('INVALID_POST_METADATA');
        if (value === 'public' || value === 'private') result[key] = { visibility: value };
        else if (value && typeof value === 'object' && !Array.isArray(value) &&
          Object.keys(value).every(k=>['visibility','tableFallback'].includes(k)) &&
          (!('visibility' in value) || value.visibility === 'public' || value.visibility === 'private') &&
          (!('tableFallback' in value) || value.tableFallback === true)) result[key] = value;
        else throw Error('INVALID_POST_METADATA');
      }
      return result;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
  }
  async function save(values: Record<string, Entry>) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(values), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  return {
    async get(no) {
      return (await read())[String(no)]?.visibility;
    },
    async set(no, visibility) {
      const values = await read();
      values[String(no)] = { ...values[String(no)], visibility };
      await save(values);
    },
    async getTableFallback(no) { return (await read())[String(no)]?.tableFallback === true; },
    async setTableFallback(no) {
      const values = await read();
      if (values[String(no)]?.tableFallback) return;
      values[String(no)] = { ...values[String(no)], tableFallback: true };
      await save(values);
    },
  };
}
