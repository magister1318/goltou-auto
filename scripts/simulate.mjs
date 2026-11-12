// Reference: ../refs/DAF/daf3/apps/mobile/scripts/simulate.mjs (Chromium contexts replace native surfaces).
import { chromium } from 'playwright-core';
import http from 'node:http';
import net from 'node:net';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { startCore } = require('../dist/core-api.cjs');
const { CdpConnection, CdpSurface } = require('../dist/surface.cjs');
const executablePath = [process.env.CHROMIUM,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(file => file && existsSync(file));
if (!executablePath) throw new Error('기존 Chromium을 찾지 못했습니다. CHROMIUM을 실행 파일 경로로 지정해 주세요.');

const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const debugPort = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const browser = await chromium.launch({ executablePath, headless: true,
  args: [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check'],
});
const contexts = new Map();
const surfaces = new Set();
const host = {
  async create(session) {
    let context = contexts.get(session);
    if (!context) { context = await browser.newContext(); contexts.set(session, context); }
    const page = await context.newPage();
    const probe = await context.newCDPSession(page);
    const { targetInfo } = await probe.send('Target.getTargetInfo');
    await probe.detach();
    const cdp = await CdpConnection.connect(`ws://127.0.0.1:${debugPort}/devtools/page/${targetInfo.targetId}`);
    const surface = new CdpSurface(session, cdp, {
      // Headless simulation has no visible native layers; a headed shell implements these hooks.
      setVisible: async visible => { if (visible) await page.bringToFront(); },
      close: async () => { surfaces.delete(surface); await page.close(); },
    });
    surfaces.add(surface);
    return surface;
  },
  async destroy(surface) { await surface.close(); },
  async clearSession(session) {
    for (const surface of [...surfaces]) if (surface.session === session) await surface.close();
    await contexts.get(session)?.close();
    contexts.delete(session);
  },
};
const title = '골투오토 진단 예제';
const example = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  .end(`<!doctype html><html lang="ko"><head><title>${title}</title></head><body><h1>${title}</h1><input aria-label="시험 입력"><input type="file"></body></html>`));
let core;
try {
  await new Promise(resolve => example.listen(0, '127.0.0.1', resolve));
  const exampleUrl = `http://127.0.0.1:${example.address().port}/`;
  core = await startCore({ host, uiDir: path.join(root, 'dist/ui') });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(core.uiUrl);
  await page.getByRole('button', { name: '진단 시작' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button').disabled);
  await page.getByLabel('예시 주소').fill(exampleUrl);
  await page.getByRole('button', { name: '진단 시작' }).click();
  await page.getByTestId('diagnostic-title').waitFor({ timeout: 45000 });
  const actual = await page.getByTestId('diagnostic-title').textContent();
  if (actual !== title) throw new Error(`DIAGNOSTIC_TITLE_MISMATCH ${actual}`);
  if (pageErrors.length) throw new Error(pageErrors.join('\n'));
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'tmp/wp1-sim.png'), fullPage: true });
  console.log(`[sim] PASS: React 진단 화면 → core → CDP → 제목 "${actual}"`);
  console.log(`[sim] browser=${await browser.version()}, screenshot=tmp/wp1-sim.png`);
  if (process.argv.includes('--keep')) {
    console.log('[sim] 유지 중. Ctrl+C로 종료합니다.');
    await new Promise(resolve => process.once('SIGINT', resolve));
  }
} finally {
  for (const surface of [...surfaces]) await surface.close().catch(() => {});
  await core?.close();
  await new Promise(resolve => example.close(resolve));
  await browser.close();
}
