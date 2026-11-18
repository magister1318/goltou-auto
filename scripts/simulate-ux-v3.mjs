// Synthetic UI/Core only. Every external request is fulfilled locally or aborted.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { startCore, makePreview } = require('../dist/core-api.cjs');
const only = process.argv
  .find((arg) => arg.startsWith('--only='))
  ?.slice(7)
  .split(',');
const out = path.resolve('docs/reports/wp17-ux-v3');
const scratch = path.resolve('tmp/wp17-captures');
mkdirSync(out, { recursive: true });
mkdirSync(scratch, { recursive: true });
// Replace only this script's generated PNGs, inside its fixed report directory.
for (const file of (only ? [] : readdirSync(out)).filter((name) =>
  /^\d+-.*\.png$/.test(name),
))
  unlinkSync(path.join(out, file));
const user = { userNo: 1, name: '화면 시험', userType: 9, role: 'admin' };
const product = {
  productNo: 1,
  title: '화면 검증 예시 · 골프 일정',
  country: '예시',
  region: '시험 지역',
  contentsHtml:
    '<p><b>굵은 안내 문장</b>과 <a href="https://example.invalid/ask">상담 링크</a>를 확인합니다.</p><img width="800" height="500" src="https://goltou.kr/fixture/1.png"><p>두 번째 문단은 원문 순서를 확인합니다.</p><img width="600" height="900" src="https://goltou.kr/fixture/2.png"><table><tr><td>출발일</td><td>일정</td><td>요금</td><td>좌석</td></tr><tr><td>예시 날짜</td><td>예시 일정</td><td>예시 요금</td><td>예시 좌석</td></tr></table>',
  images: Array.from({ length: 13 }, (_, i) => ({
    order: i + 1,
    url: `https://goltou.kr/fixture/${i + 1}.png`,
  })),
  departures: [{ date: '2026-12-03', price: 1190000 }],
  golfCourses: ['예시 골프장'],
  productUrl: 'https://goltou.kr/fixture/product',
  contentHash: 'fixture',
  updatedAt: '',
};
const bands = Array.from({ length: 12 }, (_, i) => ({
  key: String(111 + i),
  name:
    i === 2
      ? '화면 시험 전용 · 긴 이름의 합성 밴드에서 두 줄 표시와 선택 영역을 확인하는 모임'
      : `합성 밴드 ${i + 1}`,
  photoLimit: null,
  observedAt: null,
}));
const initialSettings = {
  closingText: '화면 시험 안내 문구입니다.',
  defaultHashtags: [
    '#화면시험',
    '#합성태그',
    '#긴해시태그값을여러줄로표시합니다',
  ],
  bandDailyLimit: 3,
};
let state,
  listeners = new Set(),
  commands = [],
  mode = {},
  chosen = '111';
product.contentsHtml += product.images
  .slice(2)
  .map((i) => `<img width="800" height="500" src="${i.url}">`)
  .join('');
let preview = makePreview(product, { hashtags: ['화면시험', '합성태그'] });
const polish = {
  notice: '다듬은 문장을 확인해 주세요.',
  paragraphs: [
    {
      id: 'p1',
      original: '안내 문장 입니다.',
      polished: '안내 문장입니다.',
      accepted: true,
      reverted: false,
      sent: true,
      outcome: 'accepted',
      reasons: [],
      elapsedMs: 100,
    },
    {
      id: 'p2',
      original: '원문 그대로인 문단입니다.',
      polished: '원문 그대로인 문단입니다.',
      accepted: true,
      reverted: false,
      sent: true,
      outcome: 'accepted',
      reasons: [],
      elapsedMs: 100,
    },
  ],
};
const basePost = {
  productNo: 1,
  productTitle: '화면 검증 예시',
  channel: 'blog',
  mode: 'publish',
  targetName: '합성 대상',
  userName: '화면 시험',
  startedAt: '2026-11-16T12:00:00+09:00',
  finishedAt: '2026-11-16T12:00:00+09:00',
  failReason: '',
  step: 7,
  productChanged: false,
};
const posts = [
  {
    postNo: 1,
    status: 'published',
    postUrl: 'https://blog.naver.com/synthetic/9001',
    blogVisibility: 'public',
  },
  {
    postNo: 2,
    status: 'published',
    channel: 'band',
    targetName: '합성 밴드 1',
    postUrl: 'https://band.us/band/111/post/9001',
  },
  { postNo: 3, status: 'draft_saved', mode: 'draft', postUrl: '' },
  {
    postNo: 4,
    status: 'failed',
    failReason: 'PHOTO_DOWNLOAD_FAILED',
    postUrl: '',
  },
  {
    postNo: 5,
    status: 'failed',
    channel: 'band',
    failReason: 'BAND_POST_UNCONFIRMED',
    postUrl: '',
  },
  {
    postNo: 6,
    status: 'stopped',
    failReason: 'BLOG_POST_DELETED',
    postUrl: '',
  },
].map((p) => ({ ...basePost, ...p }));
const reset = (signedIn = true) => {
  mode = {};
  state = {
    user: signedIn ? user : null,
    settings: structuredClone(initialSettings),
    services: { naver: 'confirmed', band: 'confirmed', ai: 'unknown' },
    visibleService: null,
    job: null,
    simulation: { tickMs: 100, loginAt: null, failAt: null },
  };
  preview = makePreview(product, { hashtags: ['화면시험', '합성태그'] });
};
const snapshot = () => structuredClone(state),
  emit = () => {
    for (const listener of listeners) listener(snapshot());
  };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const job = (status = 'running') => ({
  id: 1,
  productNo: 1,
  title: product.title,
  mode: 'publish',
  status,
  step: 4,
  current: 0,
  total: 13,
  completedSteps: [1, 2, 3],
  startedAt: Date.now() - 10000,
  service: null,
  message: '',
  blogVisibility: 'public',
  targets: [
    { channel: 'blog', key: 'blog', name: '합성 블로그' },
    { channel: 'band', key: '111', name: '합성 밴드 1' },
  ],
  targetResults: [
    { channel: 'blog', key: 'blog', name: '합성 블로그', status: 'running' },
    { channel: 'band', key: '111', name: '합성 밴드 1', status: 'running' },
  ],
  activityLog: [],
});
const app = {
  snapshot,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  dispose() {},
  async handle({ command, input }) {
    commands.push(command);
    if (command === 'session.get') return snapshot();
    if (command === 'preferences.get')
      return {
        polish: false,
        closing: false,
        linkCard: false,
        lastBandKeys: chosen ? [chosen] : [],
      };
    if (command === 'preferences.save') {
      chosen = input.lastBandKeys[0] ?? '';
      return input;
    }
    if (command === 'polish.setting.get' || command === 'polish.setting.save')
      return input.strength ?? 'spelling';
    if (command === 'login') {
      if (mode.login === 'busy') await new Promise(() => {});
      throw Error(
        mode.login === 'off'
          ? '인터넷에 연결되지 않아 로그인하지 못했습니다.'
          : '아이디 또는 비밀번호가 맞지 않습니다. 비밀번호를 다시 입력해 주세요.',
      );
    }
    if (command === 'products.list') {
      if (mode.home === 'loading' || mode.home === 'searching')
        await new Promise(() => {});
      if (mode.home === 'err') throw Error('상품을 불러오지 못했습니다.');
      if (['none', 'empty'].includes(mode.home)) return { total: 0, items: [] };
      return {
        total: 3,
        items: [1, 2, 3].map((n) => ({
          productNo: n,
          title: n === 1 ? product.title : `화면 검증 예시 ${n}`,
          country: '예시',
          region: '시험 지역',
          thumbUrl: product.images[n - 1].url,
          priceFrom: n === 3 ? 0 : 1190000,
          departureCount: n === 3 ? 0 : 2,
          updatedAt: '',
          myPosts: { blog: null, band: null },
        })),
      };
    }
    if (command === 'products.get') return structuredClone(product);
    if (command === 'preview.prepare') {
      if (mode.product === 'err') throw Error('상품 내용을 읽지 못했습니다.');
      return {
        ...structuredClone(preview),
        ...(input.options.polish ? { polish: structuredClone(polish) } : {}),
      };
    }
    if (command === 'preview.revert') {
      polish.paragraphs.find((p) => p.id === input.paragraphId).reverted = true;
      return { ...structuredClone(preview), polish: structuredClone(polish) };
    }
    if (command === 'job.preview') return structuredClone(preview);
    if (command === 'bands.list') {
      if (mode.band === 'loading') await new Promise(() => {});
      if (mode.band === 'err') throw Error('목록 읽기 실패');
      return mode.band === 'empty'
        ? []
        : structuredClone(bands.slice(0, mode.band === 'many' ? 12 : 3));
    }
    if (command === 'posts.list') {
      if (mode.history === 'err') throw Error('기록 읽기 실패');
      return {
        total: mode.history === 'empty' ? 0 : posts.length,
        items: mode.history === 'empty' ? [] : structuredClone(posts),
      };
    }
    if (command === 'posts.delete.prepare') {
      if (mode.history === 'delprep') throw Error('삭제 준비 실패');
      return { confirmation: 'fixture-only', productTitle: '화면 검증 예시' };
    }
    if (command === 'posts.delete.confirm') {
      state.postDeletion = {
        postNo: 1,
        verifiedGone: false,
        recorded: false,
        outcome: 'uncertain',
      };
      emit();
      return snapshot();
    }
    if (command === 'job.start') {
      if (mode.changed)
        throw Error('상품이 바뀌었습니다. 내용을 다시 확인해 주세요.');
      state.job = {
        ...job(),
        mode: input.mode,
        targets: input.targets,
        targetResults: input.targets.map((t) => ({ ...t, status: 'running' })),
      };
    }
    if (command === 'job.recovery')
      state.job.status = input.discard ? 'running' : 'stopped';
    if (command === 'job.dialog') {
      state.job.status = 'running';
      delete state.job.dialog;
    }
    if (command === 'job.cancel') state.job.status = 'stopped';
    if (command === 'job.resume') state.job.status = 'running';
    if (command === 'service.show') state.visibleService = input.service;
    if (command === 'service.hide') state.visibleService = null;
    if (command === 'service.check') state.services[input.service] = 'checking';
    if (command === 'settings.save') state.settings = structuredClone(input);
    emit();
    return snapshot();
  },
};
reset();
const core = await startCore({
  app,
  host: {
    create: async () => {
      throw Error('No service surfaces in simulator');
    },
    destroy: async () => {},
    clearSession: async () => {},
  },
  diagnostics: true,
  uiDir: path.resolve('dist/ui'),
});
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 780 },
  reducedMotion: 'reduce',
});
let external = 0,
  errors = [],
  checks = 0;
await context.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (u.hostname === '127.0.0.1' || u.protocol === 'file:')
    return route.continue();
  if (u.hostname === 'goltou.kr' && u.pathname.startsWith('/fixture/')) {
    if (mode.product === 'wait' && u.pathname.endsWith('/1.png')) return;
    if (mode.product === 'wait' && u.pathname.endsWith('/2.png'))
      return route.abort();
    return route.fulfill({
      contentType: 'image/png',
      body: readFileSync('packages/sites/fixtures/sample-1.png'),
    });
  }
  external++;
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(10000);
page.on('pageerror', (e) => errors.push(e.message));
const mock = await context.newPage();
await mock.setViewportSize({ width: 1120, height: 1080 });
await mock.goto(pathToFileURL(path.resolve('docs/design/ux-v3.html')).href);
const comparison = await context.newPage();
await comparison.setViewportSize({ width: 800, height: 830 });
const manifest = [];
async function fresh(signedIn = true, configure = () => {}) {
  console.log('scene reset');
  reset(signedIn);
  configure();
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(core.uiUrl);
  await page
    .getByRole(signedIn ? 'heading' : 'button', {
      name: signedIn ? /옮길 상품을/ : '로그인',
      exact: !signedIn,
    })
    .waitFor();
}
async function nav(label) {
  await page
    .getByRole('navigation', { name: '아래 탭' })
    .getByRole('button', { name: label, exact: true })
    .click();
}
async function choose() {
  await page.locator('.product-row').first().click();
  await page.getByRole('tab', { name: '블로그에 올라갈 모습' }).waitFor();
  if (mode.product !== 'err')
    await page.waitForFunction(
      () => !document.querySelector('.bar .btn')?.disabled,
    );
}
async function publish() {
  await page.getByRole('button', { name: /^발행.*바로 공개됨/ }).click();
  await page.getByRole('heading', { name: '발행', exact: true }).waitFor();
}
async function bandOn() {
  await page.getByRole('checkbox', { name: /네이버 밴드/ }).click();
}
async function setJob(value) {
  state.job = job();
  emit();
  await page.getByRole('button', { name: '진행하던 작업 보기' }).click();
  await page.locator('.screen-progress').waitFor();
  state.job = value;
  emit();
  await delay(100);
}
async function capture(id, screen, variant = null, sheet = null) {
  if (only && !only.includes(id)) {
    manifest.push({ id, screen, variant, sheet });
    return;
  }
  await page.evaluate(() => document.fonts.ready);
  await mock.locator(`[data-jump="${screen}"]`).click();
  if (variant)
    await mock.locator(`#states [data-st="${screen}:${variant}"]`).click();
  if (sheet) await mock.locator(`[data-sj="${sheet}"]`).click();
  if (id.includes('table-scroll'))
    await mock.locator('.tblw').scrollIntoViewIfNeeded();
  if (id.includes('tag-bottom'))
    await mock.locator('.tagbox').scrollIntoViewIfNeeded();
  if (id.includes('photo-grid'))
    await mock.locator('.bgrid').scrollIntoViewIfNeeded();
  if (id.includes('photo-failed'))
    await mock.locator('.failp').scrollIntoViewIfNeeded();
  await mock
    .locator('#phone')
    .screenshot({ path: path.join(scratch, 'mock.png') });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    `${id}: horizontal page overflow`,
  );
  const undersized = await page
    .locator('button,input,textarea,summary')
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return (
            n.getClientRects().length &&
            !n.closest('[inert]') &&
            (r.height < 47.9 || r.width < 47.9)
          );
        })
        .map((n) => n.getAttribute('aria-label') || n.textContent),
    );
  assert.deepEqual(undersized, [], `${id}: targets under 48dp`);
  await page.screenshot({
    path: path.join(scratch, 'app.png'),
    animations: 'disabled',
  });
  const data = (f) =>
    'data:image/png;base64,' +
    readFileSync(path.join(scratch, f)).toString('base64');
  await comparison.setContent(
    `<body style="margin:0;background:#eef1ee;font:14px sans-serif"><div style="display:flex;gap:10px;padding:5px"><div>구현 · ${id}<br><div style="height:780px;background:#d7d9de"><img width="390" height="${page.viewportSize().height}" src="${data('app.png')}"></div></div><div>목업 · ${screen}/${variant || sheet || '기본'}<br><img width="390" height="780" src="${data('mock.png')}"></div></div></body>`,
  );
  await comparison.screenshot({
    path: path.join(
      out,
      `${String(manifest.length + 1).padStart(2, '0')}-${id}.png`,
    ),
  });
  manifest.push({ id, screen, variant, sheet });
  checks++;
  console.log('captured ' + id);
}
try {
  // Every mock jump and state button, followed by every sheet jump.
  for (const variant of ['ok', 'empty', 'wrong', 'off', 'busy']) {
    await fresh(false, () => {
      mode.login = variant;
    });
    if (variant === 'empty')
      await page.getByRole('button', { name: '로그인', exact: true }).click();
    if (['wrong', 'off', 'busy'].includes(variant)) {
      await page.getByLabel('아이디', { exact: true }).fill('화면시험');
      await page.getByLabel('비밀번호', { exact: true }).fill('synthetic-only');
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      if (variant !== 'busy') await page.getByRole('alert').waitFor();
      assert.equal(
        await page.getByLabel('아이디', { exact: true }).inputValue(),
        '화면시험',
      );
    }
    await capture('login-' + variant, 'login', variant);
  }
  for (const variant of [
    'ok',
    'loading',
    'searching',
    'none',
    'empty',
    'err',
  ]) {
    await fresh(true, () => {
      if (variant !== 'searching') mode.home = variant;
    });
    if (variant === 'searching') {
      await page.locator('.product-row').first().waitFor();
      mode.home = 'searching';
      await page.getByLabel('상품 검색').fill('예시');
      await page.locator('.load-line').waitFor();
    }
    if (variant === 'none') {
      await page.getByLabel('상품 검색').fill('없는 예시');
      await delay(200);
    }
    if (variant === 'empty') {
      await page.getByRole('tab', { name: /안 올린 상품/ }).click();
      await delay(200);
    }
    if (variant === 'ok') await page.locator('.product-row').first().waitFor();
    if (variant === 'err') await page.getByRole('alert').first().waitFor();
    await capture('home-' + variant, 'home', variant);
  }
  for (const variant of ['blog', 'band', 'wait', 'err']) {
    await fresh(true, () => {
      mode.product = variant;
    });
    await choose();
    if (variant === 'band')
      await page.getByRole('tab', { name: '밴드에 올라갈 모습' }).click();
    if (variant === 'err')
      await page
        .getByRole('button', { name: '다시 불러오기', exact: true })
        .waitFor();
    await capture('product-' + variant, 'product', variant);
    if (variant === 'blog') {
      await page.locator('.table-scroll').first().scrollIntoViewIfNeeded();
      await capture('product-table-scroll', 'product', 'blog');
      await page.locator('.tag-box').scrollIntoViewIfNeeded();
      await capture('product-tag-bottom', 'product', 'blog');
    }
    if (variant === 'band') {
      await page.locator('.band-photo-grid').scrollIntoViewIfNeeded();
      await capture('product-photo-grid', 'product', 'band');
    }
    if (variant === 'wait') {
      await page.locator('.preview-photos').nth(1).scrollIntoViewIfNeeded();
      await capture('product-photo-failed', 'product', 'wait');
    }
  }
  console.log('polish flow');
  await fresh();
  await choose();
  console.log('polish settings');
  await page.locator('.option-summary').click();
  await page.getByRole('switch', { name: '문장 다듬기', exact: true }).click();
  await page.getByRole('button', { name: '미리보기로 돌아가기' }).click();
  console.log('polish preview');
  await page.waitForFunction(
    () => !document.querySelector('.bar .btn')?.disabled,
  );
  await publish();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '발행하기', exact: true }).click();
  await page
    .getByRole('heading', { name: '다듬은 문장을 확인하세요' })
    .waitFor();
  await capture('polish', 'polish');
  await fresh();
  await setJob(job());
  await capture('progress', 'progress');
  for (const variant of [
    'done',
    'draft',
    'uncertain',
    'recfail',
    'paused',
    'relogin',
    'fail',
  ]) {
    await fresh();
    const j = job(
      {
        done: 'published',
        draft: 'draft_saved',
        uncertain: 'failed',
        recfail: 'record_failed',
        paused: 'user_paused',
        relogin: 'login_paused',
        fail: 'failed',
      }[variant],
    );
    if (['done', 'recfail', 'uncertain'].includes(variant)) {
      j.targetResults[0].status = 'published';
      j.targetResults[0].postUrl = 'https://blog.naver.com/synthetic/9001';
      j.targetResults[1].status =
        variant === 'uncertain' ? 'failed' : 'published';
    }
    if (variant === 'draft') {
      j.mode = 'draft';
      j.targets = j.targets.slice(0, 1);
      j.targetResults = j.targetResults.slice(0, 1);
      j.targetResults[0].status = 'draft_saved';
    }
    if (variant === 'uncertain') {
      j.step = 6;
      j.activeTargetKey = '111';
      j.publicationUncertain = true;
      j.failureCode = 'BAND_POST_UNCONFIRMED';
    }
    if (variant === 'relogin') {
      j.service = 'naver';
    }
    if (variant === 'fail') {
      j.targetResults[0].status = 'failed';
      j.failureCode = 'PHOTO_DOWNLOAD_FAILED';
    }
    await setJob(j);
    await capture('result-' + variant, 'result', variant);
  }
  for (const variant of ['ok', 'need', 'checking', 'unknown']) {
    await fresh(true, () => {
      const v = {
        ok: 'confirmed',
        need: 'expired',
        checking: 'checking',
        unknown: 'unknown',
      }[variant];
      state.services.naver = v;
      state.services.band = v;
    });
    await page.locator('.connections button').first().click();
    await capture('connect-' + variant, 'connect', variant);
  }
  await fresh(true, () => {
    state.services.naver = 'expired';
  });
  await page.locator('.connections button').first().click();
  await page
    .getByRole('button', { name: '로그인', exact: true })
    .first()
    .click();
  await capture('svc', 'svc');
  assert.equal(commands.at(-1), 'service.show');
  for (const variant of ['ok', 'empty', 'err', 'delprep', 'delq']) {
    await fresh(true, () => {
      mode.history = variant;
    });
    await nav('등록 기록');
    if (variant === 'err') await page.getByRole('alert').waitFor();
    else if (variant !== 'empty')
      await page.locator('.history-row').first().waitFor();
    if (variant === 'delprep')
      await page
        .getByRole('button', { name: '글 삭제', exact: true })
        .first()
        .click();
    if (variant === 'delq') {
      await page
        .getByRole('button', { name: '글 삭제', exact: true })
        .first()
        .click();
      await page.getByRole('button', { name: '삭제', exact: true }).click();
    }
    if (['delprep', 'delq'].includes(variant))
      await page.locator('.row-error').waitFor();
    await capture('history-' + variant, 'history', variant);
  }
  for (const variant of ['view', 'typing', 'unsaved']) {
    await fresh();
    await nav('설정');
    if (variant !== 'view')
      await page
        .getByLabel('기본 해시태그 (쉼표 또는 띄어쓰기로 구분)', {
          exact: true,
        })
        .fill('#화면시험 #변경');
    if (variant === 'typing') {
      await page.setViewportSize({ width: 390, height: 480 });
      await page.evaluate(() =>
        window.dispatchEvent(new Event('goltou:keyboard')),
      );
      await delay(350);
      assert.equal(await page.locator('.bottom-nav').count(), 0);
    } else
      await page.getByRole('heading', { name: '설정', exact: true }).click();
    await capture('settings-' + variant, 'settings', variant);
  }
  const sheetNames = [
    'draft',
    'publish',
    'bands',
    'bandsMany',
    'pubNone',
    'pubLoading',
    'pubEmpty',
    'pubErr',
    'confirm',
    'stop',
    'unfinished',
    'changed',
    'dialog',
    'delBlog',
    'delBand',
    'leave',
  ];
  for (const name of sheetNames) {
    await fresh(true, () => {
      if (['pubLoading', 'pubEmpty', 'pubErr', 'bandsMany'].includes(name))
        mode.band = {
          pubLoading: 'loading',
          pubEmpty: 'empty',
          pubErr: 'err',
          bandsMany: 'many',
        }[name];
      if (name === 'pubNone') chosen = '';
    });
    let screen = 'product',
      variant = 'blog';
    if (['delBlog', 'delBand'].includes(name)) {
      screen = 'history';
      variant = 'ok';
      await nav('등록 기록');
      await page
        .getByRole('button', { name: '글 삭제', exact: true })
        .nth(name === 'delBand' ? 1 : 0)
        .click();
    } else if (name === 'leave') {
      screen = 'settings';
      variant = 'unsaved';
      await nav('설정');
      await page
        .getByLabel('기본 해시태그 (쉼표 또는 띄어쓰기로 구분)', {
          exact: true,
        })
        .fill('#변경');
      await page.getByRole('heading', { name: '설정', exact: true }).click();
      await nav('상품');
    } else if (['stop', 'unfinished', 'dialog'].includes(name)) {
      const j = job(
        name === 'unfinished'
          ? 'recovery_paused'
          : name === 'dialog'
            ? 'dialog_paused'
            : 'running',
      );
      if (name === 'unfinished')
        j.failureCode = 'AUTO_RECOVER_CONSENT_REQUIRED';
      if (name === 'dialog') {
        j.service = 'naver';
        j.dialog = {
          id: 'synthetic',
          kind: 'confirm',
          message: '합성 서비스 요청 문장을 그대로 보여 줍니다.',
        };
      }
      await setJob(j);
      if (name === 'stop')
        await page.getByRole('button', { name: '중단', exact: true }).click();
      screen =
        name === 'dialog' ? 'result' : name === 'stop' ? 'progress' : 'product';
      variant =
        name === 'dialog' ? 'paused' : name === 'unfinished' ? 'blog' : null;
    } else {
      await choose();
      if (name === 'draft')
        await page
          .getByRole('button', { name: /임시저장.*공개되지 않음/ })
          .click();
      else if (name === 'changed') {
        mode.changed = true;
        await publish();
        await page.getByRole('button', { name: '다음', exact: true }).click();
        await page
          .getByRole('button', { name: '발행하기', exact: true })
          .click();
        await page
          .getByRole('heading', { name: '상품 내용이 바뀌었습니다' })
          .waitFor();
      } else {
        await publish();
        if (
          [
            'bands',
            'bandsMany',
            'pubNone',
            'pubLoading',
            'pubEmpty',
            'pubErr',
          ].includes(name)
        ) {
          await bandOn();
          if (['bands', 'bandsMany'].includes(name)) {
            await page
              .getByRole('button', { name: /올릴 밴드.*바꾸기/ })
              .click();
          }
          if (['pubEmpty', 'pubErr'].includes(name))
            await page
              .getByRole('button', { name: '다시 읽기', exact: true })
              .waitFor();
        }
        if (name === 'confirm') {
          await page.getByRole('button', { name: '다음', exact: true }).click();
        }
      }
    }
    await capture('sheet-' + name, screen, variant, name);
    if (['unfinished', 'changed'].includes(name)) {
      const before = commands.length;
      await page.evaluate(() => window.dispatchEvent(new Event('goltou:back')));
      await page.locator('.dim').click({ position: { x: 5, y: 5 } });
      assert.equal(commands.length, before);
      assert.equal(await page.locator('.sheet').count(), 1);
      checks++;
    }
    if (['pubLoading', 'pubEmpty', 'pubErr'].includes(name)) {
      await bandOn();
      assert.equal(
        await page
          .getByRole('button', { name: '다음', exact: true })
          .isEnabled(),
        true,
      );
      checks++;
    }
    if (name === 'bands') {
      await page
        .getByRole('radio', { name: '합성 밴드 2', exact: true })
        .click();
      await page
        .getByRole('button', { name: /올릴 밴드.*합성 밴드 2/ })
        .waitFor();
      for (let retry = 0; retry < 20 && chosen !== '112'; retry++)
        await delay(20);
      assert.equal(chosen, '112');
      await fresh();
      await choose();
      await publish();
      await bandOn();
      await page
        .getByRole('button', { name: /올릴 밴드.*합성 밴드 2/ })
        .waitFor();
      checks++;
    }
    if (name === 'bandsMany') {
      const before = chosen;
      await page.evaluate(() => window.dispatchEvent(new Event('goltou:back')));
      assert.equal(chosen, before);
      await page.getByRole('heading', { name: '발행', exact: true }).waitFor();
      checks++;
    }
  }
  // Alias captures cover each screen jump as well as its explicit default state.
  for (const [id, screen, variant] of [
    ['login', 'login', 'ok'],
    ['home', 'home', 'ok'],
    ['product', 'product', 'blog'],
    ['result', 'result', 'done'],
    ['connect', 'connect', 'ok'],
    ['history', 'history', 'ok'],
    ['settings', 'settings', 'view'],
  ]) {
    const entry = manifest.find(
      (x) => x.screen === screen && x.variant === variant && !x.sheet,
    );
    manifest.push({ id, alias: entry.id, screen, variant });
  }
  await fresh();
  const alertJob = job('dialog_paused');
  alertJob.service = 'band';
  alertJob.dialog = {
    id: 'synthetic-alert',
    kind: 'alert',
    message: '합성 알림 문장을 그대로 보여 줍니다.',
  };
  await setJob(alertJob);
  assert.equal(await page.locator('.sheet .acts button').count(), 1);
  await capture('dialog-alert', 'result', 'paused', 'dialog');
  checks++;
  await fresh();
  await nav('설정');
  await page.getByLabel(/밴드 하루 한도/).fill('0');
  await page
    .getByRole('button', { name: '공통 설정 저장', exact: true })
    .click();
  await page.locator('#band-limit-hint').scrollIntoViewIfNeeded();
  await capture('settings-range-error', 'settings', 'unsaved');
  checks++;
  assert.deepEqual(errors, []);
  assert.equal(
    commands.filter((c) => ['post.open', 'service.clear', 'logout'].includes(c))
      .length,
    0,
  );
  // These commands reach only the injected local Core fixture; no real engine exists here.
  if (!only)
    writeFileSync(
      path.join(out, 'checks.json'),
      JSON.stringify(
        {
          captures: manifest.filter((x) => !x.alias).length,
          coveredMockEntries: 60,
          additionalCaptures: 6,
          checks,
          pageErrors: errors.length,
          externalRequestsAllowed: 0,
          blockedExternalRequests: external,
          device:
            'not inspected beyond read-only power check; screen was dozing',
          manifest,
        },
        null,
        2,
      ),
    );
  console.log(
    JSON.stringify({
      captures: manifest.filter((x) => !x.alias).length,
      coveredMockEntries: 60,
      additionalCaptures: 6,
      checks,
      errors: errors.length,
      externalRequestsAllowed: 0,
    }),
  );
} catch (error) {
  console.error(error);
  await page
    .screenshot({ path: path.join(scratch, 'failure.png'), timeout: 5000 })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await core.close();
}
