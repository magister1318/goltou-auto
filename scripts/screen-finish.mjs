// WP13 offline visual review. No service surface, registration job or API server is opened.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { AppCore, createFakeApi, startCore } = require('../dist/core-api.cjs');
const out = path.resolve(root, '../runs/wp13-shots');
const photoDirectory = process.argv[process.argv.indexOf('--photos') + 1];
const reviewPhotos = process.argv.includes('--photos')
  ? ['thumbnail_sample.jpg', 'thumb_wip_05.jpg', 'thumb_wip_06.jpg'].map(file => path.resolve(photoDirectory, file))
  : [1, 2, 3].map(n => path.join(root, `packages/sites/fixtures/sample-${n}.png`));
reviewPhotos.forEach(file => assert(existsSync(file), 'Local review photo missing'));
const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(file => file && existsSync(file));
assert(executablePath, 'Chromium missing');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking', '--no-first-run', '--no-default-browser-check'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
const imageRequests = [];
const commands = [];
const api = createFakeApi();
let photoCount = 12;
let failProducts = false;
let failPosts = false;
let emptyProducts = false;
let emptyPosts = false;
const photoUrl = n => `https://images.goltou.kr/wp13-photo-${n}.jpg`;
const app = new AppCore({ async request(route, input, token) {
  if (route === '/auto/products/list' && failProducts || route === '/auto/posts/list' && failPosts) throw Error('LOCAL_FIXTURE_UNAVAILABLE');
  const result = await api.request(route, input, token);
  if (route === '/auto/products/list') return { ...result, ...(emptyProducts ? { items: [], total: 0 } : { items: result.items.map((item, n) => ({ ...item, title: n === 0 ? '상품 안내 · 골프장과 숙소, 이동 일정과 포함 사항을 확인해 주세요' : item.title, thumbUrl: n === 2 ? '' : photoUrl(n) })) }) };
  if (route === '/auto/posts/list') return emptyPosts ? { items: [], total: 0 } : { ...result, items: result.items.map(item => ({ ...item, productTitle: item.productTitle.startsWith('[골투오토 실험]') ? '상품 안내 · 일정을 확인해 주세요' : item.productTitle })) };
  if (route === '/auto/products/get') return { ...result, title: '상품 안내 · 골프장과 숙소, 이동 일정과 포함 사항을 확인해 주세요',
    contentsHtml: `<p>일정과 포함 사항을 확인해 주세요.</p>${Array.from({ length: photoCount }, (_, n) => `<img src="${photoUrl(n)}">${n === 1 ? '<p>사진과 원문이 같은 순서로 표시됩니다.</p>' : ''}`).join('')}`,
    images: Array.from({ length: photoCount }, (_, n) => ({ order: n + 1, url: photoUrl(n) })) };
  return result;
} });
const handle = app.handle.bind(app);
app.handle = request => { commands.push(request.command); assert(!request.command.startsWith('job.'), 'WP13 review must never run a job'); return handle(request); };
const host = { create() { throw Error('No service surfaces in screen review'); }, async destroy() {}, async clearSession() {} };
let core;
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === '127.0.0.1') return route.continue();
  if (url.hostname === 'images.goltou.kr' && route.request().resourceType() === 'image') {
    imageRequests.push(url.pathname);
    const n = Number(url.pathname.match(/photo-(\d+)/)?.[1] ?? 0);
    if (n === 4) return route.fulfill({ status: 404, body: '' });
    const file = reviewPhotos[n % reviewPhotos.length];
    return route.fulfill({ contentType: file.endsWith('.jpg') ? 'image/jpeg' : 'image/png', body: readFileSync(file) });
  }
  throw Error('External request blocked in offline review');
});
page.on('pageerror', error => errors.push(error.message));
async function layout(label) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    small: [...document.querySelectorAll('button,input,select,textarea,summary')].filter(e => e.getClientRects().length && (e.getBoundingClientRect().height < 43.9 || e.getBoundingClientRect().width < 43.9)).map(e => e.getAttribute('aria-label') || e.textContent),
  }));
  assert.equal(result.overflow, false, `${label}: horizontal overflow`);
  assert.deepEqual(result.small, [], `${label}: touch area below 44px`);
}
async function capture(name) {
  await page.evaluate(() => document.fonts.ready);
  await layout(name);
  await page.screenshot({ path: path.join(out, `sim-${name}.png`), animations: 'disabled' });
  console.log(`saved sim-${name}.png`);
}
async function home() { await page.getByRole('button', { name: '상품', exact: true }).click(); await page.locator('.product-row').first().waitFor(); }
async function settings() { await page.getByRole('button', { name: /· 설정/ }).click(); await page.getByRole('heading', { name: '설정', exact: true }).waitFor(); }
async function choose() {
  await page.locator('.product-row').first().click();
  await page.locator('.converted-content').waitFor();
  await page.getByRole('button', { name: '전체 보기', exact: true }).click();
}
try {
  mkdirSync(out, { recursive: true });
  core = await startCore({ app, host, uiDir: path.join(root, 'dist/ui') });
  await page.goto(core.uiUrl);
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await capture('07-login');
  await page.getByLabel('아이디', { exact: true }).fill('manager');
  await page.getByLabel('비밀번호', { exact: true }).fill('demo');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.locator('.product-row').first().waitFor();
  await page.waitForFunction(() => document.querySelector('.thumbnail img')?.naturalWidth > 0);
  assert.equal(await page.locator('.login-strip button').count(), 2);
  await capture('01-home');
  await page.locator('.product-row').nth(4).scrollIntoViewIfNeeded();
  await capture('02-list');
  await page.evaluate(() => { document.documentElement.style.fontSize = '30px'; }); await layout('home 200% text');
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await choose();
  await page.locator('.preview-photos figure').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.preview-photo img')?.naturalWidth > 0);
  await capture('03-preview');
  await page.locator('.preview-photos figure').nth(4).scrollIntoViewIfNeeded();
  await page.getByRole('img', { name: '이미지를 표시할 수 없습니다', exact: true }).waitFor();
  await capture('16-photo-error');
  await page.locator('.preview-photos figure').first().scrollIntoViewIfNeeded();
  await page.getByRole('tab', { name: '밴드용' }).click(); await capture('08-preview-band');
  assert.equal(await page.locator('figcaption').first().innerText(), '사진 1/12');
  await page.evaluate(() => { document.documentElement.style.fontSize = '30px'; }); await layout('preview 200% text');
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.goBack(); await page.locator('.product-row').first().waitFor(); await settings();
  assert.equal(await page.locator('.settings-content').getByText(/AI 화면|Google|AI Mode/).count(), 0);
  await capture('04-settings');
  for (const [service, name] of [['naver', '네이버'], ['band', '밴드']]) {
    await page.locator('.service-link').filter({ hasText: name }).click();
    await page.getByRole('heading', { name: `${name} 로그인`, exact: true }).waitFor();
    await capture(service === 'naver' ? '05-naver' : '06-band');
    assert.equal(await page.locator('.action-bar').count(), 1);
    await page.getByRole('button', { name: '← 돌아가기', exact: true }).click();
    await page.locator('.service-link').filter({ hasText: name }).click();
    await page.getByRole('button', { name: `${name} 로그인 화면 열기`, exact: true }).click();
    await page.getByRole('button', { name: '로그인했어요, 상태 확인', exact: true }).click();
    await page.getByRole('heading', { name: '설정', exact: true }).waitFor();
    assert.equal(app.snapshot().services[service], 'confirmed');
  }
  await page.getByRole('button', { name: '← 상품 목록', exact: true }).click();
  await page.getByRole('button', { name: '등록 기록', exact: true }).click();
  await page.locator('.history-row').first().waitFor(); await capture('09-history');
  await home();
  // Long-run display check: no job starts and no originals reach any server.
  photoCount = 80; const before = imageRequests.length;
  await choose(); await page.waitForFunction(() => document.querySelector('.preview-photo img')?.naturalWidth > 0);
  assert.equal(await page.locator('figure').count(), 80);
  assert(imageRequests.length - before < 10, 'Long run must not fetch all originals');
  await page.locator('figure').last().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('figure:last-child img')?.naturalWidth > 0);
  assert(imageRequests.length - before < 20, 'Jumping to the last image must not fetch the middle run');
  console.log(`PASS long photo run: ${imageRequests.length - before}/80 image requests after jump`);
  await page.goBack(); await page.locator('.product-row').first().waitFor();
  failProducts = true; await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await page.getByText('상품을 불러오지 못했습니다.', { exact: true }).waitFor(); await capture('10-list-error');
  failProducts = false; emptyProducts = true; await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await page.getByRole('heading', { name: '조건에 맞는 상품이 없습니다', exact: true }).waitFor(); await capture('11-list-empty');
  await page.getByRole('button', { name: '등록 기록', exact: true }).click(); await page.locator('.history-row').first().waitFor();
  emptyProducts = false; await home();
  failPosts = true; await page.getByRole('button', { name: '등록 기록', exact: true }).click();
  await page.getByText('등록 기록을 불러오지 못했습니다.', { exact: true }).waitFor(); await capture('12-history-error');
  failPosts = false; emptyPosts = true; await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await page.getByRole('heading', { name: '아직 등록 기록이 없습니다', exact: true }).waitFor(); await capture('13-history-empty');
  // Present a frozen UI snapshot. No runner, job.start, editor, draft or post is used.
  app.state.job = { id: 1, productNo: 1234, title: '화면 확인', mode: 'draft', status: 'user_paused', step: 4, current: 3, total: 12,
    completedSteps: [1, 2, 3], targets: [{ channel: 'blog', name: '화면 확인', key: 'overseas' }], service: 'naver', message: '' };
  await handle({ id: 0, type: 'app', command: 'service.hide', input: {} });
  await home(); await page.getByRole('button', { name: '진행하던 작업 보기' }).click(); await capture('14-progress');
  app.state.job.status = 'login_paused';
  app.state.services.naver = 'expired';
  // A harmless snapshot notification causes the existing UI's relogin transition.
  await handle({ id: 0, type: 'app', command: 'service.hide', input: {} });
  await page.getByRole('heading', { name: /네이버 로그인이/ }).waitFor(); await capture('15-relogin');
  assert.equal(commands.filter(command => command.startsWith('job.')).length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS offline screen review: home/list/preview/settings/login guidance/history/empty/error/progress/relogin, 44px targets and 200% text; no job commands');
} finally { await context.close(); await core?.close(); await browser.close(); }
