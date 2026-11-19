// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CLOSING, type MyText, type Product, type ProductPost, type ProductSummary } from '@goltou/api-client';
import { makePreview } from '../../core/src/preparation';
import type { AppSnapshot, Job, JobInput } from '@goltou/core/protocol';

const store = vi.hoisted(() => ({
  state: {} as { snapshot: AppSnapshot; connected: boolean; error: string; debug: boolean },
  request: vi.fn(),
}));
vi.mock('../src/store', () => ({ useStore: () => store.state, request: store.request, clearError: vi.fn(), experiment: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const address = 'https://band.us/band/11/post/101';
const post: ProductPost = { postNo: 1, channel: 'band', mode: 'publish', status: 'published', nickname: '이매니저',
  at: '', targetName: '골투 골프투어', targetKey: '11', postUrl: address, changed: true };
const product: Product = { productNo: 1, title: '시암CC 5일', country: '태국', region: '파타야', contentsHtml: '<p>상품 내용입니다.</p>',
  images: [], departures: [], golfCourses: ['시암CC'], productUrl: '', updatedAt: '', contentHash: 'fixture', ownerNickname: '김매니저' };
const summary: ProductSummary = { ...product, thumbUrl: '', priceFrom: 0, departureCount: 0, changed: { band: true, blog: false },
  myPosts: { blog: { status: 'draft_saved', at: '2026-11-17' }, band: { status: 'published', at: '2026-11-18' } } };
const myText: MyText = { prefix: '안녕하세요 {닉네임}입니다.', closing: DEFAULT_CLOSING, closingOn: true };
const bands = Array.from({ length: 10 }, (_, i) => ({
  key: String(11 + i), name: i === 0 ? '골투 골프투어' : `골프여행 ${i}`, photoLimit: null, observedAt: null,
}));
const targets: JobInput['targets'] = [{ channel: 'blog', key: 'blog', name: '해외골프' },
  ...bands.slice(0, 3).map(b => ({ channel: 'band' as const, key: b.key, name: b.name }))];
const job: Job = { id: 1, productNo: 1, title: product.title, mode: 'publish', status: 'running', step: 6, current: 0, total: 0,
  completedSteps: [1, 2, 3, 4, 5], targets, service: null, message: '', activeTargetKey: '12',
  targetResults: targets.map((target, i) => i < 2 ? { ...target, status: 'published', outcome: 'ok', postUrl: address } : { ...target, status: 'running' }) };

let root: Root;
let detail: Product;
let summaries: ProductSummary[];
let stats: () => unknown;
let save: (value: MyText) => void;
let listProducts: () => {items: ProductSummary[]; total: number};
const flush = async (ms = 0) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
const find = (selector: string, content: string) => [...document.querySelectorAll<HTMLElement>(selector)].find(node => node.textContent?.includes(content));
async function click(selector: string, content: string) {
  const node = find(selector, content);
  expect(node, content).toBeDefined();
  expect((node as HTMLButtonElement).disabled, content).toBe(false);
  await act(async () => node!.click());
}
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  await act(async () => {
    set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function back() {
  await act(async () => { window.dispatchEvent(new Event('goltou:back')); });
}
const body = () => document.body.textContent ?? '';
const nav = (label: string) => click('.bottom-nav button', label);
const sheetButton = (label: string) => click('.sheet button', label);
const openPublish = () => click('.product-publish', '올리기');
async function render() {
  const { App } = await import('../src/App');
  await act(async () => root.render(createElement(App)));
}
beforeEach(() => {
  vi.stubGlobal('__GOLTOU_DEBUG__', false);
  vi.stubGlobal('__GOLTOU_VERSION__', '1.0.5');
  vi.stubGlobal('__GOLTOU_VERSION_CODE__', 9);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  detail = { ...product, posts: [{ ...post, at: new Date(Date.now() - 86400000).toISOString() },
    { ...post, postNo: 2, targetKey: '12', at: new Date(Date.now() - 4 * 86400000).toISOString(), postUrl: '' }] };
  summaries = [summary];
  listProducts = () => ({items:summaries,total:summaries.length});
  stats = () => ({ date: '2026-11-18', rows: [{ userNo: 1, nickname: '김매니저', published: 3, drafts: 2, failed: 1, stopped: 0, lastAt: '2026-11-17T18:01:00Z' }] });
  save = value => { store.state.snapshot = { ...store.state.snapshot, myText: value }; };
  store.state = { connected: true, debug: false, error: '', snapshot: {
    user: { userNo: 1, name: '김이름', nickname: '김매니저', phone: '010-1234-5678', userType: 9, role: 'admin' },
    settings: { closingText: '구 공통 문구', defaultHashtags: ['골투'], bandDailyLimit: 3 },
    myText, services: { naver: 'confirmed', band: 'confirmed', ai: 'unknown' }, visibleService: null, job: null,
    simulation: { tickMs: 100, loginAt: null, failAt: null },
  } };
  store.request.mockReset().mockImplementation(async (command, payload) => {
    switch (command) {
      case 'preferences.get': return { polish: false, closing: false, linkCard: false, lastBandKeys: ['11', '12'] };
      case 'polish.setting.get': return 'spelling';
      case 'products.list': return listProducts();
      case 'products.get': return detail;
      case 'preview.prepare': return makePreview(detail, { closing: payload.options.closing, prefixText: '안녕하세요 김매니저입니다.',
        closingText: '연락은 010-1234-5678 로 주세요.', tagWords: ['골투'] });
      case 'bands.list': return bands;
      case 'bands.dailyUsage': return { limit: 3, used: 1 };
      case 'posts.list': return { items: [], total: 0 };
      case 'stats.today': return stats();
      case 'myText.save': return save(payload);
      case 'job.start':
      case 'job.retryFailed':
      case 'job.preview':
      case 'preferences.save':
      case 'post.open':
      case 'app.exit':
      case 'update.home': return null;
      default: throw Error(command);
    }
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('renders plain marks, leaves the publish action enabled and keeps the filter scoped to my posts', async () => {
  const { ownerNickname, changed, ...legacy } = summary;
  summaries = [summary, { ...legacy, productNo: 2, myPosts: { blog: null, band: null } }, { ...summary, productNo: 3, ownerNickname: null }];
  await render(); await flush(170);
  expect(body()).toContain('태국 파타야 · 등록 김매니저');
  expect(body()).toContain('등록 담당자 없음');
  expect(document.querySelectorAll('.product-copy small')[1]?.textContent).toBe('태국 파타야');
  expect(body()).not.toMatch(/0원부터|출발일 0개/);
  expect(document.querySelector('.product-status.posted')).toBeTruthy();
  expect(document.querySelector('.product-status.draft')).toBeTruthy();
  expect(document.querySelector('.product-status.none')?.textContent).toContain('안 올림');
  expect(document.querySelector('.product-status.posted .warn')?.textContent).toContain('올린 뒤 상품이 바뀜');
  expect(document.querySelector('.product-status-row button')?.textContent).toBe('올리기');
  await click('[role=tab]', '안 올린 상품'); await flush(170);
  expect(store.request).toHaveBeenCalledWith('products.list', expect.objectContaining({ onlyUnposted: true }), true);
  await openPublish();
  expect(document.querySelector('.screen-home')).toBeTruthy();
  expect(document.querySelector('.sheet h2')?.textContent).toBe('어디에 발행할까요?');
  expect(body()).toContain('이 상품은 11.18에 밴드에 올린 적이 있습니다.');
});

it('shows product history, opens its URLs and inserts tagged content in both previews', async () => {
  await render(); await flush(170); await click('.product-row', product.title);
  expect(body()).toContain('이 상품을 올린 사람 2건');
  expect(body()).toContain('이매니저');
  expect(document.querySelector('.product-post-copy')?.textContent).toMatch(/\d{2}\.\d{2} 발행/);
  expect(body()).toContain('올린 뒤 상품이 바뀜');
  await click('.product-post button', '글 보기');
  expect(store.request).toHaveBeenCalledWith('post.open', { url: address });
  expect(body()).toContain('들어갈 태그 4개');
  expect([...document.querySelectorAll('.posting-tags small')].map(n => n.textContent)).toEqual(['국가', '지역', '골프장', '정해 둔 글자']);
  expect(document.querySelector('.blog .preview-phrase.prefix')?.textContent).toContain('글 앞 문구');
  expect(document.querySelector('.blog .preview-phrase.closing')?.textContent).toContain('글 끝 문구');
  await click('[role=tab]', '밴드 모습');
  expect(document.querySelector('.band-full-text .preview-phrase.prefix')).toBeTruthy();
  expect(document.querySelector('.band-full-text .preview-phrase.closing')?.textContent).toContain('010-1234-5678');
  expect(document.querySelector('.band-tag-line')?.textContent).toBe('#태국 #파타야 #시암CC #골투');
});

it.each([true, false])('handles empty or omitted history (field sent: %s)', async sent => {
  const { ownerNickname, ...legacy } = product;
  detail = sent ? { ...product, ownerNickname: null, posts: [] } : legacy;
  await render(); await flush(170); await click('.product-row', product.title);
  expect(!!document.querySelector('.product-posts')).toBe(sent);
  expect(body().includes('아직 아무도 올리지 않았습니다')).toBe(sent);
  expect(document.querySelector('.product-meta')?.textContent).toBe(sent ? '태국 파타야 · 등록 담당자 없음' : '태국 파타야');
  expect(body()).toContain('들어갈 태그 4개');
});

it('preselects several bands, checks destination-specific recent posts, keeps search and confirms the chosen set', async () => {
  await render(); await flush(170); await openPublish();
  expect(document.querySelectorAll('.band-row[aria-checked=true]')).toHaveLength(2);
  expect(body()).toContain('지난번에 고른 밴드를 그대로 체크해 두었습니다.');
  expect(document.querySelectorAll('.band-recent')).toHaveLength(1);
  expect(document.querySelector('.band-recent')?.parentElement?.textContent).toContain('골투 골프투어');
  expect(document.querySelector('.text-switch .phone-number')?.textContent).toBe('010-1234-5678');
  await sheetButton('골프여행 2');
  expect(body()).toContain('밴드 하루 한도 3건 중 오늘 1건을 썼습니다.');
  expect((find('.sheet button', '4곳에 발행') as HTMLButtonElement).disabled).toBe(true);
  await input(document.querySelector('.sheet input')!, '골프여행 2');
  expect(document.querySelectorAll('.band-row')).toHaveLength(1);
  await sheetButton('모두 해제');
  expect(document.querySelectorAll('.band-row[aria-checked=true]')).toHaveLength(0);
  await input(document.querySelector('.sheet input')!, '골투');
  await sheetButton('골투 골프투어');
  await sheetButton('비공개');
  await click('[role=switch]', '글 끝 문구 넣기');
  await sheetButton('2곳에 발행');
  expect(store.request.mock.calls.some(([command]) => command === 'job.start')).toBe(false);
  expect(document.querySelector('.sheet h2')?.textContent).toBe('이대로 발행할까요?');
  await sheetButton('2곳에 발행');
  expect(store.request).toHaveBeenCalledWith('job.start', expect.objectContaining({
    mode: 'publish', publishConfirmed: true, blogVisibility: 'private', options: expect.objectContaining({ closing: false }),
    targets: [expect.objectContaining({ channel: 'blog' }), expect.objectContaining({ channel: 'band', key: '11' })],
  }));
});

it('keeps the blog-only draft workflow', async () => {
  await render(); await flush(170); await click('.product-row', product.title);
  await click('.bar button', '임시저장'); await sheetButton('블로그에 임시저장');
  expect(store.request).toHaveBeenCalledWith('job.start', expect.objectContaining({
    mode: 'draft', publishConfirmed: false, targets: [expect.objectContaining({ channel: 'blog' })],
  }));
});

it('shows live target progress, between-band pause, and offers retry only for verified failures', async () => {
  store.state.snapshot.job = job;
  await render();
  expect(body()).toContain('밴드 3곳 중 2번째에 올리는 중');
  expect([...document.querySelectorAll('.posting-targets li')].map(row => row.className)).toEqual(['done', 'done', 'now', 'waiting']);
  store.state.snapshot = { ...store.state.snapshot, job: { ...job, bandPause: true } };
  await render();
  expect(body()).toContain('다음 밴드까지 잠시 쉬는 중');
  expect(document.querySelector('.posting-targets .now')).toBeNull();
  const final: Job = { ...job, status: 'failed', step: 7, completedSteps: [1, 2, 3, 4, 5, 6, 7], targetResults: [
    ...job.targetResults!.slice(0, 2), { ...targets[2]!, status: 'failed', outcome: 'unconfirmed' },
    { ...targets[3]!, status: 'failed', outcome: 'failed', reason: 'BAND_PHOTO_LIMIT' },
  ] };
  store.state.snapshot = { ...store.state.snapshot, job: final };
  await render();
  expect(body()).toContain('4곳 중 2곳에 올렸습니다');
  expect(body()).toContain('게시됐는지 확인하지 못했습니다. 다시 올리면 중복될 수 있으니 밴드에서 먼저 확인해 주세요.');
  expect(body()).toContain('이곳에 올릴 수 있는 글이나 사진 수를 넘었습니다.');
  expect(document.querySelectorAll('.posting-targets .post-link')).toHaveLength(2);
  await click('.bar button', '실패한 1곳 다시 시도');
  expect(store.request).toHaveBeenCalledWith('job.retryFailed', {});
  store.state.snapshot = { ...store.state.snapshot, job: { ...final, targetResults: final.targetResults!.slice(0, 3) } };
  await render();
  expect(body()).not.toContain('다시 시도');
});

it('updates personal text, highlights tokens, reports failed and saved, and preserves the keyboard save action', async () => {
  store.state.snapshot.user = { ...store.state.snapshot.user!, phone: '' };
  await render(); await nav('설정');
  expect(body()).toContain('내 글 문구 · 나에게만 적용');
  expect(body()).toContain('골투 회원 정보에 휴대폰 번호가 없습니다.');
  expect(body()).toContain('태그로 붙일 정해 둔 글자');
  expect(body()).not.toContain('구 공통 문구');
  expect(document.querySelector('.my-text-settings textarea')?.getAttribute('placeholder')).toBe('비어 있으면 넣지 않습니다');
  expect([...document.querySelectorAll('.token-layer mark')].map(mark => mark.textContent)).toEqual(['{닉네임}', '{휴대폰}']);
  const closing = document.querySelector<HTMLTextAreaElement>('.token-input')!;
  await input(closing, '글쓴이 {닉네임}');
  expect(body()).toContain('올라갈 모습: 글쓴이 김매니저');
  await click('.reset-text button', '기본값으로');
  expect(closing.value).toBe(DEFAULT_CLOSING);
  await click('.my-text-settings [role=switch]', '발행할 때');
  await act(async () => {
    closing.focus();
    window.dispatchEvent(new CustomEvent('goltou:keyboard', { detail: { visible: true } }));
  });
  expect(document.querySelector('.editing-text .my-text-actions button')).toBeTruthy();
  expect(document.querySelector('.bottom-nav')).toBeNull();
  const persist = save;
  save = () => { throw Error('fixture'); };
  await click('.my-text-actions button', '내 글 문구 저장');
  expect(body()).toContain('저장하지 못했습니다. 다시 시도해 주세요.');
  save = persist;
  await click('.my-text-actions button', '내 글 문구 저장');
  expect(body()).toContain('내 글 문구를 저장했습니다.');
  expect(store.request).toHaveBeenCalledWith('myText.save', { ...myText, closingOn: false }, true);
});

it('expires the home hint after two seconds, confirms the second press and logs cancel and finish', async () => {
  await render();
  vi.useFakeTimers();
  await back();
  expect(body()).toContain('한 번 더 누르면 앱을 끝낼지 묻습니다');
  await act(async () => vi.advanceTimersByTime(2000));
  expect(document.querySelector('.exit-snackbar')).toBeNull();
  await back();
  expect(document.querySelector('.centered-dialog')).toBeNull();
  await back();
  expect(body()).toContain('골투오토를 끝낼까요?');
  await sheetButton('취소');
  expect(store.request).toHaveBeenCalledWith('app.exit', { event: 'cancel' }, true);
  store.state.snapshot = { ...store.state.snapshot, job };
  await render();
  await back(); await back();
  expect(body()).toContain('올리는 중인 작업이 멈춥니다.');
  await sheetButton('끝내기');
  expect(store.request).toHaveBeenCalledWith('app.exit', { event: 'finish' });
  expect(store.request.mock.calls.filter(([command]) => command === 'app.exit').map(([, payload]) => payload.event))
    .toEqual(['hint', 'hint', 'confirm', 'cancel', 'hint', 'confirm', 'finish']);
});

it('loads admin statistics, renders Seoul time, handles empty and error states, and hides the missing route', async () => {
  const data = stats;
  stats = () => new Promise(() => {});
  await render(); await nav('등록 기록');
  expect(body()).toContain('오늘 현황을 불러오는 중입니다.');
  await nav('상품');
  stats = data;
  await nav('등록 기록');
  expect(body()).toContain('오늘 현황 (11.18)');
  expect(document.querySelector('.today-status tbody')?.textContent).toBe('김매니저321003:01');
  await nav('상품'); stats = () => ({ date: '2026-11-18', rows: [] }); await nav('등록 기록');
  expect(body()).toContain('오늘 등록 기록이 없습니다.');
  await nav('상품'); stats = () => { throw Error('fixture'); }; await nav('등록 기록');
  expect(body()).toContain('오늘 현황을 불러오지 못했습니다.');
  stats = () => null;
  await click('.today-error button', '다시 불러오기');
  expect(document.querySelector('.today-status')).toBeNull();
  await nav('상품');
  store.request.mockClear();
  store.state.snapshot = { ...store.state.snapshot, user: { ...store.state.snapshot.user!, role: 'staff' } };
  await render(); await nav('등록 기록');
  expect(store.request.mock.calls.some(([command]) => command === 'stats.today')).toBe(false);
});

it.each([false,true])('automatically retries the failed initial product load exactly once (second failure: %s)', async secondFails => {
  let requests = 0;
  listProducts = () => {
    requests++;
    if (requests === 1 || secondFails) throw Error('synthetic network failure');
    return {items:summaries,total:summaries.length};
  };
  await render(); await flush(180);
  expect(requests).toBe(1);
  expect(document.querySelector('.product-copy')).toBeNull();
  expect(body()).not.toContain('다시 시도');
  await flush(370);
  expect(requests).toBe(2);
  expect(store.request.mock.calls.filter(([command]) => command === 'products.list').map(call => call[2])).toEqual([true, true]);
  if (secondFails) expect(body()).toContain('다시 시도');
  else expect(document.querySelector('.product-copy')?.textContent).toContain(product.title);
});
