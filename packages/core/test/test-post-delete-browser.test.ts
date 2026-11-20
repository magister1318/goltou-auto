import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { CdpConnection, CdpSurface } from '@goltou/surface/cdp';
import { configureTrace, traceJob, type TraceDetail } from '@goltou/surface/telemetry';
import { read, readBlogDocument, BlogExecution, deleteBlogPost, type BlogPlan, type DeleteDiagnostic } from '@goltou/sites';
import { JobLogStore } from '../src/job-logs';
import { tracePayload } from '../src/post-trace-payload';
import { deleteTestPost, testPostFocusSource } from '../src/test-post-delete';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const experimentTitle = '[골투오토 실험] WP14 private-once synthetic';
const url = 'https://blog.naver.com/synthetic/9001';
type ScrollCover = 'ad-band' | 'ad-full' | 'ad-link' | 'overlay' | 'ad-shadow';
async function fixture(changeOnHover = false, message = '삭제된 글은 복구할 수 없습니다.\n삭제하시겠습니까?', ordinary = false, moveOnHover = false, lazyShift = false, scrollCover?: ScrollCover) {
  const title = ordinary ? '일반 합성 상품' : experimentTitle;
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
  cleanup.push(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('dialog', () => {}); // Keep confirmation pending for Surface's explicit response.
  let deleted = false, deletePresses = 0;
  const photos = Array.from({ length: 13 }, (_, i) => `<div class="se-component se-image"><img class="se-image-resource" data-file-name="goltou-1234567890abcdef-${i + 1}.png"></div>`).join('');
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    let body: string;
    if (u.hostname === 'ad.example.invalid') body = '<p>fixture-private-ad-text</p>';
    else if (u.pathname === '/fixture-private-ad') body = `<fixture-ad></fixture-ad><script>
      document.querySelector('fixture-ad').attachShadow({mode:'open'}).innerHTML =
        '<div class="fixture-private-class" aria-label="fixture-private-label" style="height:200px">fixture-private-ad-text</div>';
      </script>`;
    else if (u.pathname === '/deleted') { deleted = true; deletePresses++; body = '<div class="error_content">삭제된 게시물입니다.</div>'; }
    else if (u.pathname === '/PostList.naver') body = '<div class="post-list"><a href="https://blog.naver.com/synthetic/9002">다른 합성 글</a></div>';
    else if (deleted) body = '<div class="error_content">삭제된 게시물입니다.</div>';
    else if (u.pathname === '/PostView.naver') body = `<div class="se-documentTitle"><p class="se-text-paragraph">${title}</p></div><span>${ordinary ? '전체공개' : '비공개'}</span><div class="se-main-container">${photos}<div class="se-component se-text"><p class="se-text-paragraph">합성 본문</p></div></div>
      <div class="wrap_tag"><div><strong>태그</strong><a class="item pcol2 itemTagfont _setTop">합성태그</a><a class="btn _showTagEditBox">수정</a></div><input hidden value="읽지 않는 값"></div>
      <div id="blog-tag"><div class="taglist"><a class="itemfont">사이드바태그</a></div></div>
      <div style="height:1800px"></div><div class="area_btn_postedit"><a href="#">수정</a><a href="#" class="pcol2 _deletePost _returnFalse _param(9001)">삭제</a></div>
      <script>/* Synthetic shim reproduces the WebView selector-method rejection in desktop CDP. */
      Element.prototype.matches=function(){window.readSideEffect=(window.readSideEffect||0)+1;return false};
      const a=document.querySelector('a._deletePost');
      ${changeOnHover ? "a.onmouseover=()=>{document.querySelector('.se-documentTitle p').textContent='다른 합성 글'};" : ''}
      ${moveOnHover ? "a.onmouseover=()=>{a.style.marginLeft='40px'};" : ''}
      ${lazyShift ? "top.addEventListener('scroll',()=>{setTimeout(()=>{a.parentElement.previousElementSibling.style.height='1900px'},100)}, {once:true});" : ''}
      a.onclick=e=>{e.preventDefault();if(confirm(${JSON.stringify(message)}))top.location='/deleted'};</script>
      ${scrollCover === 'ad-shadow' ? `<iframe id="fixture-private-id" src="/fixture-private-ad"
        style="position:absolute;left:550px;width:180px;height:200px;border:0;visibility:hidden"></iframe>
        <script>
        const ad = document.querySelector('#fixture-private-id');
        top.addEventListener('scroll', () => {
          ad.style.top = (top.scrollY + 350) + 'px';
          ad.style.visibility = 'visible';
        });
        </script>` : ''}`;
    else {
      body = '<a hidden>삭제</a><iframe id="mainFrame" name="mainFrame" src="/PostView.naver?blogId=synthetic&logNo=9001" style="width:1100px;height:2600px;border:0"></iframe>';
      if (scrollCover && scrollCover !== 'ad-shadow') body += `<script>
        const cover=document.createElement(${JSON.stringify(scrollCover === 'overlay' ? 'div' : 'iframe')});
        cover.id='fixture-private-id';
        cover.className='se-component fixture-private-class';
        cover.setAttribute('aria-label','fixture-private-label');
        cover.style.cssText='position:fixed;border:0;z-index:10;visibility:hidden;'
          +${JSON.stringify(scrollCover === 'ad-band' ? 'left:10%;width:80%;top:35vh;height:30vh;' :
            scrollCover === 'ad-link' ? 'left:0;width:100%;top:35vh;height:30vh;' : 'left:0;width:100%;top:0;height:100vh;')};
        if (cover.tagName==='IFRAME') cover.src='https://ad.example.invalid/fixture-private-url';
        // Put the cover above the main frame in the document hit stack.
        document.documentElement.append(cover);
        window.addEventListener('scroll',()=>{cover.style.visibility='visible';},{once:true});
      </script>`;
    }
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  });
  await page.goto(url); await page.frameLocator('#mainFrame').locator('a._deletePost').waitFor({ state: 'attached' });
  const session = await context.newCDPSession(page);
  // Playwright's local transport can drive the shared Surface without a service connection.
  const listeners = new Map<string, Set<(p: Record<string, unknown>) => void>>();
  const cdp = { isOpen: true, send: (method: string, params: Record<string, unknown> = {}) => session.send(method as never, params as never), close() {}, on(method: string, handler: (p: Record<string, unknown>) => void) {
    const handlers = listeners.get(method) ?? new Set(); listeners.set(method, handlers); handlers.add(handler);
    session.on(method as never, handler); return () => { handlers.delete(handler); session.off(method as never, handler); };
  } } as unknown as CdpConnection;
  const surface = new CdpSurface('naver', cdp, { setVisible: async () => {}, close: async () => {} }, 80);
  await session.send('Page.enable');
  await session.send('Page.setLifecycleEventsEnabled', { enabled: true });
  const plan: BlogPlan = { channel: 'blog', steps: [{ kind: 'text', role: 'title', text: title }, { kind: 'photos', urls: Array.from({ length: 13 }, (_, i) => `https://example.invalid/${i}`) }, { kind: 'text', role: 'body', text: '합성 본문' }, { kind: 'text', role: 'hashtags', text: '#합성태그' }] };
  const refuse = () => { throw new Error('UNEXPECTED_WRITE'); };
  const files = plan.steps.filter(s => s.kind === 'photos').flatMap(s => s.urls).map((url, i) => ({ url, path: `goltou-1234567890abcdef-${i + 1}.png` }));
  const execution = new BlogExecution(plan, files, { host: { create: async () => surface, destroy: async () => {}, clearSession: async () => {} }, beforeSave: refuse, check() {}, progress() {}, verify: refuse });
  execution.surface = surface;
  return { surface, execution, page, title, presses: () => deletePresses, deleted: () => deleted };
}

function scrollTrace() {
  const directory = mkdtempSync(join(tmpdir(), 'goltou-blog-delete-scroll-'));
  const store = new JobLogStore(directory);
  configureTrace(store);
  cleanup.push(async () => { configureTrace(undefined); rmSync(directory, { recursive: true, force: true }); });
  return {
    run: <T>(work: () => Promise<T>) => traceJob('blog_delete', 'naver', work),
    decisions() {
      const upload = tracePayload(store, store.list()[0]!.jobId, 1, 'blog', 'synthetic')!;
      expect(upload.log).not.toMatch(/fixture-private-|ad\.example\.invalid/);
      const lines: TraceDetail[] = upload.log.trim().split('\n').map(line => JSON.parse(line));
      return lines.filter(line => line.blogDeleteScroll).map(({ choice, counts, blogDeleteScroll }) => ({ choice, counts, ...blogDeleteScroll }));
    },
  };
}

describe.runIf(Boolean(executablePath))('PC post cleanup in mainFrame, with selector-method rejection', () => {
  it('keeps side-effect protection, reads only post tags, scrolls and confirms one deletion, then verifies URL and populated list', async () => {
    const f = await fixture();
    await expect(read(f.surface, `return docs.some(({d})=>d.hasFocus()&&d.activeElement&&!d.activeElement.matches('input,textarea,[contenteditable="true"]'));`)).rejects.toThrow('SURFACE_READ_FAILED_OR_SIDE_EFFECT');
    expect(await read(f.surface, testPostFocusSource)).toBe(true);
    expect((await readBlogDocument(f.surface)).tags).toEqual(['합성태그']);
    const stages: string[] = [];
    await deleteTestPost(f.execution, async e => { stages.push(e.stage); if (e.stage === 'identified') expect(e.matches).toBe(true); });
    expect(stages[0]).toBe('identified'); expect(stages.at(-1)).toBe('verified-gone'); expect(stages).toContain('diagnostic');
    expect(f.deleted()).toBe(true); expect(f.presses()).toBe(1);
    expect(new URL(f.page.url()).pathname).toBe('/PostList.naver');
    await expect(deleteTestPost(f.execution)).rejects.toThrow('BLOG_TEST_DELETE_ALREADY_ATTEMPTED');
  }, 25000);
  it('uses the regular engine for an ordinary public post, with three full dry runs and numeric evidence', async () => {
    const f = await fixture(false, '삭제된 글은 복구할 수 없습니다. 삭제하시겠습니까?', true, false, true);
    // Real Android refuses to show a non-login surface. Cleanup must use the
    // same hidden input path as the editor and retain its independent focus check.
    f.surface.show = async () => { throw new Error('ONLY_LOGIN_SURFACE_VISIBLE'); };
    const diagnostics: DeleteDiagnostic[] = [];
    await deleteBlogPost(f.surface, { url, title: f.title }, async d => { diagnostics.push(d); if (d.item === 14) expect(f.presses()).toBe(0); });
    expect(diagnostics.filter(d => d.item === 14).map(d => d.run)).toEqual([1, 2, 3]);
    expect(diagnostics.every(d => Object.values(d).every(v => typeof v === 'number'))).toBe(true);
    expect(f.presses()).toBe(1); expect(f.deleted()).toBe(true);
  }, 25000);
  it('WP50 finds an alternate body point after PageDown exposes a cross-origin ad', async () => {
    const f = await fixture(false, undefined, true, false, false, 'ad-band');
    const keys = vi.spyOn(f.surface, 'pressKey');
    const clicks = vi.spyOn(f.surface, 'click');
    const logs = scrollTrace();
    await logs.run(() => deleteBlogPost(f.surface, { url, title: f.title }));
    expect(keys.mock.calls.map(([input]) => input.key)).toEqual(['PageDown', 'PageDown']);
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(f.presses()).toBe(1);
    expect(f.deleted()).toBe(true);
    expect(logs.decisions()).toEqual([
      { choice: 'ok', counts: { step: 7, runs: 1, attempt: 1 }, x: 640, y: 450 },
      ...[640, 192, 1088].map(x => ({
        choice: 'retry', counts: { step: 7, runs: 1, attempt: 2 }, x, y: 450, tag: 'iframe', classes: ['se-component'], iframe: true,
        inShadow: false, frameDepth: 0,
      })),
      { choice: 'ok', counts: { step: 7, runs: 1, attempt: 2 }, x: 640, y: 270 },
    ]);
  }, 25000);
  it('WP51 retries when PageDown exposes an open shadow root in an accessible nested ad frame', async () => {
    const f = await fixture(false, undefined, true, false, false, 'ad-shadow');
    const keys = vi.spyOn(f.surface, 'pressKey');
    const clicks = vi.spyOn(f.surface, 'click');
    const logs = scrollTrace();
    await logs.run(() => deleteBlogPost(f.surface, { url, title: f.title }));
    expect(keys.mock.calls.map(([input]) => input.key)).toEqual(['PageDown', 'PageDown']);
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(f.presses()).toBe(1);
    expect(f.deleted()).toBe(true);
    expect(new URL(f.page.url()).pathname).toBe('/PostList.naver');
    expect(logs.decisions()).toEqual([
      { choice: 'ok', counts: { step: 7, runs: 1, attempt: 1 }, x: 640, y: 450 },
      {
        choice: 'retry', counts: { step: 7, runs: 1, attempt: 2 },
        x: 640, y: 450, tag: 'div', classes: [], iframe: false, inShadow: true, frameDepth: 2,
      },
      { choice: 'ok', counts: { step: 7, runs: 1, attempt: 2 }, x: 192, y: 450 },
    ]);
  }, 25000);
  it.each(['ad-full', 'overlay'] as const)('refuses more input when all scroll points are covered (%s)', async cover => {
    const f = await fixture(false, undefined, true, false, false, cover);
    const keys = vi.spyOn(f.surface, 'pressKey');
    const clicks = vi.spyOn(f.surface, 'click');
    const logs = scrollTrace();
    const diagnostics: DeleteDiagnostic[] = [];
    await expect(logs.run(() => deleteBlogPost(f.surface, { url, title: f.title }, async item => { diagnostics.push(item); })))
      .rejects.toThrow('BLOG_POST_DELETE_CHECK_7');
    expect(keys.mock.calls.map(([input]) => input.key)).toEqual(['PageDown']);
    expect(clicks).not.toHaveBeenCalled();
    expect(f.presses()).toBe(0);
    expect(diagnostics.at(-1)).toMatchObject({ item: 7, pass: 0 });
    const points = [[640, 450], [192, 450], [1088, 450], [640, 270], [640, 630]];
    expect(logs.decisions().filter(d => d.counts?.attempt === 2)).toEqual(points.map(([x, y], index) => ({
      choice: index === points.length - 1 ? 'fail' : 'retry',
      counts: { step: 7, runs: 1, attempt: 2 }, x, y,
      tag: cover === 'ad-full' ? 'iframe' : 'div', classes: ['se-component'], iframe: cover === 'ad-full',
      inShadow: false, frameDepth: 0,
    })));
  }, 25000);
  it('WP50 still refuses a delete link covered by an ad after finding a scroll point', async () => {
    const f = await fixture(false, undefined, true, false, false, 'ad-link');
    const clicks = vi.spyOn(f.surface, 'click');
    const logs = scrollTrace();
    const diagnostics: DeleteDiagnostic[] = [];
    await expect(logs.run(() => deleteBlogPost(f.surface, { url, title: f.title }, async item => { diagnostics.push(item); })))
      .rejects.toThrow('BLOG_POST_DELETE_CHECK_7');
    expect(logs.decisions().at(-1)).toMatchObject({ choice: 'ok', counts: { attempt: 2 }, x: 640, y: 270 });
    expect(diagnostics.at(-1)).toMatchObject({ item: 7, pass: 0, x: expect.any(Number), y: expect.any(Number) });
    expect(clicks).not.toHaveBeenCalled();
    expect(f.presses()).toBe(0);
  }, 25000);
  it('reads and deletes with side-effect protection when the page wraps trim', async () => {
    const f = await fixture(false, '삭제된 글은 복구할 수 없습니다. 삭제하시겠습니까?', true);
    await f.page.evaluate(() => {
      String.prototype.trim = new Proxy(String.prototype.trim, { apply(target, value, args) {
        (window as unknown as { trimSideEffect: boolean }).trimSideEffect = true;
        return Reflect.apply(target, value, args);
      } });
    });
    await expect(f.surface.evaluateReadOnly('" value ".trim()')).rejects.toThrow('SURFACE_READ_FAILED_OR_SIDE_EFFECT');
    expect((await readBlogDocument(f.surface)).title).toBe(f.title);
    await deleteBlogPost(f.surface, { url, title: f.title });
    expect(f.deleted()).toBe(true); expect(f.presses()).toBe(1);
  }, 25000);
  it('refuses moved coordinates after hover, with no destructive press', async () => {
    const f = await fixture(false, '삭제된 글은 복구할 수 없습니다. 삭제하시겠습니까?', true, true);
    const diagnostics: DeleteDiagnostic[] = [];
    await expect(deleteBlogPost(f.surface, { url, title: f.title }, async d => { diagnostics.push(d); })).rejects.toThrow('BLOG_POST_DELETE_CHECK_6');
    expect(diagnostics.at(-1)).toMatchObject({ item: 6, pass: 0 }); expect(f.presses()).toBe(0);
  }, 25000);
  it('refuses lost native app focus before input', async () => {
    const f = await fixture(); f.surface.readAppFocus = async () => false;
    await expect(deleteBlogPost(f.surface, { url, title: f.title })).rejects.toThrow('BLOG_POST_DELETE_CHECK_8');
    expect(f.presses()).toBe(0);
  }, 15000);
  it('rechecks the full identity after hover and refuses a changed title before delete', async () => {
    const f = await fixture(true);
    await expect(deleteTestPost(f.execution)).rejects.toThrow('BLOG_POST_DELETE_CHECK_2');
    expect(f.presses()).toBe(0); expect(f.deleted()).toBe(false);
  }, 15000);
  it('leaves an unrelated confirmation unanswered', async () => {
    const f = await fixture(false, '다른 작업을 확인하시겠습니까?');
    await expect(deleteTestPost(f.execution)).rejects.toThrow('BLOG_POST_DELETE_CONFIRM_UNCONFIRMED');
    expect((await f.surface.readDialog())?.message).toBe('다른 작업을 확인하시겠습니까?');
    expect(f.presses()).toBe(0); expect(f.deleted()).toBe(false);
    await f.surface.respondDialog((await f.surface.readDialog())!.id, false);
  }, 15000);
});
