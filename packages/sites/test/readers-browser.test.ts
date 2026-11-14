import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import type { Surface } from '@goltou/surface';
import { bandSnapshot, blogImageLayout, closeComposer, domSummary, exampleArticle, fillBlog, listBands, loginState, point, prepareBlogEditor, saveAndReopen, snapshot } from '../src';

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
        if (route.request().url().endsWith('/PostWriteForm.naver')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div class="se-documentTitle"><p class="se-text-paragraph"><span class="__se-node"></span><span class="se-placeholder">제목</span></p></div><div class="se-main-container"><div class="se-component se-text"><p class="se-text-paragraph"><span class="__se-node"></span><span class="se-placeholder">본문</span></p></div></div>' });
        if (route.request().url().endsWith('/frame')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div class="se-documentTitle"><p class="se-text-paragraph">연습 제목</p></div><div class="se-main-container"><div class="se-component se-text"><p class="se-text-paragraph" contenteditable="true">연습 본문</p></div><img class="se-image-resource"></div>' });
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture === 'cancel'
          ? '<section class="lyWrap"><div class="headingMsg">글 작성을 취소하시겠습니까?</div><button class="_btnConfirm">확인</button></section>'
          : fixture === 'restore'
          ? '<div class="se-documentTitle"><p class="se-text-paragraph"><span class="se-placeholder">제목</span></p></div><div class="se-content"><div class="se-component se-text"><p class="se-text-paragraph"><span class="se-placeholder">본문</span></p></div></div><div class="se-popup-alert-confirm">작성 중인 글이 있습니다. 이어서 작성하시겠습니까?<button class="se-popup-button-confirm">확인</button><button class="se-popup-button-cancel" onclick="this.parentElement.remove()">취소</button></div>'
          : fixture === 'layout'
          ? '<div class="se-documentTitle"><p class="se-text-paragraph">연습 제목</p></div><div class="se-content"><div class="se-component se-text"><p class="se-text-paragraph">첫 문단</p><p class="se-text-paragraph"><span class="se-placeholder">본문</span></p></div><img class="se-image-resource" src="/sample-3.png"><div class="se-component se-text"><p class="se-text-paragraph">둘째 문단</p></div><img class="se-image-resource" src="/sample-1.png"><img class="se-image-resource" src="/unknown.png"></div>'
          : fixture === 'mobile'
          ? '<textarea class="_postTextArea" placeholder="새로운 소식을 남겨보세요.">연습 본문</textarea><div class="postAttachItem"><ul class="_mediaListWrap"><li class="mediaListItem"><img class="mediaImg"></li></ul></div><input type="file" accept="image/*" multiple>'
          : fixture === 'desktop'
          ? '<div class="cke_editable" contenteditable="true" role="textbox"><p>\u200b<span class="placeholder _placeholder">새로운 소식을 남겨보세요.</span>\u200b</p><band:attachment>사진 안내</band:attachment></div>'
          : fixture === 'band'
          ? '<button>로그아웃</button><div class="_myBandListWrap"><a class="bandCover" href="/band/123/post"><div class="bandName">연습 밴드</div>그 외 정보</a><a class="bandCover" href="/band/123/post">중복</a><a class="bandCover _adBandCover" href="/band/789/post">광고</a></div><a href="/band/456/post">추천 밴드</a><div contenteditable="true" role="textbox"><p>연습 본문</p><img></div><input type="file"><button>임시저장</button>'
          : `<iframe id="mainFrame" src="${fixture === 'empty' ? '/PostWriteForm.naver' : '/frame'}" style="width:900px;height:600px"></iframe>` });
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
      fixture = 'mobile'; await page.goto('https://band.us/band/123/post');
      expect(await bandSnapshot(surface, '연습 본문')).toMatchObject({ bodyMatches: true, bodyChars: 4, rawBodyChars: 5, images: 1, maxLength: null, fileInput: true, draftControl: false });
      fixture = 'desktop'; await page.goto('https://band.us/band/123/post');
      expect(await bandSnapshot(surface, '')).toMatchObject({ bodyMatches: true, bodyChars: 0, images: 1 });
      fixture = 'naver'; await page.goto('https://blog.naver.com/GoBlogWrite.naver');
      expect(await snapshot(surface)).toEqual({ title: '연습 제목', body: '연습 본문', paragraphs: 1, images: 1 });
      expect(await domSummary(surface)).toMatchObject({ documents: 2, editables: 1 });
      fixture = 'empty'; await page.goto('https://blog.naver.com/owner');
      expect(await loginState({ ...surface, session: 'naver' })).toBe('confirmed');
      expect(await snapshot(surface)).toEqual({ title: '', body: '', paragraphs: 0, images: 0 });
      fixture = 'restore'; await page.goto('https://blog.naver.com/GoBlogWrite.naver');
      const click = vi.fn(async () => {}), typeText = vi.fn(async () => {}), attachFiles = vi.fn(async () => {});
      await expect(fillBlog({ ...surface, click, typeText, attachFiles }, exampleArticle('fixture'), [], () => {})).rejects.toThrow('AUTO_RECOVER_CONSENT_REQUIRED');
      expect(click).not.toHaveBeenCalled(); expect(typeText).not.toHaveBeenCalled(); expect(attachFiles).not.toHaveBeenCalled();
      // Only the explicit app consent permits declining this exact restore prompt.
      const mouse = vi.fn(async (x: number, y: number) => { await page.mouse.click(x, y); });
      expect(await prepareBlogEditor({ ...surface, click: mouse }, () => {}, { autoRecover: 'decline-with-user-consent' })).toEqual({ empty: true, autoRecoverDeclined: true });
      expect(mouse).toHaveBeenCalledTimes(1);
      // A prompt may expose its own title. Compare exactly, and never infer
      // ownership from the empty editor's title or a matching substring.
      for (const [title, remembered, automatic] of [
        ['앱의 제목', '앱의 제목', true], ['다른 제목', '앱의 제목', false],
        ['앱의 제목 ', '앱의 제목', false], ['', '앱의 제목', false],
        ['앱의 제목', null, false],
      ] as const) {
        await page.goto('https://blog.naver.com/GoBlogWrite.naver');
        if (title) await page.locator('.se-popup-alert-confirm').evaluate((e, text) => {
          const title = document.createElement('div'); title.className = 'se-documentTitle';
          const p = document.createElement('p'); p.className = 'se-text-paragraph'; p.textContent = text;
          title.append(p); e.append(title);
        }, title);
        const note = vi.fn(); mouse.mockClear();
        const result = prepareBlogEditor({ ...surface, click: mouse }, () => {}, { lastTypedTitle: remembered, onOwnRecoveryDiscarded: note });
        if (automatic) {
          await expect(result).resolves.toEqual({ empty: true, autoRecoverDeclined: true });
          expect(mouse).toHaveBeenCalledTimes(1); expect(note).toHaveBeenCalledTimes(1);
        } else {
          await expect(result).rejects.toThrow('AUTO_RECOVER_CONSENT_REQUIRED');
          expect(mouse).not.toHaveBeenCalled(); expect(note).not.toHaveBeenCalled();
          expect(await page.locator('.se-popup-alert-confirm').count()).toBe(1);
        }
      }
      await page.goto('https://blog.naver.com/GoBlogWrite.naver'); mouse.mockClear();
      const unreadable = { ...surface, click: mouse, evaluateReadOnly: async <T>(expression: string): Promise<T> => {
        if (expression.includes('const titles=')) throw Error('TITLE_READ_UNAVAILABLE');
        return surface.evaluateReadOnly<T>(expression);
      } };
      await expect(prepareBlogEditor(unreadable, () => {}, { lastTypedTitle: '앱의 제목' })).rejects.toThrow('AUTO_RECOVER_CONSENT_REQUIRED');
      expect(mouse).not.toHaveBeenCalled();
      fixture = 'naver'; await page.goto('https://blog.naver.com/GoBlogWrite.naver');
      mouse.mockClear();
      await expect(prepareBlogEditor({ ...surface, click: mouse }, () => {}, { autoRecover: 'decline-with-user-consent' })).rejects.toThrow('EDITOR_NOT_EMPTY');
      expect(mouse).not.toHaveBeenCalled();
      fixture = 'layout'; await page.goto('https://blog.naver.com/GoBlogWrite.naver');
      expect(await blogImageLayout(surface)).toEqual([{ sample: 3, afterParagraph: 1 }, { sample: 1, afterParagraph: 2 }, { sample: null, afterParagraph: 2 }]);
      const reopen = vi.fn();
      await expect(saveAndReopen({ ...surface, click: mouse }, exampleArticle('fixture'), 3, () => {}, reopen)).rejects.toThrow('DRAFT_SAVE_INPUT_MISMATCH');
      expect(mouse).not.toHaveBeenCalled(); expect(reopen).not.toHaveBeenCalled();
      fixture = 'cancel'; await page.goto('https://band.us/band/123/post'); click.mockClear();
      await closeComposer({ ...surface, click }); expect(click).toHaveBeenCalledTimes(1);
      await context.close();
    } finally { await browser.close(); }
  }, 30000);
});
