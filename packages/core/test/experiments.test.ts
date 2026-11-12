import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { Experiments } from '../src/experiments';
import { exampleArticle } from '@goltou/sites';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'goltou-wp0-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const surface = {
    session: 'naver', open: vi.fn(async () => {}), readState: vi.fn(async () => ({ title: 'Example Domain', url: 'https://example.com/', loading: false })),
    evaluateReadOnly: vi.fn(async () => 'expired'), click: vi.fn(), typeText: vi.fn(), pressKey: vi.fn(), attachFiles: vi.fn(),
    show: vi.fn(), hide: vi.fn(), close: vi.fn(), waitForNavigation: vi.fn(),
  } as unknown as Surface;
  const host: SurfaceHost = { create: vi.fn(async () => surface), destroy: vi.fn(), clearSession: vi.fn() };
  const tools = new Experiments({ host, directory, photoPaths: [], info: async () => ({}), lifecycle: async () => {}, capture: async () => ({ redacted: true }) });
  cleanup.push(() => tools.close());
  async function finish() { await vi.waitFor(() => expect(tools.busy).toBe(false)); return tools.snapshot(); }
  return { tools, host, surface, directory, finish };
}
describe('WP0 experiment boundaries', () => {
  it('does not write, attach or save a blog when the protected page reports expired', async () => {
    const f = await fixture(); await f.tools.handle('blog.run');
    expect((await f.finish()).lastResult).toBe('LOGIN_REQUIRED');
    for (const op of [f.surface.click, f.surface.typeText, f.surface.pressKey, f.surface.attachFiles]) expect(op).not.toHaveBeenCalled();
    const logs = await readdir(f.directory); expect(logs).toHaveLength(1);
    expect(await readFile(path.join(f.directory, logs[0]!), 'utf8')).not.toContain('https://');
  });
  it('refuses concurrent operations and accepts a stop request', async () => {
    const f = await fixture(); let release!: () => void;
    vi.mocked(f.surface.open).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    await f.tools.handle('example'); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await expect(f.tools.handle('login.open', { channel: 'naver' })).rejects.toThrow('EXPERIMENT_BUSY');
    await f.tools.handle('stop'); release(); expect((await f.finish()).lastResult).toBe('EXPERIMENT_STOPPED');
  });
  it('does not persist exception contents or band/account identifiers', async () => {
    const f = await fixture();
    vi.mocked(f.surface.open).mockRejectedValueOnce(new Error('https://site.invalid/?token=SECRET account=OWNER'));
    await f.tools.handle('login.check', { channel: 'naver' }); await f.finish();
    const data = await readFile(path.join(f.directory, (await readdir(f.directory))[0]!), 'utf8');
    expect(data).toContain('EXPERIMENT_FAILED'); expect(data).not.toMatch(/SECRET|OWNER|token|account|site\.invalid/);
  });
  it('requires an explicit band from the read list and has no publish command', async () => {
    const f = await fixture();
    await expect(f.tools.handle('publish')).rejects.toThrow('UNKNOWN_EXPERIMENT');
    await expect(f.tools.handle('band.run', { bandKey: '../anything', ua: 'desktop' })).rejects.toThrow('SELECT_BAND_AND_UA');
    await f.tools.handle('band.run', { bandKey: '123', ua: 'desktop' });
    expect((await f.finish()).lastResult).toBe('BAND_NOT_SELECTED_FROM_LIST'); expect(f.host.create).not.toHaveBeenCalled();
  });
  it('ships a sufficiently long synthetic article with no product address', () => {
    const article = exampleArticle('fixture');
    expect(article.body.length).toBeGreaterThanOrEqual(3000); expect(article.paragraphs.length).toBeGreaterThanOrEqual(15);
    expect(article.body).not.toMatch(/https?:\/\//);
  });
});
