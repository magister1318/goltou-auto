// Uses the built UI, local WebSocket fixtures and the in-memory API. No external service or device.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const build = path.resolve(process.argv[2] ?? 'tmp/wp38-ui');
const output = path.resolve(process.argv[3] ?? '../runs/wp38-shots');
const { createFakeApi, fillMyText, makePreview, startCore } = require(path.join(build, 'core-api.cjs'));
const user = { userNo: 14, name: '김도윤', nickname: '김도윤', phone: '010-1234-5678', userType: 9, role: 'admin' };
const token = 'local-fixture';
const title = '[태국 파타야] 시암CC 4색 코스 무제한 라운드 5일';
const api = createFakeApi({ token, user, productTitle: title });
const options = { polish: false, closing: true, linkCard: false };
const tags = ['골투', '해외투어', '해외골프'];
const bandNames = ['골투, 골프투어 플랫폼', '어니언골프와 골투가 함께하는 골프여행', '동남아 골프 여행 정보', '골투 매니저 공지'];
const bands = bandNames.map((name, index) => ({ key: String(index + 101), name, photoLimit: null, observedAt: null }));
const photos = await Promise.all(bands.map((_, index) => readFile(`packages/sites/fixtures/sample-${index + 1}.png`)));
const blogUrl = 'https://blog.naver.com/synthetic/1234';
const bandUrl = key => `https://band.us/band/${key}/post/1234`;
const productNo = 1234;
const source = await api.request('/auto/products/get', { productNo }, token);
const articles = [
  [productNo, 'blog', 'published'], [productNo, 'band', 'published'],
  [productNo + 1, 'blog', 'draft_saved'], [productNo + 2, 'blog', 'failed'], [productNo + 3, 'blog', 'stopped'],
];
for (const [number, channel, status] of articles) {
  const product = await api.request('/auto/products/get', { productNo: number }, token);
  const { postNo } = await api.request('/auto/posts/start', {
    productNo: number, contentHash: product.contentHash, channel, mode: status === 'draft_saved' ? 'draft' : 'publish',
    target: channel === 'band' ? bands[0] : { key: 'blog', name: '해외골프' }, options,
  }, token);
  await api.request('/auto/posts/update', {
    postNo, status, step: 7, failReason: status === 'failed' ? 'PHOTO_DOWNLOAD_FAILED' : '',
    postUrl: status === 'published' ? channel === 'band' ? bandUrl(bands[0].key) : blogUrl : '',
  }, token);
}
const settings = { closingText: '', defaultHashtags: tags, bandDailyLimit: 4 };
const personal = { prefix: '안녕하세요. 골투 {닉네임} 매니저입니다.', closing: '예약·문의는 골투 {닉네임} 매니저 {휴대폰} 으로 편하게 연락 주세요.', closingOn: true };
const photoUrl = index => `https://goltou.kr/wp38/${index % photos.length}.png`;
const product = {
  ...source, title, country: '태국', region: '파타야', ownerNickname: user.nickname,
  images: [{ order: 1, url: photoUrl(0) }],
  contentsHtml: '<p>4색 코스 무제한 라운드와 노캐디 자유 라운드를 즐길 수 있습니다.</p><p>파타야 호텔에서 숙박합니다.</p>',
  departures: [], golfCourses: ['시암CC', '시암CC플랜테이션'],
};
const fixtureTargets = [{ channel: 'blog', key: 'blog', name: '해외골프' }, ...bands.slice(0, 3).map(({ key, name }) => ({ channel: 'band', key, name }))];
const listeners = new Set();
const calls = [];
let state;
const reset = () => {
  state = {
    user, settings, myText: personal, services: { naver: 'confirmed', band: 'confirmed', ai: 'unknown' }, visibleService: null,
    job: null, simulation: { tickMs: 100, loginAt: null, failAt: null },
  };
};
const snapshot = () => structuredClone(state);
const emit = () => { for (const listener of listeners) listener(snapshot()); };
const preview = closing => makePreview(product, {
  closing, linkCard: false, tagWords: tags,
  prefixText: fillMyText(state.myText.prefix, user), closingText: fillMyText(state.myText.closing, user),
});
const app = {
  snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, dispose() {},
  async handle({ command, input }) {
    calls.push({ command, input });
    switch (command) {
      case 'session.get': return snapshot();
      case 'update.home':
      case 'app.exit':
      case 'post.open': return {};
      case 'preferences.get': return { ...options, lastBandKeys: ['101', '102'] };
      case 'preferences.save': return input;
      case 'polish.setting.get': return 'spelling';
      case 'products.list': {
        const page = await api.request('/auto/products/list', input, token);
        return { ...page, items: page.items.map((row, index) => row.productNo === productNo
          ? { ...row, country: product.country, region: product.region, thumbUrl: photoUrl(index), ownerNickname: user.nickname, changed: { blog: false, band: true } }
          : { ...row, thumbUrl: photoUrl(index), ...(index === 3 ? { ownerNickname: undefined } : {}) }) };
      }
      case 'products.get': {
        const detail = await api.request('/auto/products/get', input, token);
        return { ...product, ...detail, title: product.title, country: product.country, region: product.region, ownerNickname: user.nickname,
          contentsHtml: product.contentsHtml, departures: product.departures, images: product.images, golfCourses: product.golfCourses,
          posts: detail.posts.map(post => ({ ...post, changed: post.channel === 'band' })) };
      }
      case 'preview.prepare': return preview(input.options.closing);
      case 'job.preview': return preview(true);
      case 'bands.list': return { rows: bands, savedAt: Date.now(), source: 'band', stale: false };
      case 'bands.dailyUsage': return { limit: 4, used: 1 };
      case 'posts.list': return api.request('/auto/posts/list', input, token);
      case 'stats.today': return api.request('/auto/stats/today', {}, token);
      case 'myText.save': state.myText = input; emit(); return snapshot();
      case 'job.start': {
        const now = Date.now();
        const activity = { channel: 'band', stage: 'write', blockKind: 'paragraph', blockIndex: 5, phase: 'start', at: now, fraction: 0.65 };
        const earlier = [0, 2].map(blockIndex => ({ ...activity, blockIndex, phase: 'finish', fraction: 1, at: now - 1000 }));
        state.job = {
          id: 1, productNo, title, mode: input.mode, status: 'running', step: 6, current: 0, total: 1,
          completedSteps: [1, 2, 3, 4, 5], activeTargetKey: '102', startedAt: now - 60000, activity, activityLog: [...earlier, activity],
          service: null, message: '', targets: input.targets,
          targetResults: input.targets.map((target, index) => index < 2
            ? { ...target, status: 'published', outcome: 'ok', postUrl: index ? bandUrl(target.key) : blogUrl }
            : { ...target, status: 'running' }),
        };
        emit(); return snapshot();
      }
      default: throw Error(`Unexpected fixture command: ${command}`);
    }
  },
};

await mkdir(output, { recursive: true });
const host = { create: async () => { throw Error('No service surfaces'); }, destroy: async () => {}, clearSession: async () => {} };
const core = await startCore({ app, host, uiDir: path.join(build, 'ui') });
let browser;
const errors = [];
const foreign = [];
const screenshots = [];
try {
  browser = await chromium.launch({
    executablePath: process.env.GOLTOU_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  for (const width of [360, 412]) {
    reset();
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === core.origin) return route.continue();
      if (url.hostname === 'goltou.kr' && /^\/wp38\/[0-3]\.png$/.test(url.pathname))
        return route.fulfill({ contentType: 'image/png', body: photos[Number(url.pathname.at(-5))] });
      foreign.push(url.hostname);
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const button = (name, root = page) => root.getByRole('button', { name, exact: true });
    const sheet = page.getByRole('alertdialog');
    const note = async name => {
      await page.evaluate(() => document.fonts.ready);
      const invalid = await page.evaluate(() => {
        const frame = document.querySelector('.sheet') ?? document.documentElement;
        const regions = [frame, ...frame.querySelectorAll('.sheet-scroll,.product-status > span,.band-recent,.today-status th')];
        const clipped = regions.flatMap(el => el.scrollWidth > el.clientWidth + 1 ? [`horizontal overflow: ${el.className || el.textContent}`] : []);
        const wrapped = [...frame.querySelectorAll('.btn,.product-publish,.band-selection button')].flatMap(el => {
          if (!el.getClientRects().length) return [];
          const range = document.createRange();
          const text = [...el.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
          if (!text) return [];
          range.selectNodeContents(text);
          const bounds = range.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          return range.getClientRects().length > 1 || bounds.left < box.left - 1 || bounds.right > box.right + 1 ? [el.textContent] : [];
        });
        return [...clipped, ...wrapped];
      });
      assert.deepEqual(invalid, [], `${name} ${width}`);
      const file = `${width}-${name}.png`;
      await page.screenshot({ path: path.join(output, file), animations: 'disabled' });
      screenshots.push(file);
    };
    await page.goto(core.uiUrl);
    await button('올리기').first().waitFor();
    await note('01-products');
    assert.equal(await button('올리기').first().isEnabled(), true);
    await page.locator('.product-row').first().click();
    await page.locator('.preview-phrase.prefix').first().waitFor();
    await note('02-detail-blog');
    await page.locator('.blog .preview-phrase.closing').scrollIntoViewIfNeeded();
    await note('02b-blog-phrases');
    await page.getByRole('tab', { name: '밴드 모습' }).click();
    await page.locator('.band-full-text').scrollIntoViewIfNeeded();
    await note('03-detail-band');
    await button('← 상품 목록').click();
    await button('올리기').first().click();
    await sheet.getByText('밴드 · 2곳 고름').waitFor();
    assert.equal(await sheet.getByRole('checkbox', { checked: true }).count(), 3);
    assert.ok((await button('3곳에 발행', sheet).boundingBox()).y < 800, 'publish action is below the sheet');
    await note('04-publish');
    const switchBox = await sheet.locator('.text-switch > i').boundingBox();
    const phoneBox = await sheet.locator('.phone-number').boundingBox();
    assert.ok(switchBox && phoneBox && phoneBox.x + phoneBox.width <= switchBox.x, 'phone overlaps switch');
    const footer = await sheet.locator('.sheet-footer').boundingBox();
    assert.ok(footer && phoneBox.y + phoneBox.height <= footer.y, 'publish footer obscures the phone number');
    await sheet.getByRole('checkbox', { name: bands[2].name }).click();
    await sheet.getByRole('checkbox', { name: bands[3].name }).click();
    assert.equal(await button('5곳에 발행', sheet).isDisabled(), true);
    await sheet.locator('.warnline').scrollIntoViewIfNeeded();
    await note('05-limit');
    await sheet.getByRole('checkbox', { name: bands[3].name }).click();
    await button('4곳에 발행', sheet).click();
    assert.equal(calls.filter(call => call.command === 'job.start').length, width === 360 ? 0 : 1);
    await page.getByRole('heading', { name: '이대로 발행할까요?' }).waitFor();
    await button('4곳에 발행', sheet).click();
    await page.getByRole('heading', { name: '밴드 3곳 중 2번째에 올리는 중' }).waitFor();
    assert.equal(state.job.targets.length, fixtureTargets.length);
    await note('06-progress');
    state.job.bandPause = true;
    emit();
    await page.getByRole('heading', { name: '다음 밴드까지 잠시 쉬는 중' }).waitFor();
    await note('07-pause');
    delete state.job.bandPause;
    state.job = { ...state.job, status: 'failed', step: 7, completedSteps: [1, 2, 3, 4, 5, 6, 7] };
    Object.assign(state.job.targetResults[2], { status: 'failed', outcome: 'unconfirmed' });
    Object.assign(state.job.targetResults[3], { status: 'failed', outcome: 'failed', reason: 'PHOTO_DOWNLOAD_FAILED' });
    emit();
    await page.getByRole('heading', { name: '4곳 중 2곳에 올렸습니다' }).waitFor();
    await note('08-result');
    await button('목록으로').click();
    await button('설정').click();
    await note('09-settings');
    await page.setViewportSize({ width, height: 440 });
    const field = page.getByRole('textbox', { name: '글 끝 문구', exact: true });
    await field.fill('예약·문의는 골투 {닉네임} 매니저 {휴대폰} 으로 편하게 연락 주세요.');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('goltou:keyboard', { detail: { visible: true } })));
    const save = button('내 글 문구 저장');
    await page.waitForFunction(() => document.querySelector('.editing-text'));
    const [fieldRect, saveRect] = await Promise.all([field.boundingBox(), save.boundingBox()]);
    assert.ok(fieldRect && saveRect && fieldRect.y >= 0 && fieldRect.y + fieldRect.height < saveRect.y && saveRect.y + saveRect.height <= 440);
    await note('10-settings-keyboard');
    await save.click();
    await page.getByText('내 글 문구를 저장했습니다.').waitFor();
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('goltou:keyboard', { detail: { visible: false } })));
    await button('등록 기록').click();
    await page.getByRole('table', { name: '오늘 현황' }).waitFor();
    await note('11-today');
    await button('상품').click();
    await page.locator('.load-line').waitFor({ state: 'hidden' });
    const back = () => page.evaluate(() => window.dispatchEvent(new Event('goltou:back')));
    await back();
    await page.getByText('한 번 더 누르면 앱을 끝낼지 묻습니다').waitFor();
    await note('12-exit-snackbar');
    await back();
    await page.getByRole('heading', { name: '골투오토를 끝낼까요?' }).waitFor();
    await note('13-exit-dialog');
    await button('끝내기', sheet).click();
    assert.equal(calls.at(-1).input.event, 'finish');
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(foreign, []);
  console.log(`${screenshots.length} screenshots and responsive checks passed\n${screenshots.join('\n')}`);
} finally {
  await browser?.close();
  await core.close();
}
