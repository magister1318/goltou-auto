import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { redactionGeometry } from '../src/cdp/redaction';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
it.runIf(Boolean(executablePath))('masks iframe text and images at viewport coordinates without blacking out its whole layout', async () => {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', r => r.fulfill({ status: 404, body: '' }));
    const page = await context.newPage();
    await page.setContent('<iframe style="position:absolute;left:100px;top:70px;width:800px;height:500px" srcdoc="<p style=\'position:absolute;left:30px;top:40px;width:150px\'>Synthetic private text</p><img style=\'position:absolute;left:300px;top:50px;width:80px;height:60px\'>"></iframe>');
    const cdp = await context.newCDPSession(page);
    const result = await cdp.send('Runtime.evaluate', { expression: redactionGeometry, returnByValue: true, throwOnSideEffect: true });
    expect(result.exceptionDetails).toBeUndefined();
    const v = result.result.value as { sensitive: boolean; viewportWidth: number; viewportHeight: number; masks: number[][] };
    expect(v).toMatchObject({ sensitive: false, viewportWidth: 1280, viewportHeight: 900 });
    expect(v.masks.some(([x, y, right, bottom]) => x! <= 132 && y! <= 140 && right! >= 282 && bottom! >= 160)).toBe(true);
    expect(v.masks.some(([x, y, right, bottom]) => x! <= 402 && y! <= 122 && right! >= 482 && bottom! >= 182)).toBe(true);
    expect(v.masks.every(([x, y, right, bottom]) => (right! - x!) * (bottom! - y!) < 800 * 500)).toBe(true);
    await page.setContent('<iframe srcdoc="<input type=password>"></iframe>');
    expect((await page.evaluate(redactionGeometry) as { sensitive: boolean }).sensitive).toBe(true);
  } finally { await browser.close(); }
});
