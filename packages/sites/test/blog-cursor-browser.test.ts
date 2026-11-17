import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import type { Surface } from '@goltou/surface';
import { readBlogCursor, blogBodyAtEnd } from '../src/naver-blog/rich-text';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p));

it.runIf(Boolean(executablePath))('measures the rendered cursor while the real-editor-shaped input buffer holds focus', async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ status: 404, body: '' }));
    await page.setContent('<button data-name="bold" data-type="toggle" class="se-property-toolbar-toggle-button"></button>' +
      '<div class="se-component se-text"><p class="se-text-paragraph"><span class="se-placeholder">본문 입력 안내</span></p></div>' +
      '<iframe id="input_buffer123"></iframe><iframe id="unrelated"></iframe>');
    // Only the fixture owns Selection/DOM writes, modelling the editor's rendered
    // selection separately from its keyboard receiver. The production reader is read-only.
    await page.evaluate(() => {
      for (const frame of document.querySelectorAll('iframe')) frame.contentDocument!.body.contentEditable = 'true';
      const node = document.querySelector('.se-placeholder')!.firstChild!;
      getSelection()!.setBaseAndExtent(node, node.textContent!.length, node, node.textContent!.length);
      document.querySelector<HTMLIFrameElement>('#input_buffer123')!.contentDocument!.body.focus();
    });
    const cdp = await page.context().newCDPSession(page);
    const surface = { evaluateReadOnly: async (expression: string) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, throwOnSideEffect: true });
      if (result.exceptionDetails) throw new Error('READ_FAILED');
      return result.result.value;
    } } as Surface;
    expect(await readBlogCursor(surface)).toMatchObject({ text: '', runs: [], anchor: 0, focus: 0, focused: true, last: true });
    await page.evaluate(() => {
      const p = document.querySelector('p')!; p.innerHTML = '<b>한글😀</b><span> 문의</span>';
      getSelection()!.setBaseAndExtent(p.querySelector('b')!.firstChild!, 0, p.querySelector('span')!.firstChild!, 3);
      document.querySelector<HTMLIFrameElement>('#input_buffer123')!.contentDocument!.body.focus();
    });
    expect(await readBlogCursor(surface)).toMatchObject({ text: '한글😀 문의', anchor: 0, focus: 7, focused: true,
      runs: [{ text: '한글😀', bold: true, href: null }, { text: ' 문의', bold: false, href: null }] });
    await page.evaluate(() => document.querySelector<HTMLIFrameElement>('#unrelated')!.contentDocument!.body.focus());
    expect(await readBlogCursor(surface)).toMatchObject({ focused: false });
    await page.evaluate(() => {
      const f = document.querySelector<HTMLIFrameElement>('#input_buffer123')!;
      f.contentDocument!.body.contentEditable = 'false'; f.contentWindow!.focus();
    });
    expect(await readBlogCursor(surface)).toMatchObject({ focused: false });
  } finally { await browser.close(); }
}, 20000);

it.runIf(Boolean(executablePath))('reads virtual selection endpoints without invoking observable getters or trusting stale native Selection', async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button data-name="bold" data-type="toggle" class="se-property-toolbar-toggle-button"></button>' +
      '<div class="se-native-selection-hidden"><div id="component" class="se-component se-text"><div id="unit"><p id="paragraph" class="se-text-paragraph"><span id="node" class="__se-node">가😀나</span></p></div></div></div><iframe id="input_buffer123"></iframe>');
    await page.evaluate(() => {
      const endpoint = (offset: number) => ({ $mobx: { values: Object.fromEntries(Object.entries({
        compId: 'component', unitId: 'unit', paraId: 'paragraph', nodeId: 'node', offset,
      }).map(([key, value]) => [key, { value }])) } });
      const store = { _state: { _anchorRef: 'end' }, $mobx: { values: { start: { value: endpoint(1) }, end: { value: endpoint(4) }, shouldBlur: { value: false } } } };
      Object.assign(window, { SmartEditor: { _editors: { fixture: { _papyrus: { _selectionInfoStore: store }, getSelection() { throw Error('GETTER_MUST_NOT_RUN'); } } } } });
      const p = document.querySelector('p')!; getSelection()!.setBaseAndExtent(p, 0, p, 0);
      const body = document.querySelector('iframe')!.contentDocument!.body; body.contentEditable = 'true'; body.focus();
    });
    const cdp = await page.context().newCDPSession(page);
    const surface = { evaluateReadOnly: async (expression: string) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, throwOnSideEffect: true });
      if (result.exceptionDetails) throw Error('READ_FAILED');
      return result.result.value;
    } } as Surface;
    expect(await readBlogCursor(surface)).toMatchObject({ text: '가😀나', anchor: 4, focus: 1, focused: true });
    expect(await blogBodyAtEnd(surface)).toBe(false);
    await page.evaluate("window.SmartEditor._editors.fixture._papyrus._selectionInfoStore.$mobx.values.start.value.$mobx.values.nodeId.value='missing-node'");
    expect(await readBlogCursor(surface)).toBeNull();
    await page.evaluate(`(() => {
      document.querySelector('p').innerHTML='<span id="node" class="__se-node"></span><span class="se-placeholder">본문 안내</span>';
      const values=window.SmartEditor._editors.fixture._papyrus._selectionInfoStore.$mobx.values;
      values.start.value.$mobx.values.nodeId.value='node';
      values.start.value.$mobx.values.offset.value=0;values.end.value.$mobx.values.offset.value=0;
    })()`);
    expect(await readBlogCursor(surface)).toMatchObject({ text: '', anchor: 0, focus: 0, focused: true });
    expect(await blogBodyAtEnd(surface)).toBe(true);
    await page.evaluate(() => document.querySelector('.se-placeholder')!.remove());
    expect(await readBlogCursor(surface)).toMatchObject({ text: '', anchor: 0, focus: 0, focused: true });
    expect(await blogBodyAtEnd(surface)).toBe(true);
    await page.evaluate(() => document.querySelector('p')!.insertAdjacentHTML('afterbegin', '<span class="__se-node">가😀</span>'));
    expect(await readBlogCursor(surface)).toMatchObject({ text: '가😀', anchor: 3, focus: 3, focused: true });
    await page.evaluate(() => { document.querySelector('#node')!.innerHTML = '<b><a href="https://example.invalid">문의</a></b>'; });
    expect(await readBlogCursor(surface)).toMatchObject({ text: '가😀문의', anchor: 3, focus: 3, runs: [
      { text: '가😀', bold: false, href: null }, { text: '문의', bold: true, href: 'https://example.invalid' },
    ] });
    expect(await blogBodyAtEnd(surface)).toBe(false);
    await page.evaluate(`(() => {const v=window.SmartEditor._editors.fixture._papyrus._selectionInfoStore.$mobx.values;v.start.value.$mobx.values.offset.value=2;v.end.value.$mobx.values.offset.value=2;})()`);
    expect(await blogBodyAtEnd(surface)).toBe(true);
    await page.evaluate(()=>{const image=document.createElement('div');image.className='se-component se-image';document.body.append(image)});
    expect(await blogBodyAtEnd(surface)).toBe(false);
    await page.evaluate(`window.SmartEditor._editors.fixture._papyrus._selectionInfoStore.$mobx.values.shouldBlur.value=true`);
    expect(await blogBodyAtEnd(surface)).toBe(false);
  } finally { await browser.close(); }
}, 20000);
