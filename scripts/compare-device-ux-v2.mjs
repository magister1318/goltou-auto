// Local mock only. Original device images and comparisons stay outside git.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const out = path.resolve('../runs/wp16-shots');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  await page.route('https://**', r => r.abort());
  await page.goto(pathToFileURL(path.resolve('docs/design/ux-v2.html')).href);
  for(const name of ['login','home','product','progress','done','connect','svc','relogin','fail','history','settings']) {
    await page.locator(`[data-jump="${name}"]`).click();
    await page.locator('.phone').screenshot({ path: path.join(out, `mock-${name}.png`) });
  }
  for(const name of ['draft','publish','confirm','stop','del']) {
    await page.locator(`[data-jump="${name==='stop'?'progress':name==='del'?'history':'product'}"]`).click();
    if(name==='confirm')await page.locator('[data-sheet="publish"]').click();
    await page.locator(`[data-sheet="${name}"]`).click();
    await page.locator('.phone').screenshot({ path: path.join(out, `mock-${name}.png`) });
  }
} finally {await browser.close();}
