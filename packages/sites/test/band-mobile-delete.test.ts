import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import type { Surface, SurfaceHost, GuardedRequest, GuardedResponse } from '@goltou/surface';
import { deleteMobileRecordedBandPost } from '../src/band/mobile-delete';
let browser: Browser;
afterEach(async () => { await browser?.close(); });
const target = { url: 'https://band.us/band/111/post/9001', title: '합성 상품' };
async function fixture(mode = 'ok') {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext();
  let gone = false, clicks = 0, sent = 0, blockedReads = 0;
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
      const post = { post_no: 9001, band: { band_no: 111 }, web_url: target.url, content: target.title + '\n본문', created_at: 1700000000000,
        author: { me: mode !== 'owner' }, photo_count: 1, attachment: { photo: [{ photo_url: 'https://example.invalid/one.jpg', width: 100, height: 80 }] } };
      const body = JSON.stringify({ result_code: 1, result_data: { items: gone ? [] : [{ post }] } });
      response({ url: r.url(), method: 'GET', status: 200, body });
      return route.fulfill({ contentType: 'application/json', body, headers: { 'access-control-allow-origin': '*' } });
    }
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    const html = `<style>button{width:110px;height:45px}</style>${gone ? '' : `<section class="postCard"><p class="postText">${mode === 'title' ? '다른 상품' : target.title}<br>본문</p><a class="postCreatedAt" href="${mode === 'identity' ? target.url + '2' : target.url}">시각</a><button class="_btnPostMore" onclick="document.querySelector('ul').hidden=false">글 옵션</button></section>${mode === 'long-menu' ? '<button class="older">다른 조작</button>'.repeat(140) : ''}
    <ul class="modalMoreMenu _optionContainer" hidden><button>글 수정</button><button class="_menuLink" onclick="document.querySelector('.lyWrap').hidden=false">삭제하기</button>${mode === 'ambiguous' ? '<button class="_menuLink">삭제하기</button>' : ''}</ul>
    <div class="lyWrap" role="alertdialog" hidden><p>${mode === 'dialog' ? '다른 내용' : '글을 삭제하시겠습니까?'}</p>${mode === 'missing-cancel' ? '' : '<button>취소</button>'}<button onclick="fetch('https://api-kr.band.us/v1.5.0/delete_post?version=20140508',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({band_no:'111',post_no:'${mode === 'request' ? '9002' : '9001'}'${mode === 'extra-field' ? ",comment_key:'synthetic'" : ''}}).toString()})">삭제</button></div>`}<script>fetch('https://api-kr.band.us/v2.0.0/get_posts_and_announcements');${mode === 'long-menu' ? "let paged=false;document.addEventListener('focusin',e=>{if(!paged&&e.target.className==='older'){paged=true;fetch('https://api-kr.band.us/v2.0.0/get_posts_and_announcements?page_key=synthetic').catch(()=>{});}});" : ''}</script>`;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  const s: Surface = { session: 'band', open: async o => { await page.goto(o.url); }, readState: async () => ({ url: page.url(), title: '', loading: false }),
    evaluateReadOnly: async expression => { const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, throwOnSideEffect: true }); if (r.exceptionDetails) throw Error('READ_FAILED'); return r.result.value; },
    guardRequests: async (_r, i, o) => { inspect = i; response = o; }, readAppFocus: async () => true, readDialog: async () => null,
    readClickTarget: (x, y, selector) => page.evaluate(({ x, y, selector }) => !!document.elementFromPoint(x, y)?.closest(selector), { x, y, selector }),
    click: async (x, y, before) => { if (mode === 'race' && clicks === 0) await page.locator('a.postCreatedAt').evaluate(e => e.setAttribute('href', '/band/111/post/9002')); await before?.(); clicks++; await page.mouse.click(x, y); },
    pressKey: async (k, before) => {
      if (mode === 'race' && clicks === 0 && k.key === 'Enter') await page.locator('a.postCreatedAt').evaluate(e => e.setAttribute('href', '/band/111/post/9002'));
      await before?.(); if (k.key === 'Enter') clicks++;
      // Android's hidden WebView does not wrap Shift+Tab from its first control.
      if (mode === 'long-menu' && k.key === 'Tab' && k.modifiers === 8 && await page.evaluate(() => document.activeElement === document.querySelector('a'))) return;
      await page.keyboard.press(k.modifiers === 8 ? `Shift+${k.key}` : k.key);
    }, typeText: vi.fn(), attachFiles: vi.fn(), waitForNavigation: vi.fn(), show: vi.fn(), hide: vi.fn(), close: vi.fn() };
  const host: SurfaceHost = { create: async () => s, destroy: vi.fn(async () => {}), clearSession: vi.fn() };
  return { run: () => deleteMobileRecordedBandPost(host, target, 300), counts: () => ({ clicks, sent }), blockedReads: () => blockedReads, s };
}
describe('real mobile card/menu shape with synthetic identities', () => {
  it('deletes the recorded card once and rereads its feed twice', async () => { const f = await fixture(); expect(await f.run()).toEqual({ status: 'deleted' }); expect(f.counts()).toEqual({ clicks: 3, sent: 1 }); expect(f.s.typeText).not.toHaveBeenCalled(); expect(f.s.attachFiles).not.toHaveBeenCalled(); });
  it('reaches a portal without native focus wrap and blocks automatic older-page reads', async () => { const f = await fixture('long-menu'); expect(await f.run()).toEqual({ status: 'deleted' }); expect(f.counts()).toEqual({ clicks: 3, sent: 1 }); expect(f.blockedReads()).toBe(1); });
  it.each(['owner', 'title', 'identity', 'race'])('refuses %s before input', async mode => { const f = await fixture(mode); expect(await f.run()).toEqual({ status: 'not_started' }); expect(f.counts()).toEqual({ clicks: 0, sent: 0 }); });
  it.each(['request', 'extra-field'])('blocks an outgoing deletion with changed %s fields', async mode => { const f = await fixture(mode); expect(await f.run()).toEqual({ status: 'uncertain' }); expect(f.counts()).toEqual({ clicks: 3, sent: 0 }); });
  it('does not claim deletion when the post remains after a successful response', async () => { const f = await fixture('uncertain'); expect(await f.run()).toEqual({ status: 'uncertain' }); expect(f.counts().sent).toBe(1); });
  it('refuses duplicate delete menu items', async () => { const f = await fixture('ambiguous'); expect(await f.run()).toEqual({ status: 'not_started' }); expect(f.counts().sent).toBe(0); });
  it.each(['dialog', 'missing-cancel'])('refuses an unproven %s confirmation before a destructive request', async mode => { const f = await fixture(mode); expect(await f.run()).toEqual({ status: 'not_started' }); expect(f.counts().sent).toBe(0); });
});
