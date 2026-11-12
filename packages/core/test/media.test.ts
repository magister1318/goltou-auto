import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadPhotos } from '../src/media';
import { fileMediaStorage } from '../src/media/files';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'goltou-wp4-media-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const original = await readFile(new URL('../../sites/fixtures/sample-1.png', import.meta.url));
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url === '/bad') { res.writeHead(500).end(); return; }
    if (req.url === '/redirect') { res.writeHead(302, { location: '/unlisted' }).end(); return; }
    res.writeHead(200, { 'content-type': 'image/png' }).end(original);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('LOCAL_SERVER_REQUIRED');
  return { root, original, requests, url: (suffix: string) => `http://127.0.0.1:${address.port}${suffix}`, storage: fileMediaStorage(root) };
}
describe('WP4 original media via local HTTP only', () => {
  it('keeps original bytes, order and type, then removes all job files', async () => {
    const f = await fixture(), urls = [f.url('/first.png'), f.url('/second.png')];
    const progress = vi.fn(); const batch = await downloadPhotos(urls, urls, { storage: f.storage }, undefined, progress);
    expect(batch.files.map(file => file.url)).toEqual(urls);
    for (const file of batch.files) expect(await readFile(file.path)).toEqual(f.original);
    expect(progress.mock.calls.map(c => c[0])).toEqual([1, 2]);
    await batch.cleanup(); expect(await readdir(f.root)).toEqual([]);
  });
  it('stops on any failed image and cleans earlier downloads without skipping it', async () => {
    const f = await fixture(), urls = [f.url('/first.png'), f.url('/bad'), f.url('/last.png')];
    await expect(downloadPhotos(urls, urls, { storage: f.storage })).rejects.toThrow('PHOTO_DOWNLOAD_FAILED');
    expect(f.requests).toEqual(['/first.png', '/bad']); expect(await readdir(f.root)).toEqual([]);
  });
  it('rejects non-API URLs, credentials, non-HTTP URLs and redirects before another request', async () => {
    const f = await fixture();
    for (const url of ['file:///secret.png', 'data:image/png;base64,abc', f.url('/unlisted'), 'http://user:pass@127.0.0.1/photo'])
      await expect(downloadPhotos([url], [f.url('/first.png'), 'file:///secret.png', 'data:image/png;base64,abc', 'http://user:pass@127.0.0.1/photo'], { storage: f.storage })).rejects.toThrow('API_PHOTO_URL_REQUIRED');
    expect(f.requests).toEqual([]);
    await expect(downloadPhotos([f.url('/redirect')], [f.url('/redirect')], { storage: f.storage })).rejects.toThrow('PHOTO_DOWNLOAD_FAILED');
    expect(f.requests).toEqual(['/redirect']); expect(await readdir(f.root)).toEqual([]);
  });
  it('cancels without writing or leaving temporary files; rejects directory escapes', async () => {
    const f = await fixture(), controller = new AbortController(); controller.abort();
    await expect(downloadPhotos([f.url('/first.png')], [f.url('/first.png')], { storage: f.storage }, controller.signal)).rejects.toThrow();
    expect(await readdir(f.root)).toEqual([]);
    await expect(f.storage.removeWorkDirectory(path.dirname(f.root))).rejects.toThrow('INVALID_MEDIA_DIRECTORY');
  });
});
