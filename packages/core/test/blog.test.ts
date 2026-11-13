import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { CdpConnection, CdpSurface } from '@goltou/surface/cdp';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { readBlogDocument } from '@goltou/sites';
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
  const server = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(req.url === '/login' ? '<input type="password"><p>로컬 로그인 풀림 예시</p>' : req.url?.startsWith('/published/') ? '<h1>로컬 발행 결과</h1>' : mode === 'delayed-frame' && req.url === '/editor' ? '<script>setTimeout(()=>{const f=document.createElement("iframe");f.src="/ready-editor";document.body.append(f)},500)</script><body></body>' : blogFixture(mode)));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as { port: number }).port, editorUrl = `http://127.0.0.1:${port}/editor`;
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
  cleanup.push(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let external = 0;
  await context.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external++; return route.abort(); } return route.continue(); });
  const pages = new Map<Surface, import('playwright-core').Page>();
  const host: SurfaceHost = {
    async create() { const page = await context.newPage(); page.on('dialog', () => {}); const cdp = await connection(page); const s = new CdpSurface('naver', cdp as unknown as CdpConnection, { setVisible: async () => {}, close: async () => page.close() }, 0); pages.set(s, page); return s; },
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
  for (let i = 0; i < 5; i++) steps.push({ kind: 'text', role: 'body', text: `안내 ${i + 1} 문단입니다.` }, { kind: 'break' }, { kind: 'photos', urls: [files[i]!.url] });
  steps.push({ kind: 'table', role: 'departures', rows: [['2026-12-03', '1190000원'], ['2026-12-10', '1250000원']] }, { kind: 'break' }, { kind: 'text', role: 'courses', text: '예시CC' }, { kind: 'break' });
  if (extra.tags) steps.push({ kind: 'text', role: 'closing', text: '문의해 주세요.' }, { kind: 'break' }, { kind: 'text', role: 'linkCard', text: 'https://example.invalid/product' }, { kind: 'break' }, { kind: 'text', role: 'hashtags', text: '#골프 #예시' });
  const plan: InputPlan = { channel: 'blog', steps, discarded: [], notices: [] };
  const beforeSave = vi.fn(), check = vi.fn(), progress = vi.fn();
  const execution = createBlogExecution(plan, files, { host, editorUrl, localPublish: true }, { check, progress, beforeSave });
  return { execution, plan, files, pages, host, editorUrl, check, beforeSave, progress, external: () => external,
    counts: async (surface = execution.surface!) => pages.get(surface)!.evaluate<{ saves: number; publishes: number }>("({saves:Number(localStorage.getItem('saves')),publishes:Number(localStorage.getItem('publishes'))})") };
}
describe.runIf(Boolean(executablePath))('WP5 input and save against a loopback editor only', () => {
  it('preserves links, flattened inline elements and short text after the last seven photos with options off', async () => {
    const f = await fixture('missing-tags', { photos: 8 });
    const preview = realEnding(f.files, false);
    expect(preview.verification.blog.matches).toBe(true);
    f.plan.steps = preview.blog.steps;
    expect(f.plan.steps.slice(-3).map(s => s.kind)).toEqual(['photos', 'text', 'break']);
    await f.execution.write(); await f.execution.saveAndVerify();
    expect(f.progress).toHaveBeenLastCalledWith({ photos: 8, totalPhotos: 8, characters: 1509, totalCharacters: 1509 });
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
    await f.execution.write();
    expect((await readBlogDocument(f.execution.surface!)).tokens.filter(t => t.kind === 'photo').every(t => t.identity.endsWith('.png'))).toBe(true);
    const altered = structuredClone(await readBlogDocument(f.execution.surface!));
    const photo = altered.tokens.find(t => t.kind === 'photo');
    if (!photo || photo.kind !== 'photo') throw new Error('FIXTURE_PHOTO_REQUIRED');
    photo.identity = photo.identity.replace('1234567890abcdef', '0000000000000000');
    expect(compareDocuments(observePlan(f.plan), blogObservation(f.plan, f.files, altered)).differences.some(d => d.field === 'photos')).toBe(true);
    expect((await f.execution.observe()).tags).toEqual(['예시']);
    expect(f.progress).toHaveBeenLastCalledWith({ photos: 8, totalPhotos: 8, characters: 1512, totalCharacters: 1512 });
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
    expect(await f.counts()).toEqual({ saves: 1, publishes: 0 }); expect(f.external()).toBe(0);
    const original = f.execution.surface!;
    f.execution.surface = { readState: async () => ({ url: 'https://blog.naver.com/never-requested', title: '', loading: false }) } as Surface;
    await expect(f.execution.publish()).rejects.toThrow('REAL_PUBLISH_DISABLED');
    f.execution.surface = original;
    await f.execution.saveAndVerify(); expect(f.beforeSave).toHaveBeenCalledTimes(1);
    await expect(f.execution.publish()).resolves.toMatch(/127\.0\.0\.1.*\/published\/local$/);
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
  it('stops on duplicate exact draft titles without another save or publish', async () => {
    const f = await fixture('duplicate'); await f.execution.write();
    await expect(f.execution.saveAndVerify()).rejects.toThrow('DRAFT_IDENTITY_AMBIGUOUS');
    expect(f.beforeSave).toHaveBeenCalledTimes(1); expect(await f.counts()).toEqual({ saves: 1, publishes: 0 });
  }, 40000);
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
    const preview: PreparedPreview = { productNo: 1, contentHash: 'fixture', options: {}, blog: f.plan, band: { ...f.plan, channel: 'band' }, verification: { blog: verification, band: verification } };
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
    expect(states.filter(j => j.completedSteps.includes(5)).every(j => j.completedSteps.includes(4))).toBe(true);
    await runner.showDraft('[골투오토 실험] WP5 통합');
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
