import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { aiModeTransport } from '../src/ai-mode';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
describe('WP4 AI Mode on local fake pages', () => {
  it.runIf(Boolean(executablePath))('uses only input commands, rejects login/echo/stale answers and always releases the ai surface', async () => {
    const server = http.createServer((req, res) => {
      const mode = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('mode');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(mode === 'login' ? '<input type="password" aria-label="password">' : `<!doctype html><textarea style="width:500px;height:100px"></textarea><button aria-label="Send">Send</button>
        ${mode === 'stale' ? '<section data-ai-response><div data-answer-text>1. 이전 응답입니다.</div><button aria-label="Copy text">복사</button></section>' : ''}
        <script>document.querySelector('button[aria-label="Send"]').onclick=()=>{
          const prompt=document.querySelector('textarea').value;
          const receipt=document.createElement('div');receipt.setAttribute('aria-label','Copy '+prompt);receipt.textContent=prompt;document.body.append(receipt);
          document.querySelector('textarea').value='';
          if(${JSON.stringify(mode)}==='echo'||${JSON.stringify(mode)}==='stale')return;
          const region=document.createElement('section');region.setAttribute('data-ai-response','');
          const answer=document.createElement('div');if(${JSON.stringify(mode)}!=='delta')answer.setAttribute('data-answer-text','');answer.textContent='1. 문장을 자연스럽게 다듬습니다.';
          const copy=document.createElement('button');copy.setAttribute('aria-label','Copy text');copy.textContent='Copy text';region.append(answer,copy);document.body.append(region);
        };</script>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('LOCAL_SERVER_REQUIRED');
    const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-first-run', '--disable-background-networking'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const pages: { surface: Surface; close(): Promise<void> }[] = [];
    let typed = 0, clicked = 0, destroyed = 0;
    const host: SurfaceHost = {
      async create(session) {
        expect(session).toBe('ai');
        const page = await context.newPage(), cdp = await context.newCDPSession(page);
        const surface = {
          session, open: async (options: { url: string; session: string }) => { expect(options.session).toBe('ai'); await page.goto(options.url); },
          evaluateReadOnly: async (expression: string) => {
            const value = await cdp.send('Runtime.evaluate', { expression, throwOnSideEffect: true, returnByValue: true });
            if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
            return value.result.value;
          },
          click: async (x: number, y: number) => { clicked++; await page.mouse.click(x, y); },
          typeText: async (text: string) => { typed++; await cdp.send('Input.insertText', { text }); },
        } as unknown as Surface;
        pages.push({ surface, close: () => page.close() }); return surface;
      },
      async destroy(surface) { destroyed++; await pages.find(p => p.surface === surface)!.close(); },
      async clearSession() { throw new Error('MUST_NOT_CLEAR_LOGIN_DATA'); },
    };
    const transport = (mode: string) => aiModeTransport(host, { url: `http://127.0.0.1:${address.port}/?mode=${mode}`, timeoutMs: 250, pollMs: 5 });
    try {
      const prompt = '원문을 다듬어 주세요.\n1. 문장을 자연스럽게 다듬습니다.';
      await expect(transport('ok')(prompt)).resolves.toBe('1. 문장을 자연스럽게 다듬습니다.');
      await expect(transport('delta')(prompt)).resolves.toBe('1. 문장을 자연스럽게 다듬습니다.');
      expect(typed).toBe(2); expect(clicked).toBe(4);
      await expect(transport('login')(prompt)).rejects.toThrow('AI_LOGIN_REQUIRED');
      expect(typed).toBe(2); expect(clicked).toBe(4);
      await expect(transport('echo')(prompt)).rejects.toThrow('AI_RESPONSE_TIMEOUT');
      await expect(transport('stale')(prompt)).rejects.toThrow('AI_RESPONSE_TIMEOUT');
      expect(destroyed).toBe(5);
    } finally {
      await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 20000);
});
