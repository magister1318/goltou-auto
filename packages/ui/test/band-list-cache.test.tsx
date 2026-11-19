// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AppSnapshot } from '@goltou/core/protocol';
import { bandListTime } from '../src/BandListStatus';
import { createFakeApi } from '@goltou/api-client';
import { makePreview } from '../../core/src/preparation';
import { jobMessage } from '../src/job-message';
import { canRetryJob } from '../../core/src/job-safety';

const mock = vi.hoisted(() => ({ state: {} as { snapshot: AppSnapshot; connected: boolean; error: string; debug: boolean }, request: vi.fn() }));
vi.mock('../src/store', () => ({ useStore: () => mock.state, request: mock.request, clearError: vi.fn(), experiment: vi.fn() }));
let root: Root | undefined;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function flush(ms = 0) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
async function click(text: string, selector = 'button') {
  const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(b => b.textContent?.includes(text));
  expect(button, text).toBeTruthy(); expect(button!.disabled, text).toBe(false);
  await act(async () => button!.click());
}
it('shows stale rows immediately, applies background snapshots, keeps selection and permits cached-list retry after a failed refresh', async () => {
  vi.stubGlobal('__GOLTOU_DEBUG__', false); vi.stubGlobal('__GOLTOU_VERSION__', '1.0.3'); vi.stubGlobal('__GOLTOU_VERSION_CODE__', 7); vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const api = createFakeApi(), login = await api.request('/auto/login', { loginId: 'manager', password: 'demo', device: { kind: 'web', model: 'fixture', appVersion: '1.0.3' } });
  const me = await api.request('/auto/me', {}, login.token), product = await api.request('/auto/products/get', { productNo: 1234 }, login.token);
  const savedAt = Date.now() - 86400001;
  const rows = [{ key: '111', name: '처음 합성 밴드', photoLimit: null, observedAt: null }, { key: '222', name: '선택한 합성 밴드', photoLimit: null, observedAt: null }];
  mock.state = { connected: true, error: '', debug: false, snapshot: { user: me.user, settings: me.settings, services: { naver: 'confirmed', band: 'confirmed', ai: 'unknown' }, visibleService: null, job: null, simulation: { tickMs: 140, loginAt: null, failAt: null } } };
  mock.request.mockReset().mockImplementation(async (command: string, input: never) => {
    if (command === 'preferences.get') return { polish: false, closing: false, linkCard: false, lastBandKeys: ['222'] };
    if (command === 'preferences.save') return input;
    if (command === 'preview.prepare') return makePreview(product, { closing: false, linkCard: false, hashtags: [] });
    if (command === 'bands.list') return { rows, savedAt, source: 'cache', stale: true, refreshing: true };
    if (command === 'bands.dailyUsage') return { limit: 3, used: 0 };
    if (command === 'products.list') return api.request('/auto/products/list', input, login.token);
    if (command === 'products.get') return product;
    throw Error('UNEXPECTED_UI_COMMAND:' + command);
  });
  const { App } = await import('../src/App');
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  const render = async () => { await act(async () => root!.render(createElement(App))); };
  await render(); await flush(200);
  await click('', '.product-row'); await flush(); await click('발행', '.bar button');
  expect(document.body.textContent).toContain('선택한 합성 밴드');
  expect(document.body.textContent).toContain('밴드 목록을 읽는 중입니다');
  expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '새로고침')!.disabled).toBe(true);
  expect(document.querySelector('.band-row[role="checkbox"][aria-checked="true"]')?.textContent).toContain('선택한 합성 밴드');
  const updated = { revision: 2, rows: [{ ...rows[1]!, name: '갱신된 선택 밴드' }, { ...rows[0]!, key: '333' }], savedAt: Date.now(), source: 'band' as const, stale: false, refreshing: false };
  mock.state = { ...mock.state, snapshot: { ...mock.state.snapshot, bandList: updated } }; await render();
  expect(document.querySelector('.band-row[role="checkbox"][aria-checked="true"]')?.textContent).toContain('갱신된 선택 밴드');
  expect(document.querySelectorAll('.band-row[role="checkbox"]')).toHaveLength(2);
  mock.state = { ...mock.state, snapshot: { ...mock.state.snapshot, bandList: { rows, source: 'cache', savedAt, stale: true, refreshing: true, revision: 1 } } }; await render();
  expect(document.querySelector('.band-row[role="checkbox"][aria-checked="true"]')?.textContent).toContain('갱신된 선택 밴드');
  mock.request.mockImplementationOnce(async () => ({ ...updated, source: 'cache', failure: 'BAND_LIST_EMPTY' }));
  await click('새로고침');
  expect(mock.request).toHaveBeenCalledWith('bands.list', { refresh: true });
  expect(document.body.textContent).toContain('잠시 뒤 다시 읽기');
  expect(document.querySelector('.band-row[role="checkbox"][aria-checked="true"]')?.textContent).toContain('갱신된 선택 밴드');
  const next = [...document.querySelectorAll<HTMLButtonElement>('.sheet button')].find(b => b.textContent === '2곳에 발행');
  expect(next?.disabled).toBe(false);
  mock.state = { ...mock.state, snapshot: { ...mock.state.snapshot, bandList: { ...updated, rows: [updated.rows[1]!] } } }; await render();
  expect(document.body.textContent).toContain('밴드 · 0곳 고름');
});
it('formats today/yesterday using calendar boundaries', () => {
  const now = new Date(2026, 10, 18, 0, 5);
  expect(bandListTime(new Date(2026, 10, 18, 0, 1).getTime(), now)).toBe('마지막 확인: 오늘 00:01');
  expect(bandListTime(new Date(2026, 10, 17, 18, 2).getTime(), now)).toBe('마지막 확인: 어제 18:02');
  expect(bandListTime(new Date(2026, 10, 16, 12, 30).getTime(), now)).toBe('마지막 확인: 11월 16일 12:30');
});
it('shows the required cached-target failure in the result screen, including a job with an earlier successful blog target', () => {
  for (const targetResults of [[], [{ channel: 'blog', status: 'published' }]]) {
    expect(jobMessage({ failureCode: 'BAND_TARGET_INVALID', status: 'failed', targetResults } as never)[0]).toBe('밴드 목록이 바뀌었습니다. 새로고침 후 다시 골라 주세요.');
  }
  expect(canRetryJob({ status: 'failed', creationState: 'none', failureCode: 'BAND_TARGET_INVALID' } as never)).toBe(false);
});
