// Reference: ../refs/DAF/daf3/apps/mobile/scripts/simulate.mjs (Chromium contexts replace native surfaces).
import { chromium } from 'playwright-core';
import http from 'node:http';
import net from 'node:net';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { startCore, AppCore } = require('../dist/core-api.cjs');
const shots = process.argv.includes('--shots');
const checking = shots || process.argv.includes('--check');
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
const browser = await chromium.launch({ executablePath, headless: checking,
  args: [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
});
const blocked = [];
async function localContext(options = {}) {
  const context = await browser.newContext(options);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || ['about:', 'data:'].includes(url.protocol)) return route.continue();
    blocked.push(url.origin); return route.abort('blockedbyclient');
  });
  return context;
}
const contexts = new Map();
const surfaces = new Set();
const host = {
  async create(session) {
    let context = contexts.get(session);
    if (!context) { context = await localContext(); contexts.set(session, context); }
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
let activeContext;
const pageErrors = [];
const out = path.join(root, 'docs/reports/wp3');
async function scene(account) {
  await activeContext?.close();
  await core?.close();
  const app = new AppCore();
  core = await startCore({ host, app, uiDir: path.join(root, 'dist/ui') });
  const context = await localContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  activeContext = context;
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(core.uiUrl);
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
  await page.evaluate(() => document.fonts.ready);
  if (account) await login(page, account);
  return { page, app, context };
}
async function login(page, account) {
  await page.getByLabel('아이디', { exact: true }).fill(account);
  await page.getByLabel('비밀번호', { exact: true }).fill('demo');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('heading', { name: account === 'member' ? '사용 권한 안내' : /옮길 상품을/ }).waitFor();
  if (account !== 'member') await page.locator('.product-row').first().waitFor();
}
async function capture(page, filename) {
  if (!shots) return;
  mkdirSync(out, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await checkLayout(page, filename);
  await page.screenshot({ path: path.join(out, `${filename}.png`), animations: 'disabled' });
  assert(statSync(path.join(out, `${filename}.png`)).size <= 300 * 1024, `${filename}: PNG exceeds 300KB`);
  console.log(`[shots] ${filename}.png (390×844)`);
}
async function checkLayout(page, label) {
  const failures = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('button,input,select,textarea')].filter(element => element.getClientRects().length);
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      small: controls.filter(element => element.getBoundingClientRect().height < 43.9).map(element => element.getAttribute('aria-label') || element.textContent),
    };
  });
  assert.equal(failures.overflow, false, `${label}: horizontal overflow`);
  assert.deepEqual(failures.small, [], `${label}: touch area below 44px`);
}
async function settingsPage(page) { await page.getByRole('button', { name: /· 설정/ }).click(); await page.getByRole('heading', { name: '설정', exact: true }).waitFor(); }
async function chooseFirst(page) { await page.locator('.product-row').first().click(); await page.getByRole('tab', { name: '블로그용' }).waitFor(); }
try {
  await new Promise(resolve => example.listen(0, '127.0.0.1', resolve));
  const exampleUrl = `http://127.0.0.1:${example.address().port}/`;
  let { page, app } = await scene();
  if (!checking) {
    console.log('[sim] 390×844 가짜 앱을 열었습니다. manager / staff / admin, 비밀번호 demo');
    console.log('[sim] 실제 서비스 요청은 차단됩니다. Ctrl+C로 종료합니다.');
    await new Promise(resolve => process.once('SIGINT', resolve));
  } else {
  await capture(page, '01-login');
  await login(page, 'manager');
  await capture(page, '02-home-all');
  await page.evaluate(() => { document.documentElement.style.fontSize = '30px'; });
  await checkLayout(page, 'home 200% text');
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await chooseFirst(page);
  await page.goBack();
  await page.getByRole('heading', { name: /옮길 상품을/ }).waitFor();
  await page.getByRole('button', { name: /밴드 풀림/ }).click();
  await page.getByRole('heading', { name: '밴드 로그인', exact: true }).waitFor();
  await page.getByRole('button', { name: '로그인했어요, 상태 확인' }).click();
  await page.getByRole('button', { name: /밴드 확인됨/ }).waitFor();
  await page.getByRole('tab', { name: /안 올린 상품/ }).click();
  await page.waitForFunction(() => !document.querySelector('.product-row')?.textContent.includes('다낭'));
  await capture(page, '03-home-unposted');
  await page.getByRole('tab', { name: /^전체/ }).click();
  await page.waitForFunction(() => document.querySelector('.product-row')?.textContent.includes('다낭'));
  await chooseFirst(page);
  await capture(page, '04-preview-blog');
  await page.evaluate(() => { document.documentElement.style.fontSize = '30px'; });
  await checkLayout(page, 'preview 200% text');
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.getByRole('tab', { name: '밴드용' }).click();
  await capture(page, '05-preview-band');
  await page.getByRole('button', { name: '발행', exact: true }).click();
  await page.getByRole('button', { name: '발행으로 등록 시작' }).click();
  await page.getByRole('alertdialog').waitFor();
  assert.equal(app.snapshot().job, null, 'publish confirmation must precede job creation');
  await page.getByRole('button', { name: '돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '임시저장', exact: true }).click();
  await page.getByRole('button', { name: '임시저장으로 등록 시작' }).click();
  await page.waitForFunction(() => document.querySelector('.progress-description')?.textContent.includes('사진 3 / 5') && document.querySelector('.step-number strong')?.textContent === '4');
  await capture(page, '06-progress');
  await page.getByRole('heading', { name: '임시저장됨', exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: '등록 기록 보기' }).click();
  await page.locator('.history-row').first().waitFor();
  assert((await page.locator('.channel-result').filter({ hasText: '임시저장됨' }).count()) >= 3);
  assert.equal(app.snapshot().job.status, 'draft_saved');
  console.log('[sim] PASS: 로그인 → 상품 선택 → 임시저장 → 완료 → 기록');
  assert.equal(await page.getByRole('tab', { name: '전체', exact: true }).count(), 0, 'manager must not see all history');
  await page.getByRole('button', { name: '상품', exact: true }).click();
  await settingsPage(page);
  await page.getByLabel('예시 주소').fill(exampleUrl);
  await page.getByRole('button', { name: '진단 시작' }).click();
  await page.getByTestId('diagnostic-title').waitFor({ timeout: 45000 });
  const actual = await page.getByTestId('diagnostic-title').textContent();
  if (actual !== title) throw new Error(`DIAGNOSTIC_TITLE_MISMATCH ${actual}`);
  console.log('[sim] PASS: 설정의 WP1 진단 → core → CDP → 로컬 제목 읽기');
  ({ page, app } = await scene('manager'));
  await page.getByRole('button', { name: '등록 기록', exact: true }).click();
  await page.locator('.history-row').first().waitFor();
  await capture(page, '08-history-mine');
  await page.getByRole('button', { name: '상품', exact: true }).click();
  await settingsPage(page);
  await page.getByLabel('로그인 풀림 재현', { exact: true }).selectOption('4');
  await page.getByRole('button', { name: '← 상품 목록' }).click();
  await chooseFirst(page);
  await page.getByRole('button', { name: '임시저장으로 등록 시작' }).click();
  await page.getByRole('heading', { name: /네이버 로그인이/ }).waitFor({ timeout: 20000 });
  await capture(page, '07-relogin');
  const paused = app.snapshot().job;
  assert.equal(paused.step, 4); assert.equal(paused.current, 3);
  await page.getByRole('button', { name: '로그인했어요, 이어하기' }).click();
  await page.getByRole('heading', { name: '임시저장됨', exact: true }).waitFor({ timeout: 20000 });
  console.log('[sim] PASS: 로그인 풀림 4단계 사진 3/5 → 같은 작업 이어하기');
  ({ page, app } = await scene('staff'));
  await page.getByRole('button', { name: '등록 기록', exact: true }).click();
  await page.getByRole('tab', { name: '전체', exact: true }).click();
  await page.locator('.history-row').filter({ hasText: '김매니저' }).first().waitFor();
  await capture(page, '09-history-all');
  ({ page, app } = await scene('admin'));
  await settingsPage(page);
  await page.getByLabel('끝 문구', { exact: true }).fill('골투에 문의해 주세요.');
  await page.getByLabel('밴드 하루 한도', { exact: true }).fill('5');
  await page.getByRole('button', { name: '공통 설정 저장' }).click();
  await page.getByRole('status').waitFor();
  assert.equal(app.snapshot().settings.bandDailyLimit, 5);
  // A new scene keeps the review screenshot at the unmodified initial administrator settings.
  ({ page, app } = await scene('admin'));
  await settingsPage(page); await capture(page, '10-settings-admin');
  ({ page } = await scene('member')); await capture(page, '11-member-blocked');
  assert.deepEqual(pageErrors, []); assert.deepEqual(blocked, []);
  console.log(`[sim] PASS: 역할별 권한·설정 저장·실제 서비스 요청 0, browser=${await browser.version()}`);
  }
} catch (error) {
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  for (const page of activeContext?.pages() ?? []) {
    if (!page.isClosed()) { console.error('[sim] state', await page.locator('body').innerText().catch(() => 'unavailable')); await page.screenshot({ path: path.join(root, 'tmp/wp3-failure.png') }).catch(() => {}); }
  }
  throw error;
} finally {
  for (const surface of [...surfaces]) await surface.close().catch(() => {});
  await core?.close();
  await new Promise(resolve => example.close(resolve));
  await browser.close();
}
