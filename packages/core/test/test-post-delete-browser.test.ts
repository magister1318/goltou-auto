import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { CdpConnection, CdpSurface } from '@goltou/surface/cdp';
import { read, readBlogDocument, BlogExecution, type BlogPlan } from '@goltou/sites';
import { deleteTestPost, testPostFocusSource } from '../src/test-post-delete';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const title = '[골투오토 실험] WP14 private-once synthetic';
const url = 'https://blog.naver.com/synthetic/9001';
async function fixture(changeOnHover = false, message = '삭제된 글은 복구할 수 없습니다.\n삭제하시겠습니까?') {
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
    if (u.pathname === '/deleted') { deleted = true; deletePresses++; body = '<div class="error_content">삭제된 게시물입니다.</div>'; }
    else if (u.pathname === '/PostList.naver') body = '<div class="post-list"><a href="https://blog.naver.com/synthetic/9002">다른 합성 글</a></div>';
    else if (deleted) body = '<div class="error_content">삭제된 게시물입니다.</div>';
    else if (u.pathname === '/PostView.naver') body = `<div class="se-documentTitle"><p class="se-text-paragraph">${title}</p></div><span>비공개</span><div class="se-main-container">${photos}<div class="se-component se-text"><p class="se-text-paragraph">합성 본문</p></div></div>
      <div class="wrap_tag"><div><strong>태그</strong><a class="item pcol2 itemTagfont _setTop">합성태그</a><a class="btn _showTagEditBox">수정</a></div><input hidden value="읽지 않는 값"></div>
      <div id="blog-tag"><div class="taglist"><a class="itemfont">사이드바태그</a></div></div>
      <div style="height:1800px"></div><div class="area_btn_postedit"><a href="#" class="pcol2 _deletePost _returnFalse _param(9001)">삭제</a></div>
      <script>/* Synthetic shim reproduces the WebView selector-method rejection in desktop CDP. */
      Element.prototype.matches=function(){window.readSideEffect=(window.readSideEffect||0)+1;return false};
      const a=document.querySelector('a._deletePost');
      ${changeOnHover ? "a.onmouseover=()=>{document.querySelector('.se-documentTitle p').textContent='다른 합성 글'};" : ''}
      a.onclick=e=>{e.preventDefault();if(confirm(${JSON.stringify(message)}))top.location='/deleted'};</script>`;
    else body = '<a hidden>삭제</a><iframe id="mainFrame" name="mainFrame" src="/PostView.naver?blogId=synthetic&logNo=9001" style="width:1100px;height:2600px;border:0"></iframe>';
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
  return { surface, execution, page, presses: () => deletePresses, deleted: () => deleted };
}

describe.runIf(Boolean(executablePath))('PC post cleanup in mainFrame, with selector-method rejection', () => {
  it('keeps side-effect protection, reads only post tags, scrolls and confirms one deletion, then verifies URL and populated list', async () => {
    const f = await fixture();
    await expect(read(f.surface, `return docs.some(({d})=>d.hasFocus()&&d.activeElement&&!d.activeElement.matches('input,textarea,[contenteditable="true"]'));`)).rejects.toThrow('SURFACE_READ_FAILED_OR_SIDE_EFFECT');
    expect(await read(f.surface, testPostFocusSource)).toBe(true);
    expect((await readBlogDocument(f.surface)).tags).toEqual(['합성태그']);
    const stages: string[] = [];
    await deleteTestPost(f.execution, async e => { stages.push(e.stage); if (e.stage === 'identified') expect(e.matches).toBe(true); });
    expect(stages).toEqual(['identified', 'before-delete', 'confirmation-observed', 'before-confirm', 'verified-gone']);
    expect(f.deleted()).toBe(true); expect(f.presses()).toBe(1);
    expect(new URL(f.page.url()).pathname).toBe('/PostList.naver');
    await expect(deleteTestPost(f.execution)).rejects.toThrow('BLOG_TEST_DELETE_ALREADY_ATTEMPTED');
  }, 25000);
  it('rechecks the full identity after hover and refuses a changed title before delete', async () => {
    const f = await fixture(true);
    await expect(deleteTestPost(f.execution)).rejects.toThrow('BLOG_TEST_DELETE_REFUSED');
    expect(f.presses()).toBe(0); expect(f.deleted()).toBe(false);
  }, 15000);
  it('leaves an unrelated confirmation unanswered', async () => {
    const f = await fixture(false, '다른 작업을 확인하시겠습니까?');
    await expect(deleteTestPost(f.execution)).rejects.toThrow('BLOG_TEST_DELETE_CONFIRM_UNCONFIRMED');
    expect((await f.surface.readDialog())?.message).toBe('다른 작업을 확인하시겠습니까?');
    expect(f.presses()).toBe(0); expect(f.deleted()).toBe(false);
    await f.surface.respondDialog((await f.surface.readDialog())!.id, false);
  }, 15000);
});
