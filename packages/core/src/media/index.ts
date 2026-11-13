import { createHash } from 'node:crypto';
export interface MediaStorage {
  createWorkDirectory(): Promise<string>;
  write(directory: string, name: string, bytes: Uint8Array): Promise<string>;
  removeWorkDirectory(directory: string): Promise<void>;
}
export interface MediaFile { url: string; path: string }
export interface MediaBatch { files: MediaFile[]; cleanup(): Promise<void> }
export type MediaFetch = (url: string, init: { redirect: 'manual'; credentials: 'omit'; signal: AbortSignal }) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
export interface MediaDependencies { storage: MediaStorage; fetcher?: MediaFetch }

export async function downloadPhotos(urls: readonly string[], apiUrls: readonly string[], dependencies: MediaDependencies, signal?: AbortSignal, progress: (current: number) => void = () => {}): Promise<MediaBatch> {
  const allowed = new Set(apiUrls);
  for (const value of urls) {
    let url: URL; try { url = new URL(value); } catch { throw new Error('API_PHOTO_URL_REQUIRED'); }
    if (!allowed.has(value) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API_PHOTO_URL_REQUIRED');
  }
  const directory = await dependencies.storage.createWorkDirectory();
  const files: MediaFile[] = [];
  const cleanup = () => dependencies.storage.removeWorkDirectory(directory);
  try {
    for (const [index, url] of urls.entries()) {
      signal?.throwIfAborted();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, 30000);
      try {
        // Redirects cannot introduce a URL that the API did not provide. No cookies or credentials.
        const response = await (dependencies.fetcher ?? fetch)(url, { redirect: 'manual', credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw new Error('PHOTO_DOWNLOAD_FAILED');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length) throw new Error('EMPTY_PHOTO');
        signal?.throwIfAborted();
        const extension = new URL(url).pathname.match(/\.(png|jpe?g|webp|gif|avif|bmp|heic)$/i)?.[0] ?? '.image';
        // Content identity survives Naver upload URLs without recording the source URL.
        const identity = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
        const path = await dependencies.storage.write(directory, `goltou-${identity}-${index + 1}${extension}`, bytes);
        files.push({ url, path }); progress(index + 1);
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    return { files, cleanup };
  } catch (error) {
    await cleanup();
    if (signal?.aborted) throw error;
    if (error instanceof Error && ['PHOTO_DOWNLOAD_FAILED', 'EMPTY_PHOTO'].includes(error.message)) throw error;
    throw new Error('PHOTO_DOWNLOAD_FAILED');
  }
}
