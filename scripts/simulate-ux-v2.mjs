// Local UI fixtures only. No service session, credential, external request or device input.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { startCore, makePreview } = require('../dist/core-api.cjs');
const out = path.resolve('docs/reports/wp16-ux-v2/simulator');
mkdirSync(out, { recursive: true });
const user = { userNo: 1, name: '화면 시험', userType: 9, role: 'admin' };
const product = {
  productNo: 1,
  title:
    '화면 검증 예시 · 긴 제목에서도 사진과 버튼이 겹치지 않는지 확인하는 일정',
  country: '예시',
  region: '시험 지역',
  contentsHtml:
    '<p>첫 번째 예시 문단입니다. 화면에 들어가는 순서를 확인합니다.</p><img src="https://goltou.kr/fixture/1.png"><p>두 번째 예시 문단입니다. 가격과 날짜는 제공된 값으로 표시합니다.</p><img src="https://goltou.kr/fixture/2.png">',
  images: [1, 2].map((order) => ({
    order,
    url: `https://goltou.kr/fixture/${order}.png`,
  })),
  departures: [{ date: '2026-12-01', price: 1000000 }],
  golfCourses: ['예시 골프장'],
  productUrl: 'https://goltou.kr/fixture/product',
  contentHash: 'ui-fixture',
  updatedAt: '2026-11-14',
};
const options = { polish: false, closing: false, linkCard: false };
let bandReadMode = 'ok';
const preview = makePreview(product, { hashtags: ['화면시험'] });
const posts = [
  {
    postNo: 1,
    status: 'published',
    mode: 'publish',
    postUrl: 'https://blog.naver.com/fixture/1',
  },
  { postNo: 2, status: 'draft_saved', mode: 'draft', postUrl: '' },
  { postNo: 3, status: 'failed', mode: 'draft', postUrl: '' },
  {
    postNo: 4,
    status: 'stopped',
    mode: 'publish',
    postUrl: '',
    failReason: 'BLOG_POST_DELETED',
  },
].map((p) => ({
  productNo: 1,
  productTitle: '화면 검증 예시',
  channel: 'blog',
  targetName: '시험 대상',
  userName: user.name,
  startedAt: '2026-11-14T12:00:00+09:00',
  finishedAt: '2026-11-14T12:00:00+09:00',
  failReason: '',
  step: 7,
  productChanged: false,
  ...p,
}));
let state,
  listeners = new Set(),
  commands = [],
  now = Date.now();
const reset = (signedIn = true) => {
  state = {
    user: signedIn ? user : null,
    settings: {
      closingText: '',
      defaultHashtags: ['#화면시험'],
      bandDailyLimit: 3,
    },
    services: { naver: 'confirmed', band: 'expired', ai: 'expired' },
    visibleService: null,
    job: null,
    simulation: { tickMs: 100, loginAt: null, failAt: null },
  };
};
const emit = () => {
  for (const listener of listeners) listener(structuredClone(state));
};
const snapshot = () => structuredClone(state);
const baseJob = (mode = 'draft') => ({
  id: 1,
  productNo: 1,
  title: product.title,
  mode,
  status: 'running',
  step: 4,
  current: 0,
  total: 2,
  completedSteps: [1, 2, 3],
  startedAt: now - 10000,
  service: null,
  message: '',
  targets: [{ channel: 'blog', key: 'fixture', name: '시험 대상' }],
  targetResults: [
    { channel: 'blog', key: 'fixture', name: '시험 대상', status: 'running' },
  ],
  activityLog: [],
});
function activity(value) {
  const a = { channel: 'blog', at: Date.now(), ...value };
  state.job.activity = a;
  state.job.activityLog.push(a);
}
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
    if (command === 'preferences.get') return { polish: false, closing: false, linkCard: false, lastBandKey: '' };
    if (command === 'preferences.save') return input;
    if (command === 'polish.setting.get' || command === 'polish.setting.save')
      return 'spelling';
    if (command === 'products.list') {
      const items =
        input.q && !product.title.includes(input.q)
          ? []
          : [
              {
                productNo: 1,
                title: product.title,
                country: product.country,
                region: product.region,
                thumbUrl: product.images[0].url,
                priceFrom: 1000000,
                departureCount: 1,
                myPosts: { blog: null, band: null },
              },
            ];
      return { total: items.length, items };
    }
    if (command === 'products.get') return structuredClone(product);
    if (command === 'preview.prepare' || command === 'job.preview')
      return structuredClone(preview);
    if (command === 'bands.list') {
      if(bandReadMode==='failure') throw Error('BAND_READ_UNAVAILABLE');
      if(bandReadMode==='loading') await new Promise(r=>setTimeout(r,1500));
      return [
        {
          key: 'fixture',
          name: '시험 대상',
          photoLimit: null,
          observedAt: null,
        },
      ];
    }
    if (command === 'posts.list')
      return { total: posts.length, items: structuredClone(posts) };
    if (command === 'posts.delete.prepare')
      return { confirmation: 'fixture-only', productTitle: '화면 검증 예시' };
    if (command === 'posts.delete.confirm')
      throw Error('UI simulator never deletes');
    if (command === 'job.start') {
      state.job = {
        ...baseJob(input.mode),
        targets: input.targets,
        targetResults: input.targets.map((t) => ({ ...t, status: 'running' })),
      };
      activity({ stage: 'open', phase: 'start' });
    }
    if (command === 'job.cancel') state.job.status = 'stopped';
    if (command === 'job.resume') state.job.status = 'running';
    if (command === 'job.recovery') {
      state.job.status = input.discard ? 'running' : 'stopped';
      if(!input.discard) state.job.targetResults.forEach(t=>t.status='stopped');
      delete state.job.failureCode;
    }
    if (command === 'service.show') state.visibleService = input.service;
    if (command === 'service.hide') state.visibleService = null;
    if (command === 'service.check')
      state.services[input.service] = 'confirmed';
    if (command === 'service.clear') state.services[input.service] = 'expired';
    if (command === 'logout') state.user = null;
    if (command === 'settings.save') state.settings = input;
    emit();
    return snapshot();
  },
};
const host = {
  create: async () => {
    throw Error('UI fixture has no service surfaces');
  },
  destroy: async () => {},
  clearSession: async () => {},
};
reset();
const core = await startCore({
  app,
  host,
  diagnostics: true,
  uiDir: path.resolve('dist/ui'),
});
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: !process.argv.includes('--interactive'),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: 'reduce',
});
let external = 0,
  errors = [],
  checks = 0;
const photo = readFileSync('packages/sites/fixtures/sample-1.png');
await context.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (u.hostname === '127.0.0.1') return route.continue();
  if (u.hostname === 'goltou.kr' && u.pathname.startsWith('/fixture/'))
    return route.fulfill({ contentType: 'image/png', body: photo });
  external++;
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
async function scene(signedIn = true) {
  reset(signedIn);
  await page.goto(core.uiUrl);
  await page
    .getByRole(signedIn ? 'heading' : 'button', {
      name: signedIn ? /옮길 상품을/ : '로그인',
      exact: !signedIn,
    })
    .waitFor();
}
async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    `${name}: overflow`,
  );
  const small = await page
    .locator('button,input,select,textarea')
    .evaluateAll((nodes) =>
      nodes
        .filter(
          (n) =>
            n.getClientRects().length &&
            !n.closest('[inert]') &&
            n.getBoundingClientRect().height < 43.9,
        )
        .map((n) => n.getAttribute('aria-label') || n.textContent),
    );
  assert.deepEqual(small, [], `${name}: touch size`);
  await page.screenshot({
    path: path.join(out, `${name}.png`),
    animations: 'disabled',
  });
  checks++;
}
async function choose() {
  await page.locator('.product-row').first().click();
  await page.getByRole('tab', { name: '블로그에 올라갈 모습' }).waitFor();
  await page
    .getByRole('button', { name: /임시저장.*공개되지 않음/ })
    .waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !document.querySelector('.bar .btn').disabled,
  );
}
async function sheet(name) {
  await page
    .getByRole('button', {
      name: name === 'draft' ? /임시저장.*공개되지 않음/ : /발행.*바로 공개됨/,
    })
    .click();
}
try {
  if (process.argv.includes('--interactive')) {
    await page.goto(core.uiUrl);
    console.log('로컬 화면 예시를 열었습니다. 실제 서비스 요청은 차단됩니다. Ctrl+C로 종료합니다.');
    await new Promise(resolve => process.once('SIGINT', resolve));
    process.exitCode = 0;
  } else {
  await scene(false);
  await shot('01-login');
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await scene();
    await page.locator('.product-row').waitFor();
    await shot(`02-home-${width}`);
    await choose();
    await shot(`03-preview-blog-${width}`);
    await page.getByRole('tab', { name: '밴드에 올라갈 모습' }).click();
    await shot(`04-preview-band-${width}`);
    await sheet('draft');
    await shot(`05-draft-sheet-${width}`);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await sheet('publish');
    await shot(`06-publish-login-sheet-${width}`);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await shot(`07-confirm-sheet-${width}`);
    await page.getByRole('button', { name: '뒤로', exact: true }).click();
    await page.getByRole('button', { name: '취소', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  state.services.band = 'confirmed';
  emit();
  bandReadMode='loading';
  await sheet('publish');
  await page.getByText('내 밴드를 확인하는 중',{exact:true}).waitFor();
  await shot('08a-band-loading');
  await page.getByRole('checkbox', { name: /네이버 밴드/ }).waitFor();
  await page.waitForFunction(
    () => ![...document.querySelectorAll('[role=checkbox]')].at(-1).disabled,
  );
  await page.getByRole('checkbox', { name: /네이버 밴드/ }).click();
  assert.equal(await page.locator('.sheet select').inputValue(), 'fixture');
  await shot('08-publish-band-sheet');
  await page.getByRole('radio', { name: '비공개', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await shot('09-confirm-band-private');
  assert(!commands.includes('job.start'));
  bandReadMode='failure';
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  await page.locator('.inline-feedback').waitFor();
  await shot('09a-band-read-failure');
  assert.equal(await page.locator('.error').count(),0);
  assert.equal(await page.locator('.inline-feedback p').textContent(),'밴드 목록을 확인하지 못했습니다.');
  bandReadMode='ok';
  await page.getByRole('button',{name:'다시 확인',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.inline-feedback')&&![...document.querySelectorAll('[role=checkbox]')].at(-1).disabled);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await sheet('draft');
  await page
    .getByRole('button', { name: '블로그에 임시저장', exact: true })
    .click();
  await page.getByRole('heading', { name: /글쓰기 화면/ }).waitFor();
  assert.deepEqual(
    state.job.targets.map((t) => t.channel),
    ['blog'],
  );
  await shot('10-progress-open');
  state.job.status='recovery_paused'; state.job.failureCode='AUTO_RECOVER_CONSENT_REQUIRED'; emit();
  await page.getByRole('alertdialog',{name:'네이버에 쓰다 만 글이 있습니다'}).waitFor();
  await shot('10a-recovery-sheet');
  assert.equal(await page.getByRole('heading',{name:'끝까지 옮기지 못했습니다'}).count(),0);
  await page.getByRole('button',{name:'버리고 새로 쓰기',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.sheet'));
  assert.equal(state.job.id,1);
  state.job.status='recovery_paused'; state.job.failureCode='AUTO_RECOVER_CONSENT_REQUIRED'; emit();
  await page.getByRole('alertdialog').waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event('goltou:back')));
  await page.getByRole('heading',{name:'옮기기를 중단했습니다',exact:true}).waitFor();
  await shot('10b-recovery-cancelled');
  state.job.status='running';state.job.targetResults[0].status='running';emit();
  const plan = preview.blog;
  let photoIndex = 0;
  for (const [index, step] of plan.steps.entries()) {
    if (step.kind === 'break') continue;
    const kind =
      step.kind === 'photos'
        ? 'photos'
        : step.kind === 'table'
          ? 'table'
          : step.role === 'title'
            ? 'title'
            : step.role === 'hashtags'
              ? 'tags'
              : 'paragraph';
    if (step.kind === 'photos') {
      for (const _ of step.urls) {
        activity({
          stage: 'write',
          phase: 'start',
          blockKind: kind,
          blockIndex: index,
          blockTotal: plan.steps.length,
          photoIndex,
          photoTotal: 2,
          fraction: 0.35,
        });
        emit();
        await shot(`12-progress-photo-${photoIndex + 1}`);
        activity({ ...state.job.activity, phase: 'finish', fraction: 1 });
        photoIndex++;
      }
    } else {
      activity({
        stage: 'write',
        phase: 'progress',
        blockKind: kind,
        blockIndex: index,
        blockTotal: plan.steps.length,
        fraction: 0.5,
      });
      emit();
      if (kind === 'title' || kind === 'paragraph')
        await shot(`11-progress-${kind}-${index}`);
      activity({ ...state.job.activity, phase: 'finish', fraction: 1 });
    }
  }
  emit();
  await page.getByRole('button', { name: '중단', exact: true }).click();
  await shot('13-stop-sheet');
  await page.getByRole('button', { name: '계속 옮기기' }).click();
  for (const verification of ['title', 'body', 'photos', 'facts', 'tags']) {
    activity({ stage: 'verify', verification, phase: 'finish' });
  }
  state.job.step = 5;
  emit();
  await shot('14-progress-verification');
  state.job.status = 'draft_saved';
  state.job.targetResults[0].status = 'draft_saved';
  emit();
  await page
    .getByRole('heading', { name: '블로그에 임시저장했습니다' })
    .waitFor();
  await shot('15-done-draft');
  state.job.status = 'published';
  state.job.targetResults[0].status = 'published';
  state.job.targetResults[0].postUrl = 'https://blog.naver.com/fixture/1';
  emit();
  await shot('16-done-publish');
  state.job.status = 'login_paused';
  state.job.service = 'naver';
  state.job.targetResults[0].status = 'running';
  emit();
  await shot('17-relogin');
  await page.getByRole('button', { name: '다시 로그인', exact: true }).click();
  await shot('18-service-naver');
  await scene();
  await page.getByRole('button', { name: /블로그.*연결됨/ }).click();
  await shot('19-connect');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await shot('20-service-band');
  await scene();
  await choose();
  await sheet('draft');
  await page
    .getByRole('button', { name: '블로그에 임시저장', exact: true })
    .click();
  state.job.status = 'failed';
  state.job.failureCode = 'BLOG_IMAGE_BUTTON';
  emit();
  await page
    .getByRole('heading', { name: '끝까지 옮기지 못했습니다' })
    .waitFor();
  await shot('21-failure');
  state.job.failureCode = 'BAND_POST_UNCONFIRMED';
  emit();
  await page.getByText('게시됐는지 확인하지 못했습니다.', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '다시 시도', exact: true }).count(),
    0,
  );
  await shot('22-unconfirmed');
  await scene();
  await page.getByRole('button', { name: '등록 기록', exact: true }).click();
  await page.locator('.history-row').first().waitFor();
  await shot('23-history-mine');
  await page.getByRole('tab', { name: '전체', exact: true }).click();
  await shot('24-history-all');
  await page.getByRole('tab', { name: '내 기록', exact: true }).click();
  await page
    .getByRole('button', { name: '글 삭제', exact: true })
    .first()
    .click();
  await shot('25-delete-sheet');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await shot('26-settings');
  await scene();
  await choose();
  await sheet('draft');
  await page
    .getByRole('button', { name: '블로그에 임시저장', exact: true })
    .click();
  await page.getByRole('button', { name: '중단', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '중단', exact: true })
    .click();
  await page
    .getByRole('heading', { name: '옮기기를 중단했습니다', exact: true })
    .waitFor();
  await shot('27-stopped');
  await scene();
  await choose();
  await sheet('draft');
  await page
    .getByRole('button', { name: '블로그에 임시저장', exact: true })
    .click();
  await page.reload();
  await page.getByRole('heading', { name: /글쓰기 화면/ }).waitFor();
  assert(state.job.status === 'running');
  await shot('28-restored-progress');
  // Native Android back uses the same event. Check normal pages and sheet order.
  state.job=null;emit();await scene();await choose();
  const nativeBack=()=>page.evaluate(()=>window.dispatchEvent(new Event('goltou:back')));
  await sheet('draft');await nativeBack();await page.waitForFunction(()=>!document.querySelector('.sheet')&&!!document.querySelector('.screen-preview'));
  await sheet('publish');await page.getByRole('button',{name:'다음',exact:true}).click();
  await nativeBack();await page.getByRole('alertdialog',{name:'발행',exact:true}).waitFor();
  await nativeBack();await page.waitForFunction(()=>!document.querySelector('.sheet'));
  await nativeBack();await page.locator('.screen-home').waitFor();
  await page.getByRole('button',{name:'설정',exact:true}).click();await nativeBack();await page.locator('.screen-home').waitFor();
  await page.getByRole('button',{name:'등록 기록',exact:true}).click();await nativeBack();await page.locator('.screen-home').waitFor();
  assert.equal(
    await page
      .getByText(/모름|게시 전 멈춤|실험 화면 열기|밴드 화면 보기/)
      .count(),
    0,
  );
  assert.equal(external, 0);
  assert.deepEqual(errors, []);
  writeFileSync(
    path.join(out, 'checks.json'),
    JSON.stringify(
      {
        screenshots: checks,
        externalRequests: external,
        pageErrors: errors.length,
        widths: [360, 390, 412],
        fixturesOnly: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `UI simulator: ${checks} screens/sheets captured; assertions passed; external requests 0.`,
  );
  }
} finally {
  await context.close();
  await browser.close();
  await core.close();
}
