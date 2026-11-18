// Local synthetic UI only: every non-loopback request is blocked. No device or service account.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const { startCore } = createRequire(import.meta.url)('../dist/core-api.cjs');
const out = path.resolve('../runs/blog-shots/wp36-ui');
mkdirSync(out, { recursive: true });
const available = { current: '1.0.4 (8)', phase: 'available', release: { version: '1.0.5', date: '2026-11-20', size: 56124432 }, notice: true, sheet: false, bytes: 0, percent: 0 };
const state = { user: { userNo: 1, name: '화면 시험', userType: 3, role: 'manager' },
  settings: { closingText: '', defaultHashtags: [], bandDailyLimit: 3 }, services: { naver: 'unknown', band: 'unknown', ai: 'unknown' },
  visibleService: null, job: null, simulation: { tickMs: 100, loginAt: null, failAt: null }, update: { ...available } };
const listeners = new Set();
const emit = () => { for (const listener of listeners) listener(structuredClone(state)); };
const app = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, snapshot: () => structuredClone(state), dispose() {},
  async handle({ command, input }) {
    if (command === 'session.get') return structuredClone(state);
    if (command === 'products.list' || command === 'posts.list') return { items: [], total: 0 };
    if (command === 'preferences.get' || command === 'preferences.save') return { polish: false, closing: false, linkCard: false, lastBandKeys: [] };
    if (command === 'polish.setting.get') return 'spelling';
    if (command === 'update.action') {
      if (input.action === 'open') state.update = { ...available, sheet: true };
      if (input.action === 'later' || input.action === 'close') state.update = { ...available, sheet: false, notice: false };
      if (input.action === 'download') state.update = { ...available, phase: 'downloading', sheet: true, bytes: 12300000, percent: 21 };
      if (input.action === 'cancel') state.update = { ...available, sheet: false };
      emit();
    }
    return {};
  },
};
const host = { create: async () => { throw Error('NO_SERVICE_SURFACES'); }, destroy: async () => {}, clearSession: async () => {} };
const core = await startCore({ app, host, uiDir: path.resolve('dist/ui') });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let shots = 0, external = 0;
const errors = [];
try {
  for (const width of [360, 390, 412]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
      external++; return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    state.update = { ...available }; state.job = null;
    await page.goto(core.uiUrl); await page.getByRole('heading', { name: /옮길 상품을/ }).waitFor();
    const shot = async name => {
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: horizontal overflow`);
      const small = await page.locator('button').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && !n.closest('[inert]') && n.getBoundingClientRect().height < 44).map(n => n.textContent));
      assert.deepEqual(small, [], `${name}: touch height`);
      await page.screenshot({ path: path.join(out, `${width}-${name}.png`), animations: 'disabled' }); shots++;
    };
    await page.getByText('새 버전 1.0.5가 있습니다', { exact: true }).waitFor(); await shot('home');
    await page.getByRole('button', { name: '업데이트', exact: true }).click(); await page.getByRole('alertdialog').waitFor(); await shot('available');
    await page.getByRole('alertdialog').getByRole('button', { name: '업데이트', exact: true }).click();
    await page.getByText('받는 중 12.3MB').waitFor(); assert.equal(await page.getByRole('alertdialog').getByRole('button').count(), 1); await shot('downloading');
    await page.getByRole('button', { name: '취소', exact: true }).click();
    state.update = { ...available, sheet: true, phase: 'permission' }; emit();
    await page.getByRole('heading', { name: '설치 허용이 한 번 필요합니다' }).waitFor(); await shot('permission');
    await page.getByRole('button', { name: '나중에', exact: true }).click();
    await page.getByRole('button', { name: '설정', exact: true }).click(); await page.getByRole('heading', { name: '설정', exact: true }).waitFor(); await shot('settings');
    state.update = { ...available, sheet: false, phase: 'checking' }; emit();
    await page.getByRole('button', { name: '확인 중', exact: true }).waitFor(); await shot('checking');
    state.update = { ...available, phase: 'error', sheet: true }; emit();
    await page.getByText('업데이트 파일을 확인하지 못했습니다. 잠시 뒤 다시 해 주세요.').waitFor(); await shot('error');
    await page.getByRole('button', { name: '확인', exact: true }).click();
    state.update = { ...available, sheet: true }; state.job = { id: 1, status: 'dialog_paused', step: 4, completedSteps: [], targets: [], service: null }; emit();
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: '업데이트', exact: true }).isDisabled(), true);
    await context.close();
  }
  assert.equal(external, 0); assert.deepEqual(errors, []);
  console.log(`APP_UPDATE_UI_PASSED widths=360,390,412 screenshots=${shots} external=0 pageErrors=0`);
} finally { await browser.close(); await core.close(); }
