import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
export interface PostMetadataStore {
  get(postNo: number): Promise<'public' | 'private' | undefined>;
  set(postNo: number, visibility: 'public' | 'private'): Promise<void>;
}
export class MemoryPostMetadata implements PostMetadataStore {
  private readonly values = new Map<number, 'public' | 'private'>();
  async get(postNo: number) {
    return this.values.get(postNo);
  }
  async set(postNo: number, visibility: 'public' | 'private') {
    this.values.set(postNo, visibility);
  }
}
/** No account text, URLs or authentication data. The shell supplies app-private storage. */
export function filePostMetadata(file: string): PostMetadataStore {
  async function read(): Promise<Record<string, 'public' | 'private'>> {
    try {
      const data: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw Error('INVALID_POST_METADATA');
      const entries = Object.entries(data);
      if (
        !entries.every(
          ([key, value]) =>
            /^\d+$/.test(key) && ['public', 'private'].includes(String(value)),
        )
      )
        throw Error('INVALID_POST_METADATA');
      return Object.fromEntries(entries);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
  }
  return {
    async get(no) {
      return (await read())[String(no)];
    },
    async set(no, visibility) {
      const values = await read();
      values[String(no)] = visibility;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(values), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    },
  };
}
