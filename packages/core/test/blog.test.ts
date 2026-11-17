import { loggedFixture, faultedLog, runnerLogSteps } from './log-fixture';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { CdpConnection, CdpSurface } from '@goltou/surface/cdp';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { BlogFormattingError, compareBlogFormatting, normalizeBlogRuns, readBlogDocument } from '@goltou/sites';
import { createBlogExecution, blogObservation } from '../src/blog';
import { compareDocuments, observePlan } from '../src/verify';
import type { InputPlan } from '../src/convert';
import { blogFixture } from '../../sites/test/blog-fixture';
import { BlogRegistrationRunner } from '../src/blog-runner';
import { ChannelRegistrationRunner } from '../src/band-runner';
import { realEnding } from './fixtures/real-ending';
import type { PreparedPreview } from '../src/preparation';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(mode = '', extra: { tags?: boolean; photos?: number; photoExtension?: string } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'goltou-wp5-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const files = Array.from({ length: extra.photos ?? 5 }, (_, i) => i + 1).map(i => ({ url: `https://example.invalid/${i}`, path: path.join(dir, `goltou-1234567890abcdef-${i}.${extra.photoExtension ?? 'png'}`) }));
  for (const file of files) await writeFile(file.path, new Uint8Array([137, 80, 78, 71]));
  const server = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(req.url === '/RabbitTempPostWrite.naver' ? JSON.stringify({isSuccess:true,result:{}}) : req.url === '/login' ? '<input type="password"><p>로컬 로그인 풀림 예시</p>' : req.url?.startsWith('/published/') ? '<h1>로컬 발행 결과</h1>' : mode === 'delayed-frame' && req.url === '/editor' ? '<script>setTimeout(()=>{const f=document.createElement("iframe");f.src="/ready-editor";document.body.append(f)},500)</script><body></body>' : blogFixture(mode)));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as { port: number }).port, editorUrl = `http://127.0.0.1:${port}/editor`;
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run', `--explicitly-allowed-ports=${port}`] });
  cleanup.push(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let external = 0;
  await context.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external++; return route.abort(); } return route.continue(); });
  const pages = new Map<Surface, import('playwright-core').Page>();
  const readbackBarriers = vi.fn();
  const host: SurfaceHost = {
    async create() { const page = await context.newPage(); page.on('dialog', () => {}); const cdp = await connection(page); const s = new CdpSurface('naver', cdp as unknown as CdpConnection, { setVisible: async () => {}, close: async () => page.close() }, 0); const block=s.blockRequests.bind(s); s.blockRequests=async rules=>{readbackBarriers(rules,page.url());await block(rules);}; pages.set(s, page); return s; },
    async destroy(surface) { await surface.close(); }, async clearSession() { throw Error('NO_CLEAR'); },
  };
  async function connection(page: import('playwright-core').Page) {
    const session = await context.newCDPSession(page);
    // Adapt Playwright's existing CDP session to CdpSurface without exposing any external browser.
    const shim = { send: (method: string, params: object) => session.send(method as never, params as never),
      on: (method: string, listener: (params: Record<string, unknown>) => void) => { session.on(method as never, listener); return () => session.off(method as never, listener); },
      close: () => { void session.detach().catch(() => {}); }, isOpen: true };
    return shim;
  }
  const steps: InputPlan['steps'] = [{ kind: 'text', role: 'title', text: '[골투오토 실험] WP5 로컬' }, { kind: 'break' }];
  for (let i = 0; i < Math.min(5, files.length); i++) steps.push({ kind: 'text', role: 'body', text: `안내 ${i + 1} 문단입니다.` }, { kind: 'break' }, { kind: 'photos', urls: [files[i]!.url] });
  steps.push({ kind: 'table', role: 'departures', rows: [['2026-12-03', '1190000원'], ['2026-12-10', '1250000원']] }, { kind: 'break' }, { kind: 'text', role: 'courses', text: '예시CC' }, { kind: 'break' });
  if (extra.tags) steps.push({ kind: 'text', role: 'closing', text: '문의해 주세요.' }, { kind: 'break' }, { kind: 'text', role: 'linkCard', text: 'https://example.invalid/product' }, { kind: 'break' }, { kind: 'text', role: 'hashtags', text: '#골프 #예시' });
  const plan: InputPlan = { channel: 'blog', steps, discarded: [], notices: [] };
  const beforeSave = vi.fn(), check = vi.fn(), progress = vi.fn();
  const execution = createBlogExecution(plan, files, { host, editorUrl, localPublish: true }, { check, progress, beforeSave });
  return { execution, plan, files, pages, host, editorUrl, check, beforeSave, progress, readbackBarriers, external: () => external,
    counts: async (surface = execution.surface!) => pages.get(surface)!.evaluate<{ saves: number; publishes: number }>("({saves:Number(localStorage.getItem('saves')),publishes:Number(localStorage.getItem('publishes'))})") };
}
describe.runIf(Boolean(executablePath))('WP5 input and save against a loopback editor only', () => {
  it.each([false, true])('saves and reopens body-derived tags with explicit tags %s, retaining exact bold, links and numbers', async explicit => {
    const f = await fixture('metadata-body-tags');
    const text = '문의 #본문 1190000원';
    f.plan.steps = [{ kind: 'text', role: 'title', text: '#제목' }, { kind: 'text', role: 'body', text,
      runs: [{ text: '문의 ' }, { text: '#본문', bold: true, href: 'https://example.invalid/ask#주소' }, { text: ' 1190000원' }] },
      ...(explicit ? [{ kind: 'text' as const, role: 'hashtags' as const, text: '#계획 #본문 #계획' }] : [])];
    await f.execution.write();
    const before = await f.execution.observe();
    expect(before.tags).toEqual(explicit ? ['본문', '계획'] : ['본문']);
    const check = (actual: typeof before) => compareDocuments(observePlan(f.plan), blogObservation(f.plan, [], actual));
    expect(check(before).matches).toBe(true);
    for (const tags of [[], ['본문', '외부'], ['본문', '본문'], ['다른태그']]) expect(check({ ...before, tags }).matches).toBe(false);
    expect(check({ ...before, tokens: [{ kind: 'text', text: text.replace('1190000', '1190001') }] }).matches).toBe(false);
    const original = f.execution.surface;
    const saved = await f.execution.saveAndVerify();
    expect(f.execution.surface).not.toBe(original);
    expect(saved.tags).toEqual(before.tags);
    expect(compareBlogFormatting(f.plan, saved)).toEqual([]);
    expect(check(saved).matches).toBe(true);
    for (const tags of [saved.tags.slice(1), [...saved.tags, '외부태그'], saved.tags.map(t => t === '본문' ? '다른본문' : t)]) {
      expect(compareDocuments(observePlan(f.plan), blogObservation(f.plan, f.files, { ...saved, tags })).matches).toBe(false);
    }
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 });
    expect(f.external()).toBe(0);
  }, 30000);
  it('prevents readback from recreating an autosave, retains the saved draft, and opens the next editor without consent', async () => {
    const f = await fixture('autosave-readback');
    f.plan.steps = [{ kind: 'text', role: 'title', text: '저장 후 자동저장 예시' }, { kind: 'text', role: 'body', text: '본문' }];
    let remembered: string | null = null;
    const store = { read: async () => remembered, write: async (title: string) => { remembered = title; } };
    const execution = createBlogExecution(f.plan, [], { host: f.host, editorUrl: f.editorUrl, lastTypedTitle: store }, { check: f.check, progress: f.progress, beforeSave: f.beforeSave });
    await execution.write(); expect(remembered).toBe('저장 후 자동저장 예시');
    await execution.saveAndVerify();
    await new Promise(r => setTimeout(r, 3400));
    const page = f.pages.get(execution.surface!)!;
    expect(await page.evaluate(`({attempted:localStorage.getItem('autosaveAttempted'),blocked:localStorage.getItem('autosaveBlocked'),leftover:localStorage.getItem('leftover'),drafts:JSON.parse(localStorage.getItem('drafts')||'[]').length})`)).toEqual({ attempted: 'yes', blocked: 'yes', leftover: null, drafts: 1 });
    expect(f.external()).toBe(0); expect(f.beforeSave).toHaveBeenCalledTimes(1);
    await execution.close();
    const next = createBlogExecution(f.plan, [], { host: f.host, editorUrl: f.editorUrl, lastTypedTitle: store }, { check: f.check, progress: f.progress, beforeSave: f.beforeSave });
    await expect(next.ensureReady()).resolves.toBeUndefined();
  }, 20000);
  it.each([false, true])('WP16 recovery consent %s stops cleanly or resumes the same job and surface', async discard => {
    const f = await fixture('restore');
    f.plan.steps = [{ kind: 'text', role: 'title', text: '[골투오토 실험] 복구 예시' }, { kind: 'text', role: 'body', text: '복구 안내 확인' }];
    const verification = compareDocuments(observePlan(f.plan), observePlan(f.plan));
    const preview: PreparedPreview = { productNo: 1, contentHash: 'fixture', droppedStruckCharacters: 0, options: {}, blog: f.plan, band: { ...f.plan, channel: 'band' }, verification: { blog: verification, band: verification } };
    const work = { preview, prepared: { preview, files: [] }, download: vi.fn(async () => {}), arrange: vi.fn(async () => {}), cleanup: vi.fn(async () => {}) };
    const runner = new ChannelRegistrationRunner({ band: { host: f.host, baseUrl: new URL(f.editorUrl).origin, localPublish: true }, blog: { host: f.host, editorUrl: f.editorUrl, localPublish: true } }, async () => {}, () => {});
    cleanup.push(async () => runner.dispose());
    const settle = async () => { for(let i=0;i<1200&&runner.job?.status==='running';i++) await new Promise(r=>setTimeout(r,25)); };
    await runner.start({ productNo: 1, mode: 'draft', targets: [{ channel: 'blog', name: '예시', key: 'fixture' }], options: { polish: false, closing: false, linkCard: false } }, '복구 예시', 0, work);
    await settle(); expect(runner.job?.status).toBe('recovery_paused');
    const id = runner.job!.id, surfaces = f.pages.size;
    await runner.recover(discard); await settle();
    expect(runner.job?.id).toBe(id);
    expect(runner.job?.status).toBe(discard ? 'draft_saved' : 'stopped');
    expect(runner.job?.targetResults?.[0]?.status).toBe(discard ? 'draft_saved' : 'stopped');
    if(discard) expect(work.download).toHaveBeenCalledTimes(1); else expect(work.download).not.toHaveBeenCalled();
    expect(f.pages.size).toBe(discard ? surfaces + 1 : surfaces); // only fresh save readback opens another surface
    expect(f.external()).toBe(0);
  }, 40000);
  it('uploads 36 photos individually, reports every completed photo and sweeps a fresh tall draft for lazy identities', async () => {
    const f = await fixture('metadata-heavy', { photos: 36 });
    f.plan.steps = [{ kind: 'text', role: 'title', text: '[골투오토 실험] 로컬 사진 36장' }, { kind: 'break' },
      { kind: 'photos', urls: f.files.map(file => file.url) }, { kind: 'text', role: 'body', text: '사진 뒤 안내' }];
    await f.execution.write();
    const values = f.progress.mock.calls.map(([value]) => value as import('@goltou/sites').BlogProgress);
    expect([...new Set(values.map(v => v.photos))]).toEqual(Array.from({ length: 37 }, (_, i) => i));
    expect(values.at(-1)).toMatchObject({ photos: 36, photoUploadSamples: 36, photoUploadMilliseconds: expect.any(Number) });
    const page = f.pages.get(f.execution.surface!)!;
    expect(await page.evaluate('window.attachmentSizes')).toEqual(Array(36).fill(1));
    await f.execution.saveAndVerify();
    expect(f.execution.readbackTimings.at(-1)).toMatchObject({ photos: 36, navigationKeys: expect.any(Number) });
    expect(f.execution.readbackTimings.at(-1)!.navigationKeys).toBeGreaterThan(10);
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 }); expect(f.external()).toBe(0);
  }, 120000);
  it('preserves links, flattened inline elements and short text after the last seven photos with options off', async () => {
    const f = await fixture('missing-tags', { photos: 8 });
    const preview = realEnding(f.files, false);
    expect(preview.verification.blog.matches).toBe(true);
    f.plan.steps = preview.blog.steps;
    expect(f.plan.steps.slice(-3).map(s => s.kind)).toEqual(['photos', 'text', 'break']);
    await f.execution.write(); await f.execution.saveAndVerify();
    expect(f.progress).toHaveBeenLastCalledWith(expect.objectContaining({ photos: 8, totalPhotos: 8, characters: 1509, totalCharacters: 1509 }));
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 }); expect(f.external()).toBe(0);
  }, 40000);
  it.each(['blog', 'channel'] as const)('records the missing final tag control and exact plan step without content in the %s runner', async kind => {
    const f = await fixture('missing-tags', { photos: 8 });
    const preview = realEnding(f.files, true);
    const tagIndex = preview.blog.steps.findIndex(s => s.kind === 'text' && s.role === 'hashtags') + 1;
    const code = `CONTROL_NOT_FOUND:BLOG_TAG_INPUT:TEXT_HASHTAGS:${tagIndex}`;
    const recordFailure = vi.fn(async () => {});
    const services = { host: f.host, editorUrl: f.editorUrl, localPublish: true, recordFailure };
    const runner = kind === 'blog' ? new BlogRegistrationRunner(services, async () => {}, () => {})
      : new ChannelRegistrationRunner({ blog: services, band: { host: f.host } }, async () => {}, () => {});
    cleanup.push(async () => runner.dispose());
    const work = { preview, prepared: { preview, files: f.files }, download: async () => {}, arrange: async () => {}, cleanup: async () => {} };
    await runner.start({ productNo: 1, mode: 'draft', targets: [{ channel: 'blog', key: 'local', name: '로컬' }], options: { polish: false, closing: false, linkCard: false } }, '[골투오토 실험] 로컬 끝 구조', 8, work);
    for (let i = 0; i < 1000 && runner.job?.status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 50));
    expect(runner.job).toMatchObject({ status: 'failed', step: 4, current: 8, total: 8, characters: 1509, totalCharacters: 1512, failureCode: code });
    expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({ step: 4, code }));
    const json = JSON.stringify(recordFailure.mock.calls);
    expect(json).not.toMatch(/https:|로컬|예시|가가|끝글/);
    expect(await f.counts([...f.pages.keys()].at(-1)!)).toEqual({ saves: 0, publishes: 0 }); expect(f.external()).toBe(0);
  }, 60000);
  it('opens the desktop metadata layer for final tags and reopens it to verify a fresh draft without publishing', async () => {
    const f = await fixture('metadata-tags', { photos: 8, photoExtension: 'jpg' });
    const preview = realEnding(f.files, true);
    f.plan.steps = preview.blog.steps;
    const body = f.plan.steps.find(s => s.kind === 'text' && s.role === 'body' && s.text.includes('가'.repeat(40)));
    if (!body || body.kind !== 'text') throw new Error('FIXTURE_PADDING_REQUIRED');
    // The old 32-codepoint chunk boundary separated the base and selector.
    body.text = '가'.repeat(31) + '✈️' + body.text.slice(33);
    body.runs = [{ text: body.text }];
    await f.execution.write();
    expect((await readBlogDocument(f.execution.surface!)).tokens.filter(t => t.kind === 'photo').every(t => t.identity.endsWith('.png'))).toBe(true);
    const altered = structuredClone(await readBlogDocument(f.execution.surface!));
    const photo = altered.tokens.find(t => t.kind === 'photo');
    if (!photo || photo.kind !== 'photo') throw new Error('FIXTURE_PHOTO_REQUIRED');
    photo.identity = photo.identity.replace('1234567890abcdef', '0000000000000000');
    expect(compareDocuments(observePlan(f.plan), blogObservation(f.plan, f.files, altered)).differences.some(d => d.field === 'photos')).toBe(true);
    expect((await f.execution.observe()).tags).toEqual(['예시']);
    expect(f.progress).toHaveBeenLastCalledWith(expect.objectContaining({ photos: 8, totalPhotos: 8, characters: 1512, totalCharacters: 1512 }));
    const original = f.execution.surface;
    await f.execution.saveAndVerify();
    expect(f.execution.surface).not.toBe(original);
    expect((await f.execution.observe()).tags).toEqual(['예시']);
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 });
    expect(f.external()).toBe(0);
  }, 60000);
  it('blocks every key and unsafe click on the final publish control, and rechecks focus after tag typing', async () => {
    const f = await fixture('metadata-focus-lost');
    f.plan.steps = [{ kind: 'text', role: 'title', text: '[골투오토 실험] 안전' }, { kind: 'break' },
      { kind: 'text', role: 'body', text: '본문' }, { kind: 'text', role: 'hashtags', text: '#예시' }];
    await expect(f.execution.write()).rejects.toThrow('BLOG_TAG_FOCUS_LOST');
    const s = f.execution.surface!, page = f.pages.get(s)!;
    expect(await page.locator('[data-metadata-panel]').count()).toBe(0);
    // The fixture itself moves focus by real UI input. The executor's Surface
    // must reject Enter before any input, independent of the tag-writing path.
    await page.locator('[data-click-area="tpb.publish"]').click();
    await page.locator('[data-click-area="tpb*i.publish"]').click({ trial: true });
    await page.locator('#tag-input').click();
    await page.keyboard.press('Tab');
    expect(await page.evaluate('document.activeElement?.getAttribute("data-click-area")')).toBe('tpb*i.publish');
    for (const key of ['Enter', 'Tab', 'PageDown', 'Escape']) await expect(s.pressKey({ key })).rejects.toThrow('BLOG_TAG_FOCUS_LOST');
    const box = (await page.locator('[data-click-area="tpb*i.publish"]').boundingBox())!;
    await expect(s.click(box.x + box.width / 2, box.y + box.height / 2)).rejects.toThrow('BLOG_TAG_FOCUS_LOST');
    const save = (await page.locator('[data-click-area="tpb.save"]').boundingBox())!;
    await expect(s.click(save.x + save.width / 2, save.y + save.height / 2)).rejects.toThrow('BLOG_TAG_FOCUS_LOST');
    expect(await f.counts()).toEqual({ saves: 0, publishes: 0 });
    expect(f.beforeSave).not.toHaveBeenCalled(); expect(f.external()).toBe(0);
  }, 20000);
  it('aborts when the metadata layer cannot be verified closed, before attempting draft save', async () => {
    const f = await fixture('metadata-stuck');
    f.plan.steps = [{ kind: 'text', role: 'title', text: '[골투오토 실험] 닫기' }, { kind: 'break' },
      { kind: 'text', role: 'body', text: '본문' }, { kind: 'text', role: 'hashtags', text: '#예시' }];
    await expect(f.execution.write()).rejects.toThrow('BLOG_TAG_LAYER_NOT_CLOSED');
    await expect(f.execution.saveAndVerify()).rejects.toThrow('BLOG_TAG_LAYER_NOT_CLOSED');
    expect(f.beforeSave).not.toHaveBeenCalled();
    expect(await f.counts()).toEqual({ saves: 0, publishes: 0 }); expect(f.external()).toBe(0);
  }, 20000);
  it('waits for an editor iframe created after the outer load instead of claiming login loss', async () => {
    const f = await fixture('delayed-frame');
    await f.execution.ensureReady();
    expect(await readBlogDocument(f.execution.surface!)).toEqual({ title: '', tokens: [], tags: [] });
    expect(f.beforeSave).not.toHaveBeenCalled(); expect(f.external()).toBe(0);
  });
  it('preserves five interleaved photos, native cells, and verifies a fresh draft despite an ambiguous save response', async () => {
    const f = await fixture('ambiguous'); await f.execution.write();
    expect(f.execution.tableModes).toEqual(['native']);
    const before = await readBlogDocument(f.execution.surface!);
    expect(before.tokens.filter(t => t.kind === 'photo')).toHaveLength(5);
    expect(compareDocuments(observePlan(f.plan), blogObservation(f.plan, f.files, before)).matches).toBe(true);
    await f.execution.saveAndVerify(); expect(f.beforeSave).toHaveBeenCalledTimes(1);
    expect(f.readbackBarriers).toHaveBeenCalledWith([{ hostname: 'blog.naver.com', pathname: '/RabbitAutoSaveWrite.naver' }], 'about:blank');
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 }); expect(f.external()).toBe(0);
    const original = f.execution.surface!;
    f.execution.surface = { readState: async () => ({ url: 'https://blog.naver.com/never-requested', title: '', loading: false }) } as Surface;
    await expect(f.execution.publish()).rejects.toThrow('REAL_PUBLISH_DISABLED');
    f.execution.surface = original;
    await f.execution.saveAndVerify(); expect(f.beforeSave).toHaveBeenCalledTimes(1);
    await expect(f.execution.publish()).rejects.toThrow('REAL_PUBLISH_DISABLED');
  }, 40000);
  it('uses a recorded text list fallback, keeps closing/link/tag options, and rejects reordered photos and changed facts', async () => {
    const f = await fixture('bad-table', { tags: true }); await f.execution.write();
    expect(f.execution.tableModes).toEqual(['text-list']); expect(f.execution.linkCard).toBe('url-text');
    await f.execution.saveAndVerify(); const actual = await readBlogDocument(f.execution.surface!);
    const swapped = structuredClone(actual); const photos = swapped.tokens.filter(t => t.kind === 'photo');
    [photos[0]!.identity, photos[1]!.identity] = [photos[1]!.identity, photos[0]!.identity];
    expect(compareDocuments(observePlan(f.plan), blogObservation(f.plan, f.files, swapped)).matches).toBe(false);
    const wrong = structuredClone(actual); const row = wrong.tokens.find(t => t.kind === 'text' && t.text.includes('1190000'))!;
    if (row.kind === 'text') row.text = row.text.replace('1190000', '1190001');
    expect(compareDocuments(observePlan(f.plan), blogObservation(f.plan, f.files, wrong)).differences.some(d => d.field === 'prices')).toBe(true);
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 });
  }, 40000);
  it('reports saved but unverified on equal new candidates without another save or publish', async () => {
    const f = await fixture('duplicate'); await f.execution.write();
    await expect(f.execution.saveAndVerify()).rejects.toThrow('BLOG_DRAFT_SAVED_UNVERIFIED');
    expect(f.beforeSave).toHaveBeenCalledTimes(1); expect(await f.counts()).toEqual({ saves: 1, publishes: 0 });
  }, 40000);
  it.each(['existing-duplicates', 'no-response-id'])('reopens exactly the new entry with %s', async mode => {
    const f = await fixture(mode); await f.execution.write();
    await f.execution.saveAndVerify();
    expect(f.execution.draftIdentity).toEqual({ existingSameTitle: mode === 'existing-duplicates' ? 2 : 0, source: 'list-change' });
    expect(f.beforeSave).toHaveBeenCalledTimes(1);
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 });
  }, 40000);
  it.each(['blog', 'channel'])('records an acknowledged save with an unchanged list as unverified in the %s runner', async kind => {
    const f = await fixture('list-unchanged');
    f.plan.steps = [{ kind: 'text', role: 'title', text: '합성 상품' }, { kind: 'text', role: 'body', text: '합성 본문' }];
    const verification = compareDocuments(observePlan(f.plan), observePlan(f.plan));
    const preview = { productNo: 1, contentHash: 'fixture', options: {}, blog: f.plan, band: { ...f.plan, channel: 'band' }, verification: { blog: verification, band: verification } } as PreparedPreview;
    const work = { preview, prepared: { preview, files: [] }, download: async () => {}, arrange: async () => {}, cleanup: async () => {} };
    const recorded: import('../src/protocol').Job[] = [];
    const services = { host: f.host, editorUrl: f.editorUrl, localPublish: true };
    const record = async (job: import('../src/protocol').Job) => { recorded.push(structuredClone(job)); };
    const runner = kind === 'blog' ? new BlogRegistrationRunner(services, record, () => {}) : new ChannelRegistrationRunner({ blog: services, band: { host: f.host, baseUrl: new URL(f.editorUrl).origin, localPublish: true } }, record, () => {});
    cleanup.push(async () => runner.dispose());
    await runner.start({ productNo: 1, mode: 'draft', targets: [{ channel: 'blog', name: '합성', key: 'fixture' }], options: { polish: false, closing: false, linkCard: false } }, '합성 상품', 0, work);
    await vi.waitFor(() => expect(runner.job?.status, JSON.stringify({ code: runner.job?.failureCode, step: runner.job?.step })).toBe('draft_unverified'), { timeout: 15000 });
    expect(recorded.at(-1)).toMatchObject({ status: 'draft_unverified', targetResults: [{ status: 'stopped', reason: 'BLOG_DRAFT_SAVED_UNVERIFIED' }] });
    expect(runner.job?.completedSteps).not.toContain(5);
    await expect(runner.resume()).rejects.toMatchObject({ code: 'conflict' });
    const page = [...f.pages.values()].at(-1)!;
    expect(await page.evaluate('Number(localStorage.getItem("saves"))')).toBe(1);
    expect(await page.evaluate('Number(localStorage.getItem("publishes"))')).toBe(0);
    expect(await page.evaluate('document.querySelector(".se-documentTitle p").textContent')).toBe('');
  }, 20000);
  it('requires consent for auto-recovery, preserves the prompt on refusal, then continues only after consent', async () => {
    const f = await fixture('restore'); await expect(f.execution.write()).rejects.toThrow('AUTO_RECOVER_CONSENT_REQUIRED');
    await expect(f.execution.write()).rejects.toThrow('AUTO_RECOVER_CONSENT_REQUIRED');
    expect(await f.counts()).toEqual({ saves: 0, publishes: 0 });
    f.execution.consentToDiscard(); await f.execution.write();
    expect(f.external()).toBe(0);
  }, 40000);
  it('continues a matching text prefix and restarts a changed composition using a fresh editor', async () => {
    const f = await fixture();
    f.plan.steps = [{ kind: 'text', role: 'title', text: '[골투오토 실험] WP5 이어하기' }, { kind: 'break' }, { kind: 'text', role: 'body', text: '이어 쓸 소개 문장입니다. '.repeat(8) }, { kind: 'break' }];
    let stopped = false;
    f.progress.mockImplementation(value => { if (!stopped && value.characters > 55) { stopped = true; f.check.mockImplementation(() => { throw Error('TEST_LOGIN_DROP'); }); } });
    await expect(f.execution.write()).rejects.toThrow('TEST_LOGIN_DROP');
    const old = f.execution.surface;
    f.check.mockImplementation(() => {}); await f.execution.write();
    expect(f.execution.surface).toBe(old);
    expect(compareDocuments(observePlan(f.plan), blogObservation(f.plan, f.files, await readBlogDocument(old!))).matches).toBe(true);
    // A user changed the document through an actual key, so the saved prefix no longer matches.
    await old!.typeText('사용자 수정');
    await f.execution.write(); expect(f.execution.surface).not.toBe(old);
    expect(compareDocuments(observePlan(f.plan), blogObservation(f.plan, f.files, await readBlogDocument(f.execution.surface!))).matches).toBe(true);
    const resumed = f.execution.surface!;
    const open = (url: string) => resumed.open({ url, width: 1280, height: 900, session: 'naver', userAgent: 'local-fixture' });
    await open(new URL('/login', f.editorUrl).href);
    await expect(f.execution.write()).rejects.toThrow('LOGIN_OR_EDITOR_LOST');
    // Simulate the user's return from a local login page, without typing credentials.
    await open(f.editorUrl); await f.execution.write();
    expect(compareDocuments(observePlan(f.plan), blogObservation(f.plan, f.files, await readBlogDocument(f.execution.surface!))).matches).toBe(true);
  }, 30000);
  it('forwards a native JS confirm and resolves an ambiguous save only after an explicit answer', async () => {
    const f = await fixture('dialog');
    f.plan.steps = [{ kind: 'text', role: 'title', text: '[골투오토 실험] WP5 확인창' }, { kind: 'break' }, { kind: 'text', role: 'body', text: '확인창 시험 본문' }];
    await f.execution.write();
    await expect(f.execution.saveAndVerify()).rejects.toThrow('USER_DIALOG_REQUIRED');
    const dialog = await f.execution.dialog(); expect(dialog).toMatchObject({ kind: 'confirm', message: '로컬 저장 확인' });
    expect(f.beforeSave).toHaveBeenCalledTimes(1);
    await f.execution.answerDialog(dialog!.id, false); await f.execution.saveAndVerify();
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 });
  }, 30000);
  it('runs the real registration stages, keeps a stopped editor, and records completion only after fresh verification', async () => {
    const f = await fixture();
    f.plan.steps = [{ kind: 'text', role: 'title', text: '[골투오토 실험] WP5 통합' }, { kind: 'break' }, { kind: 'text', role: 'body', text: '통합 흐름의 예시 본문입니다. '.repeat(4) }];
    const verification = compareDocuments(observePlan(f.plan), observePlan(f.plan));
    const preview: PreparedPreview = { productNo: 1, contentHash: 'fixture', droppedStruckCharacters: 0, options: {}, blog: f.plan, band: { ...f.plan, channel: 'band' }, verification: { blog: verification, band: verification } };
    let cleaned = 0, downloaded = 0;
    const work = { preview, prepared: { preview, files: [] }, download: async () => { downloaded++; }, arrange: async () => {}, cleanup: async () => { cleaned++; } };
    const states: import('../src/protocol').Job[] = [];
    const runner = new BlogRegistrationRunner({ host: f.host, editorUrl: f.editorUrl, localPublish: true }, async job => { states.push(job); }, () => {});
    const input = { productNo: 1, mode: 'draft' as const, targets: [{ channel: 'blog' as const, name: '로컬', key: 'local' }], options: { polish: false, closing: false, linkCard: false } };
    await runner.start(input, '[골투오토 실험] WP5 통합', 0, work);
    await new Promise(resolve => setTimeout(resolve, 300)); await runner.stop();
    expect(runner.job?.status).toBe('user_paused');
    expect([...f.pages.values()].filter(p => !p.isClosed())).toHaveLength(1);
    await runner.resume();
    for (let i = 0; i < 200 && runner.job?.status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 50));
    expect(runner.job?.status).toBe('draft_saved'); expect(downloaded).toBe(1); expect(cleaned).toBe(1);
    expect([...f.pages.values()].every(p => p.isClosed())).toBe(true);
    expect(states.filter(j => j.completedSteps.includes(5)).every(j => j.completedSteps.includes(4))).toBe(true);
    await expect(runner.start({ ...input, targets: [...input.targets, { channel: 'band', name: '금지', key: 'band' }] }, '예시', 0, work)).rejects.toMatchObject({ code: 'invalid' });
    runner.dispose();
  }, 30000);
});

describe('WP5 real-service safety boundary', () => {
  it('rejects real publication, non-experiment titles and Band before opening a surface', async () => {
    const create = vi.fn();
    const host: SurfaceHost = { create, destroy: async () => {}, clearSession: async () => {} };
    const runner = new BlogRegistrationRunner({ host }, async () => {}, () => {});
    const input = { productNo: 1, mode: 'draft' as const, targets: [{ channel: 'blog' as const, name: '예시', key: 'sample' }], options: { polish: false, closing: false, linkCard: false } };
    const work = { download: async () => {}, arrange: async () => {}, cleanup: async () => {} };
    await expect(runner.start({ ...input, mode: 'publish', publishConfirmed: true }, '[골투오토 실험] 안전', 0, work)).rejects.toMatchObject({ code: 'invalid' });
    await expect(runner.start(input, '접두사 없는 제목', 0, work)).rejects.toMatchObject({ code: 'invalid' });
    await expect(runner.start({ ...input, targets: [{ channel: 'band', name: '금지', key: 'band' }] }, '[골투오토 실험] 안전', 0, work)).rejects.toMatchObject({ code: 'invalid' });
    expect(create).not.toHaveBeenCalled();
    expect(() => new BlogRegistrationRunner({ host, localPublish: true, editorUrl: 'https://blog.naver.com/' }, async () => {}, () => {})).toThrow('LOCAL_EDITOR_REQUIRED');
    runner.dispose();
  });
});


const richRuns = [
  { text: '앞  ' },
  { text: '강조 한글 한 👨‍👩‍👧‍👦 ', bold: true },
  { text: '문의😀', bold: true, href: 'https://example.invalid/ask?q=1&x=2#here' },
  { text: ' 끝 ' },
  { text: '예약', href: 'https://example.invalid/reserve/' },
];
function richPlan(f: Awaited<ReturnType<typeof fixture>>, runs = richRuns) {
  f.plan.steps = [{ kind: 'text', role: 'title', text: '합성 서식 제목' }, { kind: 'break' },
    { kind: 'text', role: 'body', text: runs.map(r => r.text).join(''), runs }];
}
describe('WP18 mandatory rich-text editor fixture', () => {
  it.each(['', 'link-end-stuck'])('types exact bold/link ranges with Hangul, joined emoji and spaces, then verifies before/after save and fresh reopen (%s)', async mode => {
    const f = await fixture(mode); richPlan(f);
    await f.execution.write();
    const typed = await readBlogDocument(f.execution.surface!);
    expect(compareBlogFormatting(f.plan, typed)).toEqual([]);
    expect(typed.tokens).toEqual([{ kind: 'text', text: richRuns.map(r => r.text).join(''), runs: normalizeBlogRuns(richRuns) }]);
    const live = f.progress.mock.calls.map(([v]) => v.blogParagraph).filter(Boolean);
    expect(live.some(p => p.runs.some((r: { href?: string }) => r.href))).toBe(true);
    expect(live[0].runs.every((r: { href?: string }) => !r.href)).toBe(true);
    const old = f.execution.surface;
    await f.execution.saveAndVerify();
    expect(f.execution.surface).not.toBe(old);
    expect(await readBlogDocument(f.execution.surface!)).toEqual(typed);
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 });
    expect(f.beforeSave).toHaveBeenCalledTimes(1); expect(f.external()).toBe(0);
  }, 30000);
  it.each(['bold-stuck', 'link-cancelled', 'link-broken', 'link-collapse-stuck'])('stops %s with the affected paragraph and no save or publication', async mode => {
    const f = await fixture(mode); richPlan(f);
    await expect(f.execution.write()).rejects.toMatchObject({ message: 'BLOG_FORMATTING_INPUT:1', issues: [{ paragraph: 1, fields: ['input'] }] });
    expect(await f.counts()).toEqual({ saves: 0, publishes: 0 }); expect(f.external()).toBe(0);
    await expect(f.execution.saveAndVerify()).rejects.toBeInstanceOf(BlogFormattingError);
    expect(f.beforeSave).not.toHaveBeenCalled();
  }, 20000);
  it('resumes an acknowledged partial bold run without typing the prefix again, including multiline links and emoji boundaries', async () => {
    const f = await fixture();
    const runs = [{ text: '가'.repeat(31) + '✈️' + '한글 '.repeat(28), bold: true },
      { text: '\n다음 👩🏽‍💻 문의', href: 'https://example.invalid/next' }];
    richPlan(f, runs);
    let paused = false;
    f.progress.mockImplementation(value => {
      if (!paused && value.blogParagraph?.runs.map((r: {text: string}) => r.text).join('').length > 36) {
        paused = true; f.check.mockImplementation(() => { throw Error('TEST_LOGIN_DROP'); });
      }
    });
    await expect(f.execution.write()).rejects.toThrow('TEST_LOGIN_DROP');
    const old = f.execution.surface;
    f.check.mockImplementation(() => {}); await f.execution.write();
    expect(f.execution.surface).toBe(old);
    expect(compareBlogFormatting(f.plan, await readBlogDocument(old!))).toEqual([]);
    expect(f.progress.mock.calls.at(-1)![0].characters).toBe(f.plan.steps.reduce((n,s)=>n+(s.kind==='text'?Array.from(s.text).length:0),0));
    await f.execution.saveAndVerify();
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 }); expect(f.external()).toBe(0);
  }, 30000);
  it('requires recovery consent when a partially written rich paragraph is changed by real keyboard input', async () => {
    const f = await fixture(); richPlan(f, [{ text: '강조 '.repeat(40), bold: true }]);
    let paused = false;
    f.progress.mockImplementation(v => { if (!paused && v.blogParagraph) { paused = true; f.check.mockImplementation(() => { throw Error('TEST_LOGIN_DROP'); }); } });
    await expect(f.execution.write()).rejects.toThrow('TEST_LOGIN_DROP');
    f.check.mockImplementation(() => {}); const old = f.execution.surface!;
    await old.typeText('수정');
    await expect(f.execution.write()).rejects.toThrow('AUTO_RECOVER_CONSENT_REQUIRED');
    expect(f.execution.surface).toBe(old);
    f.execution.consentToDiscard(); await f.execution.write();
    expect(f.execution.surface).not.toBe(old);
    expect(compareBlogFormatting(f.plan, await f.execution.observe())).toEqual([]);
    expect(await f.counts()).toEqual({ saves: 0, publishes: 0 });
  }, 30000);
  it('refuses an unconfirmed keyboard selection without opening the link dialog or saving', async () => {
    const f = await fixture(); richPlan(f, [{ text: '한글😀 문의', href: 'https://example.invalid/link' }]);
    await f.execution.ensureReady(); const s = f.execution.surface!, press = s.pressKey.bind(s);
    s.pressKey = async key => { if (key.key === 'ArrowLeft' && key.modifiers === 8) return; await press(key); };
    await expect(f.execution.write()).rejects.toThrow('BLOG_FORMATTING_INPUT:1');
    expect(await f.pages.get(s)!.locator('.se-custom-layer-option-link').count()).toBe(0);
    expect(await f.counts()).toEqual({ saves: 0, publishes: 0 });
  }, 20000);
  it('reconciles an already confirmed link on resume without inserting or linking it twice', async () => {
    const f = await fixture(); richPlan(f); let paused = false;
    f.progress.mockImplementation(v => {
      if (!paused && v.blogParagraph?.runs.some((r: { href?: string }) => r.href)) {
        paused = true; f.check.mockImplementation(() => { throw Error('TEST_LOGIN_DROP'); });
      }
    });
    await expect(f.execution.write()).rejects.toThrow('TEST_LOGIN_DROP');
    const old = f.execution.surface!;
    f.check.mockImplementation(() => {}); await f.execution.write();
    expect(f.execution.surface).toBe(old);
    expect(await f.pages.get(old)!.evaluate('window.linkDialogOpens')).toBe(2);
    expect(compareBlogFormatting(f.plan, await f.execution.observe())).toEqual([]);
    expect(await f.counts()).toEqual({ saves: 0, publishes: 0 });
  }, 20000);
  it('keeps uncertain partial transport input until recovery consent instead of retyping it', async () => {
    const f = await fixture(); richPlan(f, [{ text: '부분 입력 한글😀 '.repeat(8), bold: true }]);
    await f.execution.ensureReady(); const old = f.execution.surface!, type = old.typeText.bind(old);
    let partial = false;
    old.typeText = async text => {
      if (!partial && text.startsWith('부분')) { partial = true; await type('부분'); throw Error('TEST_INPUT_TRANSPORT'); }
      await type(text);
    };
    await expect(f.execution.write()).rejects.toThrow('TEST_INPUT_TRANSPORT');
    await expect(f.execution.write()).rejects.toThrow('AUTO_RECOVER_CONSENT_REQUIRED');
    expect(f.execution.surface).toBe(old);
    expect((await readBlogDocument(old)).tokens).toEqual([{ kind: 'text', text: '부분', runs: normalizeBlogRuns([{ text: '부분', bold: true }]) }]);
    f.execution.consentToDiscard(); await f.execution.write();
    expect(f.execution.surface).not.toBe(old);
    expect(compareBlogFormatting(f.plan, await f.execution.observe())).toEqual([]);
    expect(await f.counts()).toEqual({ saves: 0, publishes: 0 });
  }, 20000);
  it('reports the second paragraph when its toolbar state cannot be changed', async () => {
    const f = await fixture('bold-stuck'); richPlan(f, [{ text: '첫째' }]);
    f.plan.steps.push({ kind: 'break' }, { kind: 'text', role: 'body', text: '둘째', runs: [{ text: '둘째', bold: true }] });
    await expect(f.execution.write()).rejects.toThrow('BLOG_FORMATTING_INPUT:2');
    expect(await f.counts()).toEqual({ saves: 0, publishes: 0 });
  }, 15000);
  it('stops a resume inside a partial link dialog without sending keys to it or duplicating body text', async () => {
    const f = await fixture(); richPlan(f, [{ text: '문의', href: 'https://example.invalid/' + 'a'.repeat(60) }]);
    await f.execution.ensureReady(); const s = f.execution.surface!, type = s.typeText.bind(s);
    let partial = false;
    s.typeText = async text => {
      await type(text);
      if (!partial && text.startsWith('https://')) { partial = true; f.check.mockImplementation(() => { throw Error('TEST_LOGIN_DROP'); }); }
    };
    await expect(f.execution.write()).rejects.toThrow('TEST_LOGIN_DROP');
    f.check.mockImplementation(() => {});
    const press = vi.spyOn(s, 'pressKey');
    await expect(f.execution.write()).rejects.toThrow('BLOG_FORMATTING_INPUT:1');
    expect(press).not.toHaveBeenCalled();
    const page = f.pages.get(s)!;
    expect(await page.evaluate('window.linkDialogOpens')).toBe(1);
    expect((await readBlogDocument(s)).tokens[0]).toMatchObject({ text: '문의' });
    await page.locator('.se-popup-button-cancel').click();
    await f.execution.write();
    expect(compareBlogFormatting(f.plan, await f.execution.observe())).toEqual([]);
    expect(await f.counts()).toEqual({ saves: 0, publishes: 0 });
  }, 20000);
  it.each(['format-drop-after-save', 'format-drop-reopen'])('detects %s, cannot publish, and does not save a second time', async mode => {
    const f = await fixture(mode); richPlan(f); await f.execution.write();
    const stage = mode === 'format-drop-after-save' ? 'AFTER_SAVE' : 'REOPENED';
    await expect(f.execution.saveAndVerify()).rejects.toMatchObject({ message: `BLOG_FORMATTING_${stage}:1`, issues: [{ paragraph: 1, fields: ['bold', 'href'] }] });
    await expect(f.execution.publish()).rejects.toThrow('REAL_PUBLISH_DISABLED');
    await expect(f.execution.saveAndVerify()).rejects.toBeInstanceOf(BlogFormattingError);
    expect(f.beforeSave).toHaveBeenCalledTimes(1);
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 }); expect(f.external()).toBe(0);
  }, 30000);
  it.each(['blog', 'channel'])('retains a saved draft after body mismatch in the %s runner without offering another save', async kind => {
    const f = await fixture('body-change-after-save');
    f.plan.steps = [{kind:'text',role:'title',text:'합성 제목'},{kind:'text',role:'body',text:'합성 본문'}];
    const verification = compareDocuments(observePlan(f.plan), observePlan(f.plan));
    const preview = {productNo:1,contentHash:'fixture',options:{},blog:f.plan,band:{...f.plan,channel:'band'},verification:{blog:verification,band:verification}} as PreparedPreview;
    const work = {preview,prepared:{preview,files:[]},download:async()=>{},arrange:async()=>{},cleanup:async()=>{}};
    const services = {host:f.host,editorUrl:f.editorUrl,localPublish:true};
    const runner = kind==='blog'?new BlogRegistrationRunner(services,async()=>{},()=>{}):new ChannelRegistrationRunner({blog:services,band:{host:f.host}},async()=>{},()=>{});
    cleanup.push(async()=>runner.dispose());
    await runner.start({productNo:1,mode:'draft',targets:[{channel:'blog',name:'합성',key:'fixture'}],options:{polish:false,closing:false,linkCard:false}},'합성 제목',0,work);
    await vi.waitFor(()=>expect(runner.job?.status).toBe('failed'),{timeout:20000});
    expect(runner.job).toMatchObject({creationState:'draft_saved',failureCode:'BLOG_SAVED_READBACK_MISMATCH',readbackIssues:expect.arrayContaining([{field:'text'}])});
    await expect(runner.resume()).rejects.toMatchObject({code:'conflict'});
    expect(await f.counts([...f.pages.keys()].at(-1)!)).toEqual({saves:1,publishes:0});
    expect(f.external()).toBe(0);
  },30000);
  it.each(['blog', 'channel'])('records paragraph-only formatting loss as 확인 필요 in the %s runner', async kind => {
    const f = await fixture('format-drop-reopen'); richPlan(f);
    const verification = compareDocuments(observePlan(f.plan), observePlan(f.plan));
    const preview = { productNo: 1, contentHash: 'fixture', options: {}, blog: f.plan, band: { ...f.plan, channel: 'band' }, verification: { blog: verification, band: verification } } as PreparedPreview;
    const work = { preview, prepared: { preview, files: [] }, download: async () => {}, arrange: async () => {}, cleanup: async () => {} };
    const record = vi.fn(async () => {}), services = { host: f.host, editorUrl: f.editorUrl, localPublish: true };
    const runner = kind === 'blog' ? new BlogRegistrationRunner(services, record, () => {}) : new ChannelRegistrationRunner({ blog: services, band: { host: f.host } }, record, () => {});
    cleanup.push(async () => runner.dispose());
    await runner.start({ productNo: 1, mode: 'draft', targets: [{ channel: 'blog', name: '합성', key: 'fixture' }], options: { polish: false, closing: false, linkCard: false } }, '합성 서식 제목', 0, work);
    await vi.waitFor(() => expect(runner.job?.status, JSON.stringify({ code: runner.job?.failureCode, step: runner.job?.step })).toBe('draft_unverified'), { timeout: 20000 });
    expect(runner.job).toMatchObject({ failureCode: 'BLOG_FORMATTING_REOPENED:1', blogFormattingIssues: [{ paragraph: 1, fields: ['bold', 'href'] }], targetResults: [{ status: 'stopped', reason: 'BLOG_FORMATTING_REOPENED:1' }] });
    expect(runner.job!.completedSteps).not.toContain(5);
    await expect(runner.resume()).rejects.toMatchObject({ code: 'conflict' });
    expect([...f.pages.keys()].every(s => s.session === 'naver')).toBe(true);
    expect(await f.counts([...f.pages.keys()].at(-1)!)).toEqual({ saves: 1, publishes: 0 });
  }, 30000);
});

describe('WP20 real editor fixture log trail', () => {
  it.each(['blog_draft'] as const)('records ordered %s input, save/reopen and terminal with no external request', async kind => {
    const f = await fixture();
    f.plan.steps = [{ kind: 'text', role: 'title', text: '합성 로그 제목' }, { kind: 'text', role: 'body', text: '합성 본문' }];
    const steps = ['sites.naver-blog.plan.BlogExecution.write', 'sites.naver-blog.plan.BlogExecution.saveAndVerify', ...([] as string[])];
    await loggedFixture(path.dirname(f.files[0]!.path), kind, async () => { await f.execution.write(); await f.execution.saveAndVerify(); }, steps);
    expect(f.external()).toBe(0);
  }, 60000);
});

describe('WP20 blog runner boundary fault injection with the real fake editor', () => {
  it.each(runnerLogSteps)('ends one failed job when %s fails before its action', async failAt => {
    const f = await fixture();
    const plan: InputPlan = { channel: 'blog', discarded: [], notices: [], steps: [{ kind: 'text', role: 'title', text: '합성 로그 제목' }, { kind: 'text', role: 'body', text: '합성 본문' }] };
    const verification = compareDocuments(observePlan(plan), observePlan(plan));
    const preview: PreparedPreview = { productNo: 1, contentHash: 'fixture', droppedStruckCharacters: 0, options: {}, blog: plan, band: { ...plan, channel: 'band' }, verification: { blog: verification, band: verification } };
    const work = { preview, prepared: { preview, files: [] }, download: async () => {}, arrange: async () => {}, cleanup: async () => {} };
    const log = faultedLog(path.dirname(f.files[0]!.path), failAt);
    const runner = new BlogRegistrationRunner({ host: f.host, editorUrl: f.editorUrl, localPublish: true }, async () => {}, () => {});
    try {
      await runner.start({ productNo: 1, mode: 'draft', targets: [{ channel: 'blog', key: 'synthetic', name: '합성' }], options: { polish: false, closing: false, linkCard: false } }, '합성 로그 제목', 0, work);
      await vi.waitFor(() => expect(log.store.list()[0]?.result).toBe('failed'), { timeout: 30000 });
      expect(log.injected()).toBe(true); expect(log.store.list()).toHaveLength(1); expect(f.external()).toBe(0);
    } finally { runner.dispose(); log.reset(); }
  }, 40000);
});


describe.runIf(Boolean(executablePath))('WP29 real table input',()=>{
  it('resizes the observed 3x3 by controls, preserves rich cells and surrounding photo/text order through a fresh draft',async()=>{
    const f=await fixture('table-popup-move',{photos:2});
    const cells=[['가','굵게 문의'],['','두 줄\n다음'],['끝','값']];
    const cellRuns=[[[{text:'가'}],[{text:'굵게',bold:true},{text:' 문의',href:'https://example.invalid/a%2Fb?x=1&y=2'}]],[[],[{text:'두 줄\n다음'}]],[[{text:'끝'}],[{text:'값'}]]];
    f.plan.steps=[{kind:'text',role:'title',text:'합성 표'},{kind:'text',role:'body',text:'앞'},{kind:'break'},{kind:'photos',urls:[f.files[0]!.url]},{kind:'table',role:'body',rows:cells,cellRuns},{kind:'break'},{kind:'text',role:'body',text:'뒤'},{kind:'break'},{kind:'photos',urls:[f.files[1]!.url]}];
    await f.execution.write();expect(f.execution.tableModes).toEqual(['native']);
    const actual=await f.execution.saveAndVerify();
    expect(actual.tokens.map(t=>t.kind)).toEqual(['text','photo','table','text','photo']);
    expect(actual.tokens[2]).toMatchObject({kind:'table',rows:cells});
    expect(compareBlogFormatting(f.plan,actual)).toEqual([]);
    expect(await f.counts()).toEqual({saves:1,publishes:0});expect(f.external()).toBe(0);
  },45000);
  it('re-reads a newly inserted table that moves on hover, without sending a misplaced cell press',async()=>{
    const f=await fixture('table-moving');f.plan.steps=[{kind:'text',role:'title',text:'합성 이동 표'},{kind:'text',role:'body',text:'앞'},{kind:'break'},{kind:'table',role:'body',rows:[['a','b'],['c','d'],['e','f']]},{kind:'break'},{kind:'text',role:'body',text:'뒤'}];
    await f.execution.write();expect(await f.pages.get(f.execution.surface!)!.evaluate('window.tableMovedOnHover')).toBe(true);
    expect(f.execution.tableModes).toEqual(['native']);expect((await f.execution.saveAndVerify()).tokens).toContainEqual(expect.objectContaining({kind:'table',rows:[['a','b'],['c','d'],['e','f']]}));
    expect(await f.counts()).toEqual({saves:1,publishes:0});
  },35000);
  it('grows columns and shrinks rows without padding or adding a heading',async()=>{
    const f=await fixture('table-real');f.plan.steps=[{kind:'text',role:'title',text:'합성 크기'},{kind:'table',role:'body',rows:[['a','b','c','d']]}];
    await f.execution.write();expect(f.execution.tableModes).toEqual(['native']);
    expect((await f.execution.saveAndVerify()).tokens).toContainEqual(expect.objectContaining({kind:'table',rows:[['a','b','c','d']]}));
  },30000);
  it.each(['fallback','bad-table','table-cell-drop'])('removes only the new component and records visible %s fallback before saving exact text lines',async mode=>{
    const f=await fixture(mode);f.plan.steps=[{kind:'text',role:'title',text:'합성 폴백'},{kind:'text',role:'body',text:'앞'},{kind:'break'},{kind:'table',role:'body',rows:[['a','b'],['c','d']]},{kind:'break'},{kind:'text',role:'body',text:'뒤'}];
    const log=await loggedFixture(path.dirname(f.files[0]!.path),'blog_draft',async()=>{await f.execution.write();return f.execution.saveAndVerify();},['table_insert_started']);
    expect(f.execution.tableModes).toEqual(['text-list']);expect(log.result.tokens.map(t=>t.kind)).toEqual(['text','text','text','text']);
    expect(log.result.tokens.filter(t=>t.kind==='text').map(t=>t.text)).toEqual(['앞','a | b','c | d','뒤']);
    expect(log.lines.filter(l=>l.step==='table_fallback')).toEqual([expect.objectContaining({reason:mode==='fallback'?'TABLE_TOOL_MISSING':mode==='bad-table'?'TABLE_SIZE_MISMATCH':'TABLE_CELL_MISMATCH'})]);
    expect(await f.counts()).toEqual({saves:1,publishes:0});
  },35000);
  it('restores a native empty paragraph after removing a table that consumed the photo append anchor',async()=>{
    const f=await fixture('bad-table-remove-anchor',{photos:1});f.plan.steps=[{kind:'text',role:'title',text:'합성 사진 뒤 폴백'},{kind:'photos',urls:[f.files[0]!.url]},{kind:'table',role:'body',rows:[['a','b'],['c','d']]},{kind:'break'},{kind:'text',role:'body',text:'뒤'}];
    await f.execution.write();expect(f.execution.tableModes).toEqual(['text-list']);const actual=await f.execution.saveAndVerify();
    expect(actual.tokens.map(t=>t.kind)).toEqual(['photo','text','text','text']);expect(actual.tokens.filter(t=>t.kind==='text').map(t=>t.text)).toEqual(['a | b','c | d','뒤']);
    expect(await f.counts()).toEqual({saves:1,publishes:0});
  },35000);
  it('preserves multiline cells, bold and links when the recorded fallback uses text paragraphs',async()=>{
    const f=await fixture('fallback');const cellRuns=[[[{text:'a\nx'}],[{text:'굵게',bold:true},{text:' 문의',href:'https://example.invalid/cell'}]],[[],[{text:'d'}]]];
    f.plan.steps=[{kind:'text',role:'title',text:'합성 여러 줄 폴백'},{kind:'table',role:'body',rows:[['a\nx','굵게 문의'],['','d']],cellRuns}];
    await f.execution.write();const actual=await f.execution.saveAndVerify();expect(f.execution.tableModes).toEqual(['text-list']);
    expect(actual.tokens.filter(t=>t.kind==='text').map(t=>t.text)).toEqual(['a','x | 굵게 문의',' | d']);
    expect(compareBlogFormatting(f.plan,actual,f.execution.tableModes)).toEqual([]);expect(await f.counts()).toEqual({saves:1,publishes:0});
  },30000);
  it('refuses every save if removal of its half-created table cannot be confirmed',async()=>{
    const f=await fixture('table-cleanup-failed');f.plan.steps=[{kind:'text',role:'title',text:'합성 제거 실패'},{kind:'table',role:'body',rows:[['a','b']]}];
    await expect(f.execution.write()).rejects.toThrow();expect(f.execution.tableModes).toEqual([]);
    expect(f.beforeSave).not.toHaveBeenCalled();expect(await f.counts()).toEqual({saves:0,publishes:0});
  },25000);
});
