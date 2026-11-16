import { afterEach, expect, it, vi } from 'vitest';
import { chromium, type Page } from 'playwright-core';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CdpSurface, type CdpConnection } from '@goltou/surface/cdp';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { configureTrace, reasonCode, trace } from '@goltou/surface/telemetry';
import { bandFixture } from '../../sites/test/band-fixture';
import { ChannelRegistrationRunner } from '../src/band-runner';
import { JobLogStore } from '../src/job-logs';
import { compareDocuments, observePlan } from '../src/verify';
import type { InputPlan } from '../src/convert';
import type { Job } from '../src/protocol';
import { png } from './image-fixture';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { configureTrace(undefined); for (const close of cleanup.splice(0).reverse()) await close(); });
const create = 'https://api-kr.band.us/v2.0.2/create_post';
const feed = 'https://api-kr.band.us/v2.0.0/get_posts_and_announcements?band_no=111';
const url = 'https://band.us/band/111/post/9001';
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fixture(mode: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'goltou-wp21-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const files = Array.from({ length: mode === 'identity-held' ? 29 : 5 }, (_, i) => ({ url: `https://example.invalid/source/${i}.png`, path: path.join(dir, `goltou-1234567890abcdef-${i}.png`) }));
  for (const file of files) await writeFile(file.path, png(160, 90));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-background-networking', '--no-first-run'] });
  cleanup.push(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let creates = 0, feedReads = 0, detailReads = 0, forbidden = 0, createdAt = 0, body = '', photos: string[] = [];
  let releaseDetail!: () => void;
  const heldDetail = new Promise<void>(resolve => { releaseDetail = resolve; });
  let hold = mode === 'identity-held';
  const composer = bandFixture('mobile-service').replace(
    "fetch('/band-post-create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(mode==='post-blocked'?{}:{band_key:location.pathname.split('/')[2]})})",
    `fetch(${JSON.stringify(create)},{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({band_no:'111',content:text(),photo:JSON.stringify(Array.from(view.querySelectorAll('img')).map(n=>n.src))})})`,
  ).replace("location.href=location.pathname.replace(/\\/$/,'')+'/'+(1000+Number(localStorage.getItem('posts')));", "location.href='/band/111/post';")
    .replace('</script>', `if(location.pathname==='/band/111/post')fetch(${JSON.stringify(feed)});</script>`);
  await context.route('**/*', async route => {
    const request = route.request(), u = new URL(request.url());
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': '*' } });
    if (!['band.us', 'www.band.us', 'api-kr.band.us', 'bapi-kr.band.us'].includes(u.hostname)) { forbidden++; return route.abort(); }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,GET,OPTIONS', 'access-control-allow-headers': 'content-type' } });
    if (u.pathname === '/v2.0.2/create_post') {
      creates++; createdAt = Date.now(); const form = new URLSearchParams(request.postData() ?? ''); body = form.get('content') ?? ''; photos = JSON.parse(form.get('photo') ?? '[]');
      return json({ result_code: mode === 'rejected' ? 0 : 1, result_data: mode.startsWith('identity') || mode === 'mismatch' ? { post_no: 9001 } : {} });
    }
    if (u.pathname === '/v2.0.0/get_posts_and_announcements') {
      feedReads++;
      const visible = creates && mode !== 'not-found' && (mode !== 'delayed' || Date.now() - createdAt > 1300);
      return json({ result_code: 1, result_data: { items: visible ? [{ post: { post_no: 9001, band: { band_no: 111 }, web_url: url, content: body.replace(/\n\n/g, '\n'), created_at: createdAt, author: { me: true }, photo_count: Math.min(10, photos.length),
        attachment: { photo: photos.slice(0, 10).map(photo_url => ({ photo_url, width: 160, height: 90 })) } } }] : [] } });
    }
    if (u.pathname === '/v2.0.0/batch') { detailReads++; return json({ result_code: 1 }); }
    if (u.pathname.startsWith('/photos/')) return route.fulfill({ status: 200, contentType: 'image/png', body: png(160, 90) });
    if (/\/post\/9001$/.test(u.pathname)) {
      if (hold) await heldDetail;
      const text = escapeHtml(mode === 'mismatch' ? body + '변경' : body).replace(/#합성|#태그/g, '<button class="hashTag">$&</button>').replace(/https:\/\/example.invalid\/[ab]/g, '<a href="$&">$&</a>');
      const root = mode === 'delayed' ? '<div class="postWrap -postDetailPage"><div class="cContentsCard"><div class="postBody"><div class="dPostTextView"><div class="postText">' : '<div class="postsDetailArea"><div class="_contentListRegion"><div class="postTextBox"><div class="postText _postTxt">';
      const postHtml = root + text + '</div></div>' + photos.map(src => `<img class="mediaImg" src="${src}">`).join('') + '</div></div>';
      const payload = [{ svc_id: 'synthetic', method: 'GET', path: '/v2.0.0/get_post?band_no=111&post_no=9001&resolution_type=synthetic&token=synthetic' }, { svc_id: 'synthetic', method: 'GET', path: '/v2.0.0/get_emotions?band_no=111&post_no=9001&content_key=synthetic&token=synthetic' }];
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<meta charset="utf-8"><style>.postText{white-space:pre-wrap}</style><div id="root"></div><script>fetch('https://bapi-kr.band.us/v2.0.0/batch',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({payload:${JSON.stringify(JSON.stringify(payload))}})}).then(r=>{if(r.ok)document.querySelector('#root').innerHTML=${JSON.stringify(postHtml)}})</script>` });
    }
    if (request.method() !== 'GET') { forbidden++; return route.abort(); }
    return route.fulfill({ status: 200, contentType: 'text/html', body: composer });
  });
  const pages = new Map<Surface, Page>();
  const host: SurfaceHost = {
    async create(session) {
      const page = await context.newPage(), cdp = await context.newCDPSession(page);
      const shim = { send: async (method: string, params: object) => {
        const result = await cdp.send(method as never, params as never) as { exceptionDetails?: unknown };
        if (result.exceptionDetails) throw Error('FIXTURE_READ_FAILED'); return result;
      }, on: (method: string, listener: (p: Record<string, unknown>) => void) => { cdp.on(method as never, listener); return () => cdp.off(method as never, listener); }, close: () => { void cdp.detach().catch(() => {}); }, isOpen: true };
      const surface = new CdpSurface(session, shim as unknown as CdpConnection, { setVisible: async () => {}, close: async () => page.close() }, 0);
      pages.set(surface, page); return surface;
    }, destroy: async s => s.close(), clearSession: async () => { throw Error('NO_CLEAR'); },
  };
  const store = new JobLogStore(path.join(dir, 'logs')); configureTrace(store);
  const checkpoints: Job[] = [];
  const runner = new ChannelRegistrationRunner({ band: { host, publishEnabled: true, recordBarrierDecision: (code, expected) => trace('barrier', expected ? 'blocked_expected' : 'ok', { reason: reasonCode(code) }) } }, async j => { checkpoints.push(structuredClone(j)); }, () => {});
  cleanup.push(async () => runner.dispose()); await runner.listBands();
  const plan: InputPlan = { channel: 'band', discarded: [], notices: [], steps: [
    { kind: 'text', role: 'title', text: '합성 제목' }, { kind: 'text', role: 'body', text: '첫 줄\n둘째 줄\n셋째 줄' },
    { kind: 'text', role: 'body', text: '#합성 #태그 https://example.invalid/a https://example.invalid/b' }, { kind: 'photos', urls: files.map(f => f.url) },
  ] };
  const verification = compareDocuments(observePlan(plan), observePlan(plan));
  const preview = { productNo: 1, contentHash: 'synthetic', droppedStruckCharacters: 0, options: {}, band: plan, blog: { ...plan, channel: 'blog' as const }, verification: { band: verification, blog: verification } };
  const work = { preview, prepared: { preview, files }, download: vi.fn(async () => {}), arrange: vi.fn(async () => {}), cleanup: vi.fn(async () => {}) };
  return { runner, checkpoints, store, work, counts: () => ({ creates, feedReads, detailReads, forbidden }), release: () => { hold = false; releaseDetail(); },
    lines: async () => { const date = (await readdir(store.directory)).find(n => /^\d{8}$/.test(n))!; const file = (await readdir(path.join(store.directory, date))).find(n => n.includes('band_post'))!; return (await readFile(path.join(store.directory, date, file), 'utf8')).trim().split('\n').map(s => JSON.parse(s)); } };
}

it.each(['identity-held', 'no-identity', 'delayed', 'rejected', 'mismatch', 'not-found'])('replays the full production Band job offline: %s', async mode => {
  const f = await fixture(mode);
  await f.runner.start({ productNo: 1, mode: 'publish', publishConfirmed: true, targets: [{ channel: 'band', key: '111', name: '합성' }], options: { polish: false, closing: false, linkCard: false } }, '합성 제목', 29, f.work);
  if (mode === 'identity-held') {
    try {
      await vi.waitFor(() => expect(f.checkpoints.some(j => j.status === 'running' && j.targetResults?.[0]?.postUrl === url)).toBe(true), { timeout: 120000 });
      expect(f.runner.job?.status).toBe('running');
    } finally { f.release(); }
  }
  await vi.waitFor(() => expect(f.runner.job?.status).not.toBe('running'), { timeout: 60000 });
  const success = !['rejected', 'mismatch', 'not-found'].includes(mode);
  const diagnostic = JSON.stringify({ code: f.runner.job?.failureCode, counts: f.counts(), failures: (await f.lines()).filter(l => l.event === 'fail').slice(-8) });
  expect(f.runner.job?.status, diagnostic).toBe(success ? 'published' : 'failed');
  if (!['rejected', 'not-found'].includes(mode)) expect(f.runner.job?.targetResults?.[0]?.postUrl).toBe(url);
  if (mode === 'rejected') expect(f.runner.job?.failureCode).toBe('BAND_CREATE_REJECTED');
  if (mode === 'mismatch') expect(f.runner.job?.failureCode).toBe('BAND_PUBLISHED_READBACK_MISMATCH');
  if (mode === 'not-found') expect(f.runner.job?.failureCode).toBe('BAND_POST_UNCONFIRMED:IDENTITY_NOT_FOUND');
  expect(f.counts()).toMatchObject({ creates: 1, forbidden: 0 });
  if (success) expect(f.counts().detailReads).toBeGreaterThan(0);
  await vi.waitFor(async () => expect((await f.lines()).filter(l => l.step === 'terminal')).toHaveLength(1));
  const lines = await f.lines(); expect(lines.at(-1).result).toBe(success ? 'succeeded' : mode === 'not-found' ? 'uncertain' : 'failed');
  if (success) for (const check of ['text', 'line_breaks', 'photo_order', 'hashtags', 'links']) expect(lines.some(l => l.step === 'verification' && l.check === check && l.event === 'ok')).toBe(true);
  if (mode === 'delayed') expect(lines.some(l => l.step === 'band.confirm.feed' && l.event === 'retry')).toBe(true);
  await expect(f.runner.resume()).rejects.toMatchObject({ code: 'conflict' });
}, 180000);
