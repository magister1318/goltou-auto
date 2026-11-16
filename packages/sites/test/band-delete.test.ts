import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { deleteRecordedBandPost, bandPostIdentity } from '../src/band/delete';
import type { Surface, GuardedRequest, SurfaceHost } from '@goltou/surface';
let browser: Browser;
afterEach(async () => {
  await browser?.close();
});
const url = 'https://band.us/band/111/post/9001';
async function fixture(mode = 'ok') {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM ||
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const context = await browser.newContext();
  let gone = mode === 'gone',
    clicks = 0,
    mutations = 0,
    sent = 0;
  let inspect: (r: GuardedRequest) => boolean | Promise<boolean> = () => false;
  await context.route('**/*', async (route) => {
    const r = route.request();
    if (r.method() === 'POST') {
      if (
        !(await inspect({
          url: r.url(),
          method: 'POST',
          postData: r.postData() ?? '',
          contentType: 'application/json',
          postDataComplete: true,
        }))
      )
        return route.fulfill({ status: 403, body: '{}' });
      sent++;
      if (mode !== 'uncertain') gone = true;
      return route.fulfill({
        body: JSON.stringify({ result_code: 1 }),
        contentType: 'application/json',
      });
    }
    const body = gone
      ? '<div class="postDeleted" data-band-key="111" data-post-key="9001">삭제된 게시글입니다.</div>'
      : `
    <style>button{width:100px;height:48px} .postMenu,.deletePostDialog{position:relative;background:white}</style>
    <div class="postView" data-band-key="111" data-post-key="9001" data-is-owner="${mode === 'owner' ? 'false' : 'true'}">
    <div class="postTextView">${mode === 'title' ? '다른 상품' : '합성 상품'}<br>합성 본문</div>
    <a class="_postPermalink" href="${mode === 'identity' ? '/band/111/post/9002' : url}">글 주소</a>
    <button class="_btnPostMore" aria-label="게시글 메뉴" onclick="document.querySelector('.postMenu').hidden=false">게시글 메뉴</button></div>
    <div class="postMenu" role="menu" data-band-key="111" data-post-key="${mode === 'menu' ? '9002' : '9001'}" hidden>
      <button class="_btnPostDelete" role="menuitem" onclick="document.querySelector('.deletePostDialog').hidden=false">삭제</button>${mode === 'ambiguous' ? '<button class="_btnPostDelete" role="menuitem">삭제</button>' : ''}</div>
    <section class="deletePostDialog" role="alertdialog" data-band-key="111" data-post-key="9001" hidden><h2>${mode === 'dialog' ? '다른 글 삭제' : '게시글을 삭제할까요?'}</h2><button class="_confirmDelete" onclick="removePost()">삭제</button></section>
    <script>async function removePost(){const r=await fetch('https://api-kr.band.us/v2.3.0/band/post/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({band_key:'111',post_key:'${mode === 'request' ? '9002' : '9001'}'})});if(r.ok&&${mode !== 'uncertain'}){document.body.innerHTML='<div class="postDeleted" data-band-key="111" data-post-key="9001">삭제된 게시글입니다.</div>';}}</script>`;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  });
  const page = await context.newPage(),
    cdp = await context.newCDPSession(page);
  const surface: Surface = {
    session: 'band',
    open: async (options) => {
      await page.goto(options.url);
    },
    readState: async () => ({ url: page.url(), title: '', loading: false }),
    evaluateReadOnly: async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        throwOnSideEffect: true,
      });
      if (result.exceptionDetails) throw Error('READ_FAILED');
      return result.result.value;
    },
    readClickTarget: async (x, y, selector) =>
      page.evaluate(
        ({ x, y, selector }) =>
          !!document.elementFromPoint(x, y)?.closest(selector),
        { x, y, selector },
      ),
    click: async (x, y, before) => {
      if (mode === 'dialog-race' && clicks === 2)
        await page
          .locator('.deletePostDialog h2')
          .evaluate((e) => (e.textContent = '다른 글 삭제'));
      if (mode === 'identity-race' && clicks === 0)
        await page
          .locator('.postView')
          .evaluate((e) => e.setAttribute('data-post-key', '9002'));
      await before?.();
      clicks++;
      await page.mouse.click(x, y);
    },
    guardRequests: async (_rules, handler) => {
      inspect = handler;
    },
    readAppFocus: async () => true,
    readDialog: async () => null,
    waitForNavigation: vi.fn(),
    typeText: async () => {
      mutations++;
    },
    pressKey: async () => {
      mutations++;
    },
    attachFiles: async () => {
      mutations++;
    },
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
  };
  if (mode === 'capability') delete surface.readAppFocus;
  const host: SurfaceHost = {
    create: async () => surface,
    destroy: vi.fn(async () => {}),
    clearSession: vi.fn(async () => {}),
  };
  return {
    host,
    result: () =>
      deleteRecordedBandPost(host, { url, title: '합성 상품' }, 300),
    counts: () => ({ clicks, mutations, sent }),
    surface,
  };
}
describe('recorded Band deletion, fully intercepted synthetic browser pages', () => {
  it('deletes once through the post menu, rereads the original address, then recognizes gone without clicking', async () => {
    const f = await fixture();
    expect(await f.result()).toEqual({ status: 'deleted' });
    expect(f.counts()).toEqual({ clicks: 3, mutations: 0, sent: 1 });
    expect(await f.result()).toEqual({ status: 'deleted' });
    expect(f.counts()).toEqual({ clicks: 3, mutations: 0, sent: 1 });
    expect(f.surface.show).not.toHaveBeenCalled();
  }, 20000);
  it.each(['title', 'identity', 'owner', 'identity-race', 'capability'])(
    'refuses %s before any click',
    async (mode) => {
      const f = await fixture(mode);
      expect(await f.result()).toEqual({ status: 'not_started' });
      expect(f.counts()).toEqual({ clicks: 0, mutations: 0, sent: 0 });
    },
  );
  it.each(['menu', 'ambiguous', 'dialog', 'dialog-race'])(
    'refuses an unproven %s without a destructive request',
    async (mode) => {
      const f = await fixture(mode);
      expect(await f.result()).toEqual({ status: 'not_started' });
      expect(f.counts().sent).toBe(0);
      expect(f.counts().clicks).toBeLessThan(3);
    },
  );
  it.each(['uncertain', 'request'])(
    'reports %s after confirmation without changing history or retrying input',
    async (mode) => {
      const f = await fixture(mode);
      expect(await f.result()).toEqual({ status: 'uncertain' });
      expect(f.counts().clicks).toBe(3);
      expect(f.counts().sent).toBe(mode === 'request' ? 0 : 1);
    },
  );
  it.each([
    'https://band.us/band/111/post/9001?x=1',
    'https://other.invalid/band/111/post/9001',
    'https://user@band.us/band/111/post/9001',
    'https://band.us/band/111/post',
    'http://band.us/band/111/post/9001',
  ])('rejects noncanonical identity %s', (value) => {
    expect(bandPostIdentity(value)).toBeNull();
  });
});
