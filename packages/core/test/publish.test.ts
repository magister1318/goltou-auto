import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { CdpSurface, type CdpConnection } from '@goltou/surface/cdp';
import { createBlogExecution } from '../src/blog';
import { deleteTestPost } from '../src/test-post-delete';
import { blogFixture } from '../../sites/test/blog-fixture';
import type { InputPlan } from '../src/convert';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(failure = '', visibility: 'public' | 'private' = 'private', probe = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'goltou-publish-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const files = [1, 2].map(index => ({ url: `https://example.invalid/${index}`, path: path.join(directory, `goltou-1234567890abcdef-${index}.png`) }));
  for (const file of files) await writeFile(file.path, new Uint8Array([137, 80, 78, 71]));
  let stored = { title: '', html: '', tags: '' }, published = 0, deleted = false, outside = 0, submissions = 0;
  const url = 'https://blog.naver.com/synthetic_fixture/9001';
  const editor = blogFixture('metadata-publish').replace('</script>', `
    document.addEventListener('click',e=>{
      const panel=document.querySelector('[data-metadata-panel]');
      if(!panel||panel.querySelector('[type=radio]'))return;
      const radios=document.createElement('div');
      radios.innerHTML='<input type="radio" name="open_type" value="2" id="public" checked><label for="public">전체공개</label><input type="radio" name="open_type" value="0" id="private"><label for="private">비공개</label>';
      panel.prepend(radios);
      if(${JSON.stringify(failure)}==='radio')radios.querySelector('#private').onclick=e=>{radios.querySelector('#public').checked=true};
      const final=panel.querySelector('[data-click-area="tpb*i.publish"]');
      if(${JSON.stringify(failure)}==='hover')final.onmouseover=()=>{radios.querySelector('#public').checked=true};
      final.onclick=async()=>{
        const snapshot={title:title.textContent,html:main.innerHTML,tags:document.querySelector('.tag_list').innerHTML};
        const openType=Number(${JSON.stringify(failure)}==='request'?'2':panel.querySelector('[name=open_type]:checked').value);
        try { const response=await fetch('/RabbitWrite.naver',{method:'POST',body:new URLSearchParams({blogId:'synthetic',documentModel:JSON.stringify(snapshot),mediaResources:'{}',populationParams:JSON.stringify({configuration:{openType}}),productApiVersion:'v1',tokenId:'synthetic'})});
          const result=await response.json();location.href=result.result.postUrl; }catch{}
      };
    });
  </script>`);
  const server = http.createServer((req, res) => {
    if (req.url === '/RabbitWrite.naver') {
      submissions++;
      let body = ''; req.on('data', chunk => { body += String(chunk); });
      req.on('end', () => { stored = JSON.parse(new URLSearchParams(body).get('documentModel')!); published++;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ isSuccess: true, result: { logNo: '9001', postUrl: url } })); });
    } else res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(editor);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const editorUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/editor`;
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
  cleanup.push(() => browser.close());
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.hostname === '127.0.0.1') return route.continue();
    if (target.hostname === 'blog.naver.com' && target.pathname.startsWith('/photos/')) return route.fulfill({ body: '' });
    if (target.href === 'https://blog.naver.com/delete-fixture') { deleted = true; return route.fulfill({ body: '{}' }); }
    if (target.href === url) {
      const html = deleted ? '<div data-post-deleted>삭제된 글입니다</div>' : `<div class="se-documentTitle"><p class="se-text-paragraph">${stored.title}</p></div><div class="se-viewer">${failure === 'content' ? stored.html.replace('1190000','1190001') : stored.html}</div><div class="tag_list">${stored.tags}</div><div class="post_visibility">${visibility === 'private' ? '비공개' : '전체공개'}</div><button onclick="if(confirm('정말 삭제하시겠습니까?'))fetch('/delete-fixture',{method:'POST'})">삭제</button>`;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    }
    outside++; return route.abort();
  });
  const host: SurfaceHost = {
    async create() {
      const page = await context.newPage(); page.on('dialog', () => {});
      const session = await context.newCDPSession(page);
      const shim = { send: (method: string, params: object) => session.send(method as never, params as never),
        on: (method: string, listener: (params: Record<string, unknown>) => void) => { session.on(method as never, listener); return () => session.off(method as never, listener); },
        isOpen: true, close: () => { void session.detach().catch(() => {}); } };
      return new CdpSurface('naver', shim as unknown as CdpConnection, { setVisible: async () => {}, close: () => page.close() }, 0);
    },
    destroy: (surface: Surface) => surface.close(), clearSession: async () => { throw new Error('UNUSED'); },
  };
  const plan: InputPlan = { channel: 'blog', steps: [
    { kind: 'text', role: 'title', text: '[골투오토 실험] 합성 발행 시험' }, { kind: 'break' },
    { kind: 'text', role: 'body', text: '본문 15 안내' }, { kind: 'break' },
    { kind: 'photos', urls: files.map(file => file.url) },
    { kind: 'table', role: 'departures', rows: [['2026-12-03', '1190000원']] },
  ], discarded: [], notices: [] };
  const probed: string[] = [];
  const execution = createBlogExecution(plan, files, { host, editorUrl, localPublish: true,
    ...(probe ? { publishProbe: { visibility, record: async (request: import('@goltou/surface').GuardedRequest) => { probed.push(new URL(request.url).pathname); if (failure === 'evidence') throw new Error('DISK_FAILED'); } } } : {}),
  }, { mode: 'publish', visibility, beforeSave() {}, check() {}, progress() {} });
  return { execution, url, probed, counts: () => ({ published, deleted, outside, submissions }) };
}
describe.runIf(Boolean(executablePath))('publish, verified against synthetic loopback service only', () => {
  it.each([['private', ''], ['public', ''], ['private', 'request'], ['private', 'evidence']] as const)('probe ALWAYS blocks %s requests (%s), even when inspection would accept or evidence fails', async (visibility, failure) => {
    const f = await fixture(failure, visibility, true);
    await f.execution.write(); await f.execution.saveAndVerify();
    await expect(f.execution.publish()).rejects.toThrow(failure === 'evidence' ? 'BLOG_PUBLISH_PROBE_EVIDENCE_FAILED' : 'BLOG_PUBLISH_PROBE_BLOCKED');
    expect(f.probed).toEqual(['/RabbitWrite.naver']);
    expect(f.execution.publishedPost).toBeUndefined();
    expect(f.counts()).toMatchObject({ published: 0, submissions: 0, outside: 0 });
    await expect(f.execution.publish()).rejects.toThrow('BLOG_PUBLISH_ALREADY_ATTEMPTED');
  }, 30000);
  it.each(['private', 'public'] as const)('saves, reopens, publishes once, verifies the final %s view and deletes only that test post', async visibility => {
    const f = await fixture('', visibility);
    await f.execution.write(); await f.execution.saveAndVerify();
    expect(await f.execution.publish()).toBe(f.url);
    expect(f.execution.publishedVerified).toBe(true);
    expect(f.execution.publishedPost).toEqual({ postId: '9001', url: f.url });
    await expect(f.execution.publish()).rejects.toThrow('BLOG_PUBLISH_ALREADY_ATTEMPTED');
    await deleteTestPost(f.execution);
    expect(f.counts()).toEqual({ published: 1, deleted: true, outside: 0, submissions: 1 });
    await expect(deleteTestPost(f.execution)).rejects.toThrow();
  }, 30000);
  it.each([['radio', 'BLOG_VISIBILITY_NOT_PRIVATE'], ['hover', 'BLOG_VISIBILITY_NOT_PRIVATE'], ['request', 'BLOG_PRIVATE_REQUEST_UNCONFIRMED']] as const)('blocks %s failure without publishing', async (failure, code) => {
    const f = await fixture(failure);
    await f.execution.write(); await f.execution.saveAndVerify();
    await expect(f.execution.publish()).rejects.toThrow(code);
    expect(f.counts()).toMatchObject({ published: 0, submissions: 0, outside: 0 });
  }, 30000);
  it('does not report published when the resulting numbers differ; retains the exact receipt for cleanup', async () => {
    const f = await fixture('content');
    await f.execution.write(); await f.execution.saveAndVerify();
    await expect(f.execution.publish()).rejects.toThrow('BLOG_READBACK_MISMATCH');
    expect(f.execution.publishedVerified).toBe(false);
    expect(f.execution.publishedPost?.postId).toBe('9001');
    await deleteTestPost(f.execution);
    expect(f.counts()).toMatchObject({ published: 1, deleted: true });
  }, 30000);
});
