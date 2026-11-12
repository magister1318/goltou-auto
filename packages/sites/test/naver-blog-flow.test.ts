import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import type { Surface } from '@goltou/surface';
import { confirmBlogPhotos, exampleArticle, reopenBlogDraftFromList, saveAndReopen } from '../src';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p));

describe('blog save and fresh-editor verification against local DOM fixtures', () => {
  it.runIf(Boolean(executablePath))('waits for the draft count without a toast, selects the exact title, and loads offscreen image identities with keys', async () => {
    const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.route('**/*', route => route.fulfill({ status: 404, body: '' }));
      const page = await context.newPage(); const cdp = await context.newCDPSession(page);
      const article = exampleArticle('local-regression');
      const editor = (placeholderImages: boolean) => `<div class="se-documentTitle"><p class="se-text-paragraph"><span class="__se-node">${article.title}</span></p></div><div class="se-content">` +
        article.paragraphs.map(text => `<div class="se-component se-text"><p class="se-text-paragraph"><span class="__se-node">${text}</span></p></div>`).join('') +
        Array.from({ length: 5 }, (_, i) => `<img class="se-image-resource" src="${placeholderImages ? 'data:image/svg+xml;base64,PHN2Zy8+' : `/sample-${i + 1}.png`}">`).join('') + '</div>';
      const header = '<button data-click-area="tpb.save">저장</button><button data-click-area="tpb*s.count">0</button><button data-click-area="tpb.publish">발행</button>';
      let saves = 0, publishes = 0;
      const click = vi.fn(async (x: number, y: number) => {
        // Count actual UI hits in the fixture, not just attempted calls.
        const area = await page.evaluate<string | null>(`document.elementFromPoint(${x},${y})?.closest('button')?.getAttribute('data-click-area') || null`);
        if (area === 'tpb.save') saves++;
        if (area === 'tpb.publish') publishes++;
        await page.mouse.click(x, y);
      });
      const pressKey = vi.fn(async ({ key }: { key: string }) => { await page.keyboard.press(key); });
      const surface = { session: 'naver', click, pressKey, evaluateReadOnly: async (expression: string) => {
        const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, throwOnSideEffect: true });
        if (result.exceptionDetails) throw new Error('READ_SIDE_EFFECT_OR_SCRIPT_ERROR');
        return result.result.value;
      } } as unknown as Surface;
      await page.setContent(header + editor(false) + '<script>document.querySelector(\'[data-click-area="tpb.save"]\').onclick=()=>{document.querySelector(\'[data-click-area="tpb*s.count"]\').textContent="1"}</script>');
      const fresh = async (duplicates = false) => {
        await page.setContent(header + '<div id="editor"><div class="se-documentTitle"><p class="se-text-paragraph"><span class="se-placeholder">제목</span></p></div><div class="se-content"><div class="se-component se-text"><p class="se-text-paragraph"><span class="se-placeholder">본문</span></p></div></div></div>' +
          '<ul aria-label="임시저장된 글" hidden>' + Array.from({ length: duplicates ? 2 : 1 }, () => `<li><button data-click-area="tpb*s.tlist"><strong>${article.title}</strong><span>날짜 안내</span></button></li>`).join('') + '</ul>' +
          `<script>document.querySelector('[data-click-area="tpb*s.count"]').onclick=()=>{document.querySelector('ul').hidden=false};
          for(const b of document.querySelectorAll('[data-click-area="tpb*s.tlist"]')) b.onclick=()=>{document.querySelector('#editor').innerHTML=${JSON.stringify(editor(true))};document.querySelector('ul').hidden=true};
          document.addEventListener('keydown',e=>{if(e.key==='PageDown')document.querySelectorAll('.se-image-resource').forEach((img,i)=>{img.src='/sample-'+(i+1)+'.png'})});</script>`);
        return surface;
      };
      const result = await saveAndReopen(surface, article, 5, () => {}, () => fresh());
      expect(saves).toBe(1); expect(publishes).toBe(0);
      expect(result).toMatchObject({ titleMatches: true, images: 5, paragraphs: 16, reopenedFromList: true, imageOrderVerified: true });
      expect(result.imageLayout).toEqual(Array.from({ length: 5 }, (_, i) => ({ sample: i + 1, afterParagraph: 16 })));
      expect(pressKey).toHaveBeenCalledWith({ key: 'PageDown' });
      await fresh(true); click.mockClear();
      await expect(reopenBlogDraftFromList(surface, article, 5, () => {})).rejects.toThrow('DRAFT_IDENTITY_AMBIGUOUS');
      // The count button may open the list; neither duplicate title is selected.
      expect(click).toHaveBeenCalledTimes(1); expect(saves).toBe(1); expect(publishes).toBe(0);
      const photos = Array.from({ length: 5 }, (_, i) => `<img class="se-image-resource" src="/sample-${i + 1}.png">`).join('');
      await page.setContent(header + editor(false).replace(/<img[^>]+>/g, '') +
        '<div class="se-popup-image-type" style="position:fixed;top:100px;left:100px;background:white"><input id="image-type-list" name="image-type-selection" type="button"><label for="image-type-list">개별사진</label><input id="image-type-collage" type="button"><label for="image-type-collage">콜라주</label></div>' +
        `<script>document.querySelector('label[for="image-type-list"]').onclick=()=>{document.querySelector('.se-content').insertAdjacentHTML('beforeend',${JSON.stringify(photos)});document.querySelector('.se-popup-image-type').remove()}</script>`);
      expect(await confirmBlogPhotos(surface, 5, () => {})).toMatchObject({ images: 5, paragraphs: 16 });
      expect(saves).toBe(1); expect(publishes).toBe(0);
      await context.close();
    } finally { await browser.close(); }
  }, 20000);
});
