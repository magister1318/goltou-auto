import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import type { Surface } from '@goltou/surface';
import { bandSnapshot, domSummary, listBands, loginState, point, snapshot } from '../src';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p));

describe('WP0 readers in a fresh local browser fixture', () => {
  it.runIf(Boolean(executablePath))('reads frame geometry, login signals, bands and editor counts with side effects forbidden', async () => {
    const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      let fixture = 'band';
      await context.route('**/*', route => {
        // All responses are supplied here. No request reaches Naver, Band or any other server.
        if (route.request().url().endsWith('/frame')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div class="se-documentTitle"><p class="se-text-paragraph">연습 제목</p></div><div class="se-main-container"><div class="se-component se-text"><p class="se-text-paragraph" contenteditable="true">연습 본문</p></div><img class="se-image-resource"></div>' });
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture === 'band'
          ? '<button>로그아웃</button><a href="/band/123">연습 밴드</a><a href="/band/123">중복</a><a href="https://other.invalid/band/456">다른 사이트</a><div contenteditable="true" role="textbox"><p>연습 본문</p><img></div><input type="file"><button>임시저장</button>'
          : '<iframe id="mainFrame" src="/frame" style="width:900px;height:600px"></iframe>' });
      });
      const page = await context.newPage(); const cdp = await context.newCDPSession(page);
      const surface = { session: 'band', evaluateReadOnly: async (expression: string) => {
        const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, throwOnSideEffect: true });
        if (result.exceptionDetails) throw new Error('READ_SIDE_EFFECT_OR_SCRIPT_ERROR');
        return result.result.value;
      } } as unknown as Surface;
      await page.goto('https://band.us/band/123/post');
      expect(await loginState(surface)).toBe('confirmed');
      expect(await listBands(surface)).toEqual([{ key: '123', name: '연습 밴드' }]);
      expect(await bandSnapshot(surface, '연습 본문')).toMatchObject({ bodyMatches: true, images: 1, fileInput: true, draftControl: true });
      expect(await point(surface, 'button', '임시저장')).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
      fixture = 'naver'; await page.goto('https://blog.naver.com/GoBlogWrite.naver');
      expect(await snapshot(surface)).toEqual({ title: '연습 제목', body: '연습 본문', paragraphs: 1, images: 1 });
      expect(await domSummary(surface)).toMatchObject({ documents: 2, editables: 1 });
      await context.close();
    } finally { await browser.close(); }
  }, 20000);
});
