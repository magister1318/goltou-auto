import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium, type Page } from 'playwright-core';
import { CdpConnection, CdpSurface } from '@goltou/surface/cdp';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { BandDirectory, readBandDocument } from '@goltou/sites';
import { bandFixture } from '../../sites/test/band-fixture';
import { blogFixture } from '../../sites/test/blog-fixture';
import { createBandExecution, bandObservation } from '../src/band';
import { ChannelRegistrationRunner } from '../src/band-runner';
import { compareDocuments, observePlan } from '../src/verify';
import type { InputPlan } from '../src/convert';
import type { Job, JobInput } from '../src/protocol';
import type { PreparedPreview } from '../src/preparation';
import { AppCore, MemoryTokenStore } from '../src/app';
import { ApiError, createFakeApi, type ApiClient, type ApiRoutes } from '@goltou/api-client';
import { png } from './image-fixture';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(mode = 'mobile') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'goltou-wp6-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const files = [1, 2, 3, 4, 5].map(i => ({ url: `https://example.invalid/${i}`, path: path.join(dir, `goltou-1234567890abcdef-${i}.png`) }));
  const sizes = files.map((_, i) => ({ width: mode === 'cropped' ? 100 + i * 40 : 160, height: 90 }));
  for (const [i, f] of files.entries()) await writeFile(f.path, png(sizes[i]!.width, sizes[i]!.height, i * 40));
  const newList = '<div class="myBandGroupList"><a class="myBandGroupItem" href="#" onclick="throw Error(\'AD_OPENED\')"><span class="adBox">광고</span></a><a class="myBandGroupItem" href="#"><span class="aNewFolder"></span></a><a class="myBandGroupItem" href="/band/111/post"><span class="globalMyBandName">밴드 A</span></a><a class="myBandGroupItem" href="/band/222/post"><span class="globalMyBandName">밴드 B</span></a></div>';
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/photos/')) {
      const square = mode === 'cropped' || mode === 'ratio-mismatch';
      res.writeHead(200, { 'content-type': 'image/png' }).end(png(square ? 90 : 160, 90)); return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(req.url === '/login' ? '<input type="password"><p>로컬 로그인 풀림</p>' : req.url?.startsWith('/blog') ? blogFixture(mode === 'blog-fail' ? 'duplicate' : '') : mode === 'new-home' && req.url === '/' ? '<section class="globalMyBandWrap"><a class="_allMyBandList" href="/my/bands">전체보기</a></section>' : mode === 'new-home' && req.url === '/my/bands' ? newList : bandFixture(mode));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
  cleanup.push(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let external = 0, shown = 0;
  await context.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external++; return route.abort(); } return route.continue(); });
  const pages = new Map<Surface, Page>();
  const host: SurfaceHost = {
    async create(session) {
      const page = await context.newPage(); page.on('dialog', () => {});
      const cdp = await context.newCDPSession(page);
      const shim = { send: async (method: string, params: object) => { const reply = await cdp.send(method as never, params as never) as { exceptionDetails?: { exception?: { description?: string } } }; if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? 'FIXTURE_READ_FAILED'); return reply; },
        on: (method: string, listener: (params: Record<string, unknown>) => void) => { cdp.on(method as never, listener); return () => cdp.off(method as never, listener); },
        close: () => { void cdp.detach().catch(() => {}); }, isOpen: true };
      const s = new CdpSurface(session, shim as unknown as CdpConnection, { setVisible: async visible => { if (visible) shown++; }, close: async () => page.close() }, 0);
      pages.set(s, page); return s;
    }, async destroy(s) { await s.close(); }, async clearSession() { throw Error('NO_CLEAR'); },
  };
  const directory = new BandDirectory(host, baseUrl, true);
  await directory.list();
  const plan: InputPlan = { channel: 'band', discarded: [], notices: [], steps: [
    { kind: 'text', role: 'title', text: '[골투오토 실험] WP6 예시' }, { kind: 'break' },
    { kind: 'text', role: 'body', text: '첫 안내 문단입니다.' }, { kind: 'photos', urls: files.slice(0, 2).map(f => f.url) }, { kind: 'break' },
    { kind: 'text', role: 'body', text: '둘째 안내 문단입니다.\n순서를 확인합니다.' }, { kind: 'photos', urls: files.slice(2).map(f => f.url) }, { kind: 'break' },
    { kind: 'text', role: 'departures', text: '2026-12-03 | 1190000원' }, { kind: 'break' }, { kind: 'text', role: 'courses', text: '예시CC' },
  ] };
  const check = vi.fn(), progress = vi.fn();
  const execution = createBandExecution(plan, files, directory, '111', { check, progress });
  execution.env.photoTimeoutMs = 1800;
  const page = () => pages.get(directory.surface!)!;
  const counts = () => page().evaluate<{ opens: number; posts: number; discards: number }>("({opens:Number(localStorage.getItem('opens')),posts:Number(localStorage.getItem('posts')),discards:Number(localStorage.getItem('discards'))})");
  return { baseUrl, host, directory, execution, plan, files, check, progress, pages, page, counts, external: () => external, shown: () => shown };
}
async function settled(runner: ChannelRegistrationRunner) {
  for (let n = 0; n < 600 && runner.job?.status === 'running'; n++) await new Promise(resolve => setTimeout(resolve, 25));
  expect(runner.job?.status).not.toBe('running');
}
function workFor(plan: InputPlan, files: { url: string; path: string }[]) {
  const verification = compareDocuments(observePlan(plan), observePlan(plan));
  const preview: PreparedPreview = { productNo: 1, contentHash: 'fixture', options: {}, band: plan, blog: { ...plan, channel: 'blog' }, verification: { blog: verification, band: verification } };
  return { preview, prepared: { preview, files }, download: vi.fn(async () => {}), arrange: vi.fn(async () => {}), cleanup: vi.fn(async () => {}) };
}
const input: JobInput = { productNo: 1, mode: 'draft', targets: [{ channel: 'band', name: '밴드 A', key: '111' }], options: { polish: false, closing: false, linkCard: false } };

describe.runIf(Boolean(executablePath))('WP6 real input against loopback Band pages', () => {
  it('attaches one file at a time and proves re-hosted photos without original names', async () => {
    const f = await fixture('encoded-photos'); await f.execution.write();
    expect((await readBandDocument(f.directory.surface!)).photos).toEqual(f.files.map(f => path.basename(f.path)));
    const g = await fixture('anonymous-photos');
    await g.execution.write(); await g.execution.stopBeforePost();
    expect((await readBandDocument(g.directory.surface!)).photos).toEqual(['', '', '', '', '']);
    expect(await g.page().evaluate("JSON.parse(localStorage.getItem('attachSizes'))")).toEqual([1, 1, 1, 1, 1]);
    const actual = await g.execution.observe();
    expect(actual.photoProof).toMatchObject({ urls: g.files.map(f => f.url), ratio: 'matched', counts: [1, 2, 3, 4, 5] });
    expect(compareDocuments(observePlan(g.plan), bandObservation(g.plan, g.files, actual)).matches).toBe(true);
    // The identical raw count, without this execution's ledger, supplies no photo identity.
    expect(compareDocuments(observePlan(g.plan), bandObservation(g.plan, g.files, await readBandDocument(g.directory.surface!))).matches).toBe(false);
    expect((await g.counts()).posts).toBe(0);
  }, 20000);
  it('follows the new owned-list screen and only the first non-ad, non-folder band through input', async () => {
    const f = await fixture('new-home');
    expect(f.directory.choices.map(b => ({ key: b.key, name: b.name }))).toEqual([{ key: '111', name: '밴드 A' }]);
    expect((await readBandDocument(f.directory.surface!)).composer).toBe(false);
    expect((await f.counts()).opens).toBe(0);
    await f.execution.write(); await f.execution.stopBeforePost();
    expect(await f.counts()).toEqual({ opens: 1, posts: 0, discards: 0 });
    expect(f.external()).toBe(0);
  }, 20000);
  for (const mode of ['mobile', 'desktop']) it(`${mode}: owned list, grouped photos in plan order, readback, stop before post and discard`, async () => {
    const f = await fixture(mode);
    expect(f.directory.choices.map(b => b.name)).toEqual(['밴드 A', '밴드 B']);
    expect(f.directory.choices.every(b => b.photoLimit === null)).toBe(true);
    await f.execution.write(); await f.execution.stopBeforePost();
    const actual = await f.execution.observe();
    expect(actual.photos).toEqual(f.files.map(f => path.basename(f.path)));
    expect(compareDocuments(observePlan(f.plan), bandObservation(f.plan, f.files, actual)).matches).toBe(true);
    expect(await f.execution.detectPublished()).toBeNull();
    expect(await f.counts()).toEqual({ opens: 1, posts: 0, discards: 0 }); expect(f.shown()).toBe(1);
    await f.execution.discard(); expect(await f.counts()).toEqual({ opens: 1, posts: 0, discards: 1 });
    expect((await readBandDocument(f.directory.surface!)).composer).toBe(false); expect(f.external()).toBe(0);
  }, 25000);
  for (const mode of ['drop', 'double', 'ratio-mismatch']) it(`rejects ${mode} without handoff, posting or a count-only retry`, async () => {
    const f = await fixture(mode);
    await expect(f.execution.write()).rejects.toThrow('BAND_READBACK_MISMATCH:photos');
    await expect(f.execution.stopBeforePost()).rejects.toThrow('BAND_READBACK_MISMATCH:photos');
    const attached = await f.page().evaluate("localStorage.getItem('attachSizes')");
    await expect(f.execution.write()).rejects.toThrow('BAND_READBACK_MISMATCH:photos');
    expect(await f.page().evaluate("localStorage.getItem('attachSizes')")).toBe(attached);
    expect(f.shown()).toBe(0); expect((await f.counts()).posts).toBe(0);
  }, 20000);
  it('records fixed-shape cropping as unavailable and retains the one-by-one proof', async () => {
    const f = await fixture('cropped'); await f.execution.write(); await f.execution.stopBeforePost();
    expect((await f.execution.observe()).photoProof).toMatchObject({ urls: f.files.map(f => f.url), ratio: 'unavailable', counts: [1, 2, 3, 4, 5] });
    expect((await f.counts()).posts).toBe(0);
  }, 20000);
  it('rejects front insertion when a previous slot signature moves, before handoff or posting', async () => {
    const f = await fixture('reorder');
    await expect(f.execution.write()).rejects.toThrow('BAND_READBACK_MISMATCH');
    await expect(f.execution.stopBeforePost()).rejects.toThrow('BAND_READBACK_MISMATCH');
    expect(await f.counts()).toEqual({ opens: 1, posts: 0, discards: 0 });
    const wrong = await readBandDocument(f.directory.surface!); wrong.body = wrong.body.replace('1190000', '1190001');
    expect(compareDocuments(observePlan(f.plan), bandObservation(f.plan, f.files, wrong)).differences.some(d => d.field === 'prices')).toBe(true);
  }, 20000);
  it('records only an observed photo limit, blocks before input and does not truncate photos', async () => {
    const f = await fixture('limit'); await expect(f.execution.write()).rejects.toThrow('BAND_PHOTO_LIMIT');
    await expect(f.execution.write()).rejects.toThrow('BAND_PHOTO_LIMIT');
    expect(f.directory.choices[0]).toMatchObject({ photoLimit: 2, observedAt: expect.any(String) });
    expect(await readBandDocument(f.directory.surface!)).toMatchObject({ body: '', photos: [] });
    expect(await f.counts()).toEqual({ opens: 1, posts: 0, discards: 0 });
  }, 20000);
  it('detects manual publication only from a new post URL plus re-read content; local automatic publication clicks once', async () => {
    const f = await fixture(); await f.execution.write(); await f.execution.stopBeforePost();
    await f.page().getByRole('button', { name: '완료', exact: true }).click();
    await f.page().waitForURL('**/post/1001');
    expect(await f.execution.detectPublished()).toBe(`${f.baseUrl}/band/111/post/1001`);
    const g = await fixture(); await g.execution.write();
    expect(await g.execution.publish()).toBe(`${g.baseUrl}/band/111/post/1001`);
    expect(await g.execution.publish()).toBe(`${g.baseUrl}/band/111/post/1001`);
    expect((await g.counts()).posts).toBe(1); expect(g.external()).toBe(0);
  }, 30000);
  it('keeps the same surface and matching prefix on resume; changed content requires consent before restarting', async () => {
    const f = await fixture(); let paused = false;
    f.progress.mockImplementation(() => { if (!paused) { paused = true; f.check.mockImplementation(() => { throw Error('TEST_PAUSE'); }); } });
    await expect(f.execution.write()).rejects.toThrow('TEST_PAUSE'); const original = f.directory.surface;
    f.check.mockImplementation(() => {}); await f.execution.write(); expect(f.directory.surface).toBe(original);
    expect((await f.counts()).opens).toBe(1);
    await original!.typeText('사용자 수정'); await expect(f.execution.write()).rejects.toThrow('BAND_RESTART_REQUIRED');
    expect((await f.counts()).discards).toBe(0);
    f.execution.allowRestart(); await f.execution.write(); expect(f.directory.surface).toBe(original);
    expect(await f.counts()).toEqual({ opens: 2, posts: 0, discards: 1 });
    await original!.open({ url: `${f.baseUrl}/login`, session: 'band', width: 1280, height: 900, userAgent: 'fixture' });
    await expect(f.directory.guard(false)).rejects.toThrow('BAND_LOGIN_LOST');
    expect((await f.page().locator('input').inputValue())).toBe('');
    await original!.open({ url: `${f.baseUrl}/band/111/post`, session: 'band', width: 1280, height: 900, userAgent: 'fixture' });
    await f.execution.write(); expect(f.directory.surface).toBe(original); expect((await f.counts()).opens).toBe(3);
  }, 30000);
  it('runs selected bands sequentially, records discard as stopped and detects a manually published next band', async () => {
    const f = await fixture(); const states: Job[] = [];
    const runner = new ChannelRegistrationRunner({ band: { host: f.host, baseUrl: f.baseUrl, localPublish: true } }, async j => { states.push(j); }, () => {});
    cleanup.push(async () => runner.dispose()); await runner.listBands();
    const work = workFor(f.plan, f.files);
    await runner.start({ ...input, targets: [...input.targets, { channel: 'band', name: '밴드 B', key: '222' }] }, '로컬', 5, work); await settled(runner);
    expect(runner.job).toMatchObject({ status: 'stopped_before_post', activeTargetKey: '111' });
    expect(runner.job!.targetResults!.map(t => t.status)).toEqual(['stopped_before_post', 'running']);
    await runner.discardBand(); await settled(runner);
    expect(runner.job).toMatchObject({ status: 'stopped_before_post', activeTargetKey: '222' });
    expect(runner.job!.targetResults!.map(t => t.status)).toEqual(['stopped', 'stopped_before_post']);
    const page = f.pages.get(runner.directory.surface!)!;
    await page.getByRole('button', { name: '완료', exact: true }).click(); await page.waitForURL('**/post/1001');
    await runner.checkBand(); await settled(runner); expect(runner.job?.status).toBe('published');
    expect(runner.job?.targetResults?.[1]).toMatchObject({ status: 'published', postUrl: `${f.baseUrl}/band/222/post/1001` });
    expect(work.cleanup).toHaveBeenCalledTimes(1);
    expect(states.some(j => j.status === 'stopped_before_post' && j.completedSteps.includes(6))).toBe(false);
  }, 30000);
  it('pauses on a local login loss, accepts no credential input and resumes in the same surface', async () => {
    const f = await fixture();
    const runner = new ChannelRegistrationRunner({ band: { host: f.host, baseUrl: f.baseUrl, localPublish: true } }, async () => {}, () => {});
    cleanup.push(async () => runner.dispose()); await runner.listBands();
    await runner.start(input, '로컬', 5, workFor(f.plan, f.files)); await settled(runner);
    const surface = runner.directory.surface!;
    await surface.open({ url: `${f.baseUrl}/login`, session: 'band', width: 1280, height: 900, userAgent: 'fixture' });
    await runner.checkBand(); expect(runner.job).toMatchObject({ status: 'login_paused', service: 'band' });
    expect(await runner.checkBandLogin()).toBe('expired');
    expect(await f.pages.get(surface)!.locator('input').inputValue()).toBe('');
    await surface.open({ url: `${f.baseUrl}/band/111/post`, session: 'band', width: 1280, height: 900, userAgent: 'fixture' });
    await runner.resume(); await settled(runner);
    expect(runner.directory.surface).toBe(surface); expect(runner.job?.status).toBe('stopped_before_post');
    expect(await f.pages.get(surface)!.evaluate('Number(localStorage.getItem("opens"))')).toBe(2);
  }, 25000);
  it('passes native discard confirmation to the UI and waits for an explicit answer', async () => {
    const f = await fixture('native-dialog');
    const runner = new ChannelRegistrationRunner({ band: { host: f.host, baseUrl: f.baseUrl, localPublish: true } }, async () => {}, () => {});
    cleanup.push(async () => runner.dispose()); await runner.listBands();
    await runner.start(input, '로컬', 5, workFor(f.plan, f.files)); await settled(runner); await runner.discardBand();
    expect(runner.job).toMatchObject({ status: 'dialog_paused', service: 'band', dialog: { kind: 'confirm' } });
    await runner.answerDialog(runner.job!.dialog!.id, false); expect(runner.job?.status).toBe('stopped_before_post');
    await runner.discardBand(); await runner.answerDialog(runner.job!.dialog!.id, true); await settled(runner);
    expect(runner.job?.status).toBe('stopped');
  }, 30000);
  it('finishes blog before Band, and requires an explicit choice to continue after blog failure', async () => {
    for (const mode of ['mobile', 'blog-fail']) {
      const f = await fixture(mode);
      const captureBand = vi.fn(async () => ({ redacted: true, file: 'band-masked.png' }));
      const captureBlog = vi.fn(async () => ({ redacted: true, file: 'blog-masked.png' }));
      const recordFailure = vi.fn(async () => {});
      const runner = new ChannelRegistrationRunner({ band: { host: f.host, baseUrl: f.baseUrl, localPublish: true, capture: captureBand }, blog: { host: f.host, editorUrl: `${f.baseUrl}/blog`, localPublish: true, capture: captureBlog, recordFailure } }, async () => {}, () => {});
      cleanup.push(async () => runner.dispose()); await runner.listBands();
      const plan = { ...f.plan, steps: f.plan.steps.filter(s => s.kind !== 'photos') };
      const work = workFor(plan, []);
      await runner.start({ ...input, targets: [{ channel: 'blog', key: 'sample', name: '블로그' }, ...input.targets] }, '로컬', 0, work); await settled(runner);
      if (mode === 'blog-fail') {
        expect(runner.job?.status).toBe('channel_paused');
        expect(runner.job?.evidence).toBe('blog-masked.png');
        expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'DRAFT_IDENTITY_AMBIGUOUS', evidence: 'blog-masked.png' }));
        expect((await readBandDocument(runner.directory.surface!)).composer).toBe(false);
        await runner.continueBand(); await settled(runner);
      }
      expect(runner.job?.status).toBe('stopped_before_post');
      expect(captureBlog).toHaveBeenCalledTimes(1); expect(captureBand).toHaveBeenCalledTimes(1);
      expect(runner.job?.evidence).toBe('band-masked.png');
      expect(runner.job!.targetResults!.find(t => t.channel === 'blog')!.status).toBe(mode === 'blog-fail' ? 'failed' : 'draft_saved');
      if (mode === 'blog-fail') {
        await runner.discardBand(); await settled(runner);
        expect(runner.job).toMatchObject({ status: 'failed', completedSteps: expect.arrayContaining([7]) });
        await expect(runner.start(input, '다음 상품', 0, work)).resolves.toBeUndefined();
        await runner.stop();
      }
    }
  }, 40000);
  it('records preparation failure per channel and retries before opening any composer', async () => {
    const f = await fixture();
    const runner = new ChannelRegistrationRunner({ band: { host: f.host, baseUrl: f.baseUrl, localPublish: true } }, async () => {}, () => {});
    cleanup.push(async () => runner.dispose()); await runner.listBands();
    const work = workFor(f.plan, f.files); work.download.mockRejectedValueOnce(new Error('PHOTO_DOWNLOAD_FAILED'));
    await runner.start(input, '로컬', 5, work); await settled(runner);
    expect(runner.job).toMatchObject({ status: 'failed', step: 2, targetResults: [{ status: 'failed', reason: 'PHOTO_DOWNLOAD_FAILED' }] });
    expect((await readBandDocument(runner.directory.surface!)).composer).toBe(false);
    await runner.resume(); await settled(runner);
    expect(work.download).toHaveBeenCalledTimes(2); expect(runner.job?.status).toBe('stopped_before_post');
  }, 20000);
});

describe('WP6 daily limit and real-service boundaries', () => {
  it('accepts the observed www Band redirect but rejects lookalikes and external origins', () => {
    const host: SurfaceHost = { create: vi.fn(), destroy: vi.fn(), clearSession: vi.fn() };
    const directory = new BandDirectory(host);
    expect(directory.sameOrigin(new URL('https://band.us/'))).toBe(true);
    expect(directory.sameOrigin(new URL('https://www.band.us/'))).toBe(true);
    for (const url of ['http://www.band.us/', 'https://band.us.example.invalid/', 'https://other.band.us/']) expect(directory.sameOrigin(new URL(url))).toBe(false);
    expect(new BandDirectory(host, 'http://127.0.0.1:12345', true).sameOrigin(new URL('https://www.band.us/'))).toBe(false);
  });
  it('rejects real auto-post, second-band targets and lifetime composer attempts beyond three', async () => {
    const host: SurfaceHost = { create: vi.fn(), destroy: vi.fn(), clearSession: vi.fn() };
    const runner = new ChannelRegistrationRunner({ band: { host } }, async () => {}, () => {});
    runner.directory.choices = [{ key: '111', name: '밴드 A', photoLimit: null, observedAt: null }, { key: '222', name: '밴드 B', photoLimit: null, observedAt: null }];
    const plan: InputPlan = { channel: 'band', steps: [], discarded: [], notices: [] };
    await expect(runner.start({ ...input, mode: 'publish', publishConfirmed: true }, '로컬', 0, workFor(plan, []))).rejects.toMatchObject({ code: 'invalid' });
    await expect(runner.start({ ...input, targets: [{ channel: 'band', key: '222', name: '밴드 B' }] }, '로컬', 0, workFor(plan, []))).rejects.toMatchObject({ code: 'invalid' });
    expect(host.create).not.toHaveBeenCalled();
    runner.directory.surface = { readState: async () => ({ url: 'https://band.us/band/111/post', title: '', loading: false }) } as Surface;
    const execution = createBandExecution(plan, [], runner.directory, '111', { check: () => {}, progress: () => {} });
    await expect(execution.publish()).rejects.toThrow('REAL_BAND_PUBLISH_DISABLED');
    for (let i = 0; i < 3; i++) runner.directory.beforeOpen('111');
    expect(() => runner.directory.beforeOpen('111')).toThrow('BAND_COMPOSER_LIMIT');
    expect(() => runner.directory.beforeOpen('222')).toThrow('BAND_FIRST_ONLY');
    expect(() => new BandDirectory(host, 'https://band.us', true)).toThrow('LOCAL_BAND_REQUIRED'); runner.dispose();
  });
  it('honors posts/start conflict before any runner start and exposes the band reason', async () => {
    const start = vi.fn();
    const api: ApiClient = { async request<P extends keyof ApiRoutes>(route: P): Promise<ApiRoutes[P]['output']> {
      if (route === '/auto/products/get') return { productNo: 1, title: '예시', contentsHtml: '<p>안내</p>', images: [], departures: [], golfCourses: [], productUrl: 'https://example.invalid/1', contentHash: 'fixture', country: '예시', region: '예시', updatedAt: '2026-11-13' } as ApiRoutes[P]['output'];
      throw new ApiError('conflict', '이 밴드의 하루 등록 한도에 도달했습니다.');
    } };
    const tokens = new MemoryTokenStore(); await tokens.write('synthetic-session');
    const app = new AppCore(api, tokens, () => ({ job: null, start, stop: async () => {}, resume: async () => {}, dispose() {} }));
    await expect(app.handle({ id: 1, type: 'app', command: 'job.start', input })).rejects.toThrow('밴드 A: 이 밴드의 하루 등록 한도');
    expect(start).not.toHaveBeenCalled(); app.dispose();
  });
  it('fake API counts pending handoffs toward the daily limit and releases a discarded composition', async () => {
    const api = createFakeApi();
    const { token } = await api.request('/auto/login', { loginId: 'admin', password: 'demo', device: { kind: 'test', model: 'synthetic', appVersion: '0' } });
    await api.request('/auto/settings/save', { closingText: '', defaultHashtags: [], bandDailyLimit: 1 }, token);
    const value = { productNo: 1234, channel: 'band' as const, mode: 'draft' as const, target: { key: 'local-limit', name: '밴드 A' }, options: input.options, contentHash: 'fake-content-0' };
    const { postNo } = await api.request('/auto/posts/start', value, token);
    await api.request('/auto/posts/update', { postNo, status: 'stopped_before_post', step: 6, failReason: '', postUrl: '' }, token);
    await expect(api.request('/auto/posts/start', value, token)).rejects.toMatchObject({ code: 'conflict' });
    await api.request('/auto/posts/update', { postNo, status: 'stopped', step: 6, failReason: '', postUrl: '' }, token);
    await expect(api.request('/auto/posts/start', value, token)).resolves.toHaveProperty('postNo');
  });
});
