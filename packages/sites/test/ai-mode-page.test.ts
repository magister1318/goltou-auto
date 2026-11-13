import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { chromium, type Browser } from 'playwright-core';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { AiModeClient, aiModeTransport, readAiState } from '../src/ai-mode';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
describe.runIf(Boolean(executablePath))('device AI page fixtures (local only)', () => {
  let browser: Browser, server: http.Server, origin: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const mode = new URL(req.url!, 'http://localhost').searchParams.get('mode');
      const gate: Record<string, string> = { login: '<input type="email" value="PRIVATE"><input type="password" value="PRIVATE">', consent: '<h1>Before you continue to Google</h1>', noInput: '<p>AI 모드</p>', region: '<p>AI Mode is not available in your country</p>', age: '<p>AI Mode age requirement</p>', blocked: '<form id="captcha-form"></form>', loginInline: '<p>Sign in to use AI Mode</p>' };
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(gate[mode!] ?? `<!doctype html><style>textarea{width:400px;height:100px}button{width:80px;height:40px}</style>
        <textarea aria-label="무엇이든 물어보세요">${mode === 'occupied' ? 'previous input' : ''}</textarea><button aria-label="보내기">Send</button>
        <h1>AI 모드 대화</h1><section data-container-id></section>
        <script>document.querySelector('button').onclick=()=>{
          const q=document.querySelector('textarea');const prompt=q.value;q.value='';
          if(${JSON.stringify(mode)}!=='noReceipt')document.querySelector('h1').textContent='AI 모드 대화: '+prompt;
          const region=document.querySelector('section');
          region.innerHTML='<ol start="${mode === 'wrongNumber' ? '2' : '1'}"><li>주변 풍경을 보며 쉬어갑니다.</li></ol>${mode === 'extra' ? '<p>추가 설명입니다.</p>' : ''}<div><p>AI 대답에는 오류가 있을 수 있습니다.</p><button aria-label="텍스트 복사">Copy</button></div>';
          if(${JSON.stringify(mode)}==='stream'){
            const stop=document.createElement('button');stop.setAttribute('aria-label','중지');document.body.append(stop);
            region.querySelector('li').textContent='중간 문장';
            setTimeout(()=>{region.querySelector('li').textContent='주변 풍경을 보며 쉬어갑니다.';stop.remove()},100);
          }
          if(${JSON.stringify(mode)}==='echo')region.querySelector('li').textContent=prompt;
        }</script>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw Error('LOCAL_REQUIRED');
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-first-run', '--disable-background-networking'] });
  });
  afterAll(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  async function fixture(mode: string) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    let inputs = 0, destroyed = 0, shows = 0, hides = 0, clears = 0;
    const pages = new Map<Surface, () => Promise<void>>();
    const host: SurfaceHost = {
      async create(session) {
        expect(session).toBe('ai');
        const page = await context.newPage(), cdp = await context.newCDPSession(page);
        const surface = {
          session,
          open: async (o: { session: string; url: string; userAgent: string }) => { expect(o.session).toBe('ai'); expect(o.userAgent).toContain('Linux x86_64'); await page.goto(o.url); },
          evaluateReadOnly: async (expression: string) => {
            const result = await cdp.send('Runtime.evaluate', { expression, throwOnSideEffect: true, returnByValue: true });
            if (result.exceptionDetails) throw Error('SURFACE_READ_FAILED_OR_SIDE_EFFECT');
            return result.result.value;
          },
          click: async (x: number, y: number) => { inputs++; await page.mouse.click(x, y); },
          typeText: async (text: string) => { for (const char of text) { inputs++; await cdp.send('Input.insertText', { text: char }); } },
          show: async () => { shows++; }, hide: async () => { hides++; },
        } as unknown as Surface;
        pages.set(surface, () => page.close()); return surface;
      },
      async destroy(surface) { destroyed++; await pages.get(surface)!(); },
      async clearSession(session) { expect(session).toBe('ai'); clears++; },
    };
    const options = { url: `${origin}/?mode=${mode}`, timeoutMs: 350, pollMs: 10, paceMs: 0 };
    return { host, options, transport: aiModeTransport(host, options), counts: () => ({ inputs, destroyed, shows, hides, clears }), close: () => context.close() };
  }
  it.each(['ok', 'stream', 'extra', 'wrongNumber'])('reads heading receipt and ordered list, preserving all response prose: %s', async mode => {
    const f = await fixture(mode);
    try {
      const answer = await f.transport('예시 소개 문장을 다듬어 주세요.');
      expect(answer).toBe(`${mode === 'wrongNumber' ? '2' : '1'}. 주변 풍경을 보며 쉬어갑니다.${mode === 'extra' ? '\n추가 설명입니다.' : ''}`);
      expect(f.counts().destroyed).toBe(1); expect(f.counts().clears).toBe(0);
    } finally { await f.close(); }
  });
  it.each([
    ['login', 'AI_LOGIN_REQUIRED'], ['loginInline', 'AI_LOGIN_REQUIRED'], ['consent', 'AI_CONSENT_REQUIRED'],
    ['region', 'AI_REGION_UNAVAILABLE'], ['age', 'AI_AGE_RESTRICTED'], ['blocked', 'AI_BLOCKED'],
    ['occupied', 'AI_INPUT_NOT_READY'], ['noInput', 'AI_LAYOUT_UNSUPPORTED'],
  ])('stops without typing on owner-action or unreadable input screen: %s', async (mode, code) => {
    const f = await fixture(mode);
    try {
      await expect(f.transport('자료')).rejects.toMatchObject({ message: code, submitted: false });
      expect(f.counts().inputs).toBe(0); expect(f.counts().destroyed).toBe(1);
    } finally { await f.close(); }
  });
  it.each([['noReceipt', 'AI_REQUEST_NOT_RECEIVED'], ['echo', 'AI_RESPONSE_TIMEOUT']])('rejects unproven or echoed replies: %s', async (mode, code) => {
    const f = await fixture(mode);
    try { await expect(f.transport('자료')).rejects.toMatchObject({ message: code, submitted: true }); }
    finally { await f.close(); }
  });
  it('never returns credential values or body on login pages', async () => {
    const f = await fixture('login');
    try {
      const s = await f.host.create('ai'); await s.open({ ...f.options, session: 'ai', width: 1280, height: 900, userAgent: 'Linux x86_64' });
      const state = await readAiState(s, '資料');
      expect(state.blocked).toBe('AI_LOGIN_REQUIRED'); expect(state.value).toBe(''); expect(state.body).toBe('');
      expect(JSON.stringify(state)).not.toContain('PRIVATE'); await f.host.destroy(s);
    } finally { await f.close(); }
  });
  it.each([['SURFACE_NAVIGATION_TIMEOUT', 'AI_NAVIGATION_TIMEOUT'], ['SURFACE_READ_FAILED_OR_SIDE_EFFECT', 'AI_READ_FAILED'], ['arbitrary details', 'AI_UNAVAILABLE']])('reports only fixed navigation/read failure codes and releases the lock: %s', async (failure, code) => {
    const f = await fixture('ok'), create = f.host.create.bind(f.host);
    try {
      f.host.create = async session => {
        const surface = await create(session);
        if (failure === 'SURFACE_NAVIGATION_TIMEOUT') surface.open = async () => { throw Error(failure); };
        else surface.evaluateReadOnly = async () => { throw Error(failure); };
        return surface;
      };
      await expect(f.transport('자료')).rejects.toMatchObject({ message: code, submitted: false });
      expect(f.counts()).toMatchObject({ destroyed: 1, inputs: 0 });
      f.host.create = create;
      await expect(f.transport('자료')).resolves.toContain('1.');
    } finally { await f.close(); }
  });
  it('shares busy protection across transport instances, releases it after errors, and exposes owner controls without submitting', async () => {
    const f = await fixture('ok');
    try {
      const client = new AiModeClient(f.host, f.options);
      await client.show(); await client.hide(); await client.show();
      expect(f.counts()).toMatchObject({ inputs: 0, shows: 2, hides: 1, destroyed: 0 });
      const pending = client.polish('다듬을 자료');
      await expect(client.show()).rejects.toThrow('AI_BUSY');
      await pending;
      expect(f.counts().destroyed).toBe(2);
      const first = f.transport('다음 자료');
      await expect(aiModeTransport(f.host, f.options)('다른 자료')).rejects.toThrow('AI_BUSY');
      await first;
      await client.clear(); expect(f.counts().clears).toBe(1);
      await expect(f.transport('마지막 자료')).resolves.toContain('1.');
    } finally { await f.close(); }
  });
});
