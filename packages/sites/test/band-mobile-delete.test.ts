import { loggedFixture } from '../../core/test/log-fixture';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import type { Surface, SurfaceHost, GuardedRequest, GuardedResponse } from '@goltou/surface';
import { deleteMobileRecordedBandPost } from '../src/band/mobile-delete';
let browser: Browser;
afterEach(async () => { await browser?.close(); });
const target = { url: 'https://band.us/band/111/post/9001', title: '합성 상품', matchesBody: (body: string) => body.replace(/\s+/g, '') === '합성상품본문', createdAfter: 1699999999000, createdBefore: 1700000001000 };
async function fixture(mode = 'ok') {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext();
  let gone = mode === 'already-gone', clicks = 0, sent = 0, blockedReads = 0;
  let inspect: (r: GuardedRequest) => boolean | Promise<boolean> = () => false;
  let response: (r: GuardedResponse) => void = () => {};
  await context.route('**/*', async route => {
    const r = route.request();
    if (r.method() === 'POST') {
      const allowed = await inspect({ url: r.url(), method: 'POST', postData: r.postData() || '', contentType: r.headers()['content-type'] || '', postDataComplete: true });
      if (allowed) { sent++; gone = mode !== 'uncertain'; }
      const body = JSON.stringify({ result_code: allowed ? 1 : 0 });
      response({ url: r.url(), method: 'POST', status: allowed ? 200 : 403, body });
      return route.fulfill({ status: allowed ? 200 : 403, body, headers: { 'access-control-allow-origin': '*' } });
    }
    if (r.url().includes('/get_posts_and_announcements')) {
      if (!await inspect({ url: r.url(), method: 'GET' })) { blockedReads++; return route.abort('blockedbyclient'); }
      const post = { post_no: 9001, band: { band_no: 111 }, web_url: target.url, content: target.title + (mode === 'body' ? '\n바뀐 본문' : '\n본문'), created_at: 1700000000000 + (mode === 'time' ? 10000 : 0),
        author: { me: mode !== 'owner' }, photo_count: 1, attachment: { photo: [{ photo_url: 'https://example.invalid/one.jpg', width: 100, height: 80 }] } };
      const body = JSON.stringify({ result_code: 1, result_data: { items: gone || mode === 'feed-miss' ? [] : [{ post }] } });
      response({ url: r.url(), method: 'GET', status: 200, body });
      return route.fulfill({ contentType: 'application/json', body, headers: { 'access-control-allow-origin': '*' } });
    }
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    const html = `<style>button{width:110px;height:45px}</style>${gone ? '<p role="alert">삭제된 게시글입니다.</p>' : `<section class="postCard"><p class="postText">${mode === 'title' ? '다른 상품' : target.title}<br>본문</p><a class="postCreatedAt" href="${mode === 'identity' ? target.url + '2' : target.url}">시각</a><button class="_btnPostMore" onclick="document.querySelector('ul').hidden=false">글 옵션</button></section>${mode === 'long-menu' ? '<button class="older">다른 조작</button>'.repeat(140) : ''}
    <ul class="modalMoreMenu _optionContainer" hidden><button>글 수정</button><button class="_menuLink" onclick="document.querySelector('.lyWrap').hidden=false">삭제하기</button>${mode === 'ambiguous' ? '<button class="_menuLink">삭제하기</button>' : ''}</ul>
    <div class="lyWrap" role="alertdialog" hidden><p>${mode === 'dialog' ? '다른 내용' : '글을 삭제하시겠습니까?'}</p>${mode === 'missing-cancel' ? '' : '<button>취소</button>'}<button onclick="fetch('https://api-kr.band.us/v1.5.0/delete_post?version=20140508&ts=1700000000000',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({band_no:'111',post_no:'${mode === 'request' ? '9002' : '9001'}'${mode === 'extra-field' ? ",comment_key:'synthetic'" : ''}}).toString()})">삭제</button></div>`}<script>fetch('https://api-kr.band.us/v2.0.0/get_posts_and_announcements');${mode === 'long-menu' ? "let paged=false;document.addEventListener('focusin',e=>{if(!paged&&e.target.className==='older'){paged=true;fetch('https://api-kr.band.us/v2.0.0/get_posts_and_announcements?page_key=synthetic').catch(()=>{});}});" : ''}</script>`;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  let nativeReady = false;
  const earlyRequests: boolean[] = [], wrongMethods: boolean[] = [];
  const deletionRequest = { url: 'https://api-kr.band.us/v1.5.0/delete_post?version=20140508&ts=1700000000000', method: 'POST', postDataComplete: true, contentType: 'application/x-www-form-urlencoded', postData: 'band_no=111&post_no=9001' };
  const s: Surface = { session: 'band', open: async o => { await page.goto(o.url); }, readState: async () => {
    if (mode === 'alert-race' && gone && page.url().endsWith('/9001')) { nativeReady = true; throw Error('CDP_TIMEOUT Runtime.evaluate'); }
    return { url: page.url(), title: '', loading: false };
  },
    evaluateReadOnly: async expression => { const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, throwOnSideEffect: true }); if (r.exceptionDetails) throw Error('READ_FAILED'); return r.result.value; },
    guardRequests: async (_r, i, o) => { inspect = i; response = o; }, readAppFocus: async () => true,
    readDialog: async () => nativeReady ? { id: 'synthetic', kind: 'alert', message: '삭제되었거나 없는 게시글입니다.', url: target.url } : null,
    respondDialog: vi.fn(async () => {}),
    readClickTarget: (x, y, selector) => page.evaluate(({ x, y, selector }) => !!document.elementFromPoint(x, y)?.closest(selector), { x, y, selector }),
    click: async (x, y, before) => { if (mode === 'race' && clicks === 0) await page.locator('a.postCreatedAt').evaluate(e => e.setAttribute('href', '/band/111/post/9002')); await before?.(); clicks++; await page.mouse.click(x, y); },
    pressKey: async (k, before) => {
      if (mode === 'race' && clicks === 0 && k.key === 'Enter') await page.locator('a.postCreatedAt').evaluate(e => e.setAttribute('href', '/band/111/post/9002'));
      if (mode === 'premature' && clicks === 0 && k.key === 'Enter') earlyRequests.push(await inspect(deletionRequest));
      await before?.();
      if (mode === 'premature' && clicks === 2 && k.key === 'Enter') wrongMethods.push(await inspect({ ...deletionRequest, method: 'GET' }));
      if (k.key === 'Enter') clicks++;
      // Android's hidden WebView does not wrap Shift+Tab from its first control.
      if (mode === 'long-menu' && k.key === 'Tab' && k.modifiers === 8 && await page.evaluate(() => document.activeElement === document.querySelector('a'))) return;
      await page.keyboard.press(k.modifiers === 8 ? `Shift+${k.key}` : k.key);
    }, typeText: vi.fn(), attachFiles: vi.fn(), waitForNavigation: vi.fn(), show: vi.fn(), hide: vi.fn(), close: vi.fn() };
  const host: SurfaceHost = { create: async () => s, destroy: vi.fn(async () => {}), clearSession: vi.fn() };
  const events: import('../src/band/delete-log').BandDeleteCode[] = [];
  return { run: () => deleteMobileRecordedBandPost(host, target, 300, e => events.push(e.code)), counts: () => ({ clicks, sent }), blockedReads: () => blockedReads, s, events, earlyRequests, wrongMethods,
    request: (r: GuardedRequest) => inspect(r),
    missingResult: () => response({ method: 'POST', url: 'https://bapi-kr.band.us/v2.0.0/batch', status: 200, body: JSON.stringify({ result_code: 1, result_data: [{ result_code: 1000 }, { result_code: 200 }] }) }) };
}
describe('real mobile card/menu shape with synthetic identities', () => {
  it('reconciles an already absent post without any service input or delete request', async () => {
    const f = await fixture('already-gone'); expect(await f.run()).toEqual({ status: 'deleted', alreadyAbsent: true }); expect(f.counts()).toEqual({ clicks: 0, sent: 0 });
  });
  it('does not infer deletion from a feed omission while the recorded URL still has a post', async () => {
    const f = await fixture('feed-miss'); expect(await f.run()).toEqual({ status: 'not_started' }); expect(f.counts()).toEqual({ clicks: 0, sent: 0 }); expect(f.events).toContain('URL_POST_PRESENT');
  });
  it('deletes the recorded card once and rereads its feed twice', async () => { const f = await fixture(); expect(await f.run()).toEqual({ status: 'deleted' }); expect(f.counts()).toEqual({ clicks: 3, sent: 1 }); expect(f.s.typeText).not.toHaveBeenCalled(); expect(f.s.attachFiles).not.toHaveBeenCalled(); });
  it('blocks a pre-confirmation request, then duplicate and changed-method requests after the single delete', async () => {
    const f = await fixture('premature'), r = { url: 'https://api-kr.band.us/v1.5.0/delete_post?version=20140508&ts=1700000000000', method: 'POST', postDataComplete: true, contentType: 'application/x-www-form-urlencoded', postData: 'band_no=111&post_no=9001' };
    expect(await f.run()).toEqual({ status: 'deleted' });
    expect(f.earlyRequests).toEqual([false]);
    expect(f.wrongMethods).toEqual([false]);
    expect(await f.request(r)).toBe(false);
    expect(await f.request({ ...r, method: 'GET' })).toBe(false);
    expect(f.counts().sent).toBe(1);
    expect(f.events).toContain('ALREADY_SENT');
    expect(f.events).toContain('NOT_ARMED');
    expect(f.events).toContain('METHOD_BLOCKED');
    expect(f.events).toContain('URL_ABSENT');
  });
  it('reads the exact missing-post alert after an alert/Runtime race, with no second delete', async () => {
    const f = await fixture('alert-race'), run = f.run();
    await vi.waitFor(() => expect(f.events).toContain('URL_OPEN'), { timeout: 5000 });
    f.missingResult();
    expect(await run).toEqual({ status: 'deleted' });
    expect(f.counts().sent).toBe(1);
    expect(f.s.respondDialog).toHaveBeenCalledWith('synthetic', true);
    expect(f.events).toContain('URL_ABSENT');
  });
  it('reaches a portal without native focus wrap and blocks automatic older-page reads', async () => { const f = await fixture('long-menu'); expect(await f.run()).toEqual({ status: 'deleted' }); expect(f.counts()).toEqual({ clicks: 3, sent: 1 }); expect(f.blockedReads()).toBe(2); });
  it.each(['owner', 'title', 'identity', 'race', 'body', 'time'])('refuses %s before input', async mode => { const f = await fixture(mode); expect(await f.run()).toEqual({ status: 'not_started' }); expect(f.counts()).toEqual({ clicks: 0, sent: 0 }); });
  it.each(['request', 'extra-field'])('blocks an outgoing deletion with changed %s fields', async mode => { const f = await fixture(mode); expect(await f.run()).toEqual({ status: 'uncertain' }); expect(f.counts()).toEqual({ clicks: 3, sent: 0 }); });
  it('does not claim deletion when the post remains after a successful response', async () => { const f = await fixture('uncertain'); expect(await f.run()).toEqual({ status: 'uncertain' }); expect(f.counts().sent).toBe(1); });
  it('refuses duplicate delete menu items', async () => { const f = await fixture('ambiguous'); expect(await f.run()).toEqual({ status: 'not_started' }); expect(f.counts().sent).toBe(0); });
  it.each(['dialog', 'missing-cancel'])('refuses an unproven %s confirmation before a destructive request', async mode => { const f = await fixture(mode); expect(await f.run()).toEqual({ status: 'not_started' }); expect(f.counts().sent).toBe(0); });
});

it('WP20 proves first-try Band deletion through its persistent step log', async () => {
  const f = await fixture(), directory = mkdtempSync(path.join(os.tmpdir(), 'goltou-delete-log-'));
  try {
    const { result, lines } = await loggedFixture(directory, 'band_delete', f.run, ['sites.band.mobile-delete.deleteMobileRecordedBandPost', 'sites.band.record-read.openRecordedBandFeed']);
    expect(result).toEqual({ status: 'deleted' }); expect(f.counts().sent).toBe(1); expect(lines.at(-1).result).toBe('succeeded');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
