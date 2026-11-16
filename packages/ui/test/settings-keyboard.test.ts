// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const store = vi.hoisted(() => ({
  snapshot: {
    user: { userNo: 1, name: '합성 관리자', userType: 9, role: 'admin' },
    settings: { closingText: '', defaultHashtags: [], bandDailyLimit: 3 },
    services: { naver: 'confirmed', band: 'confirmed' }, job: null,
  },
  request: vi.fn(async (command: string) => command === 'preferences.get'
    ? { polish: false, closing: false, linkCard: false, lastBandKey: '' }
    : command === 'polish.setting.get' ? 'spelling' : { items: [], total: 0 }),
}));
vi.mock('../src/store', () => ({
  useStore: () => ({ snapshot: store.snapshot, connected: true, error: '', debug: false }),
  request: store.request, clearError: vi.fn(), experiment: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

it('restores settings navigation when Android hides the keyboard while the field retains focus', async () => {
  vi.stubGlobal('__GOLTOU_DEBUG__', false);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const { App } = await import('../src/App');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(App)); });
    const settings = [...container.querySelectorAll<HTMLButtonElement>('.bottom-nav button')].find(e => e.textContent === '설정')!;
    await act(async () => { settings.click(); });
    const input = container.querySelector<HTMLInputElement>('input[type=number]')!;
    await act(async () => {
      input.focus();
      window.dispatchEvent(new CustomEvent('goltou:keyboard', { detail: { visible: true } }));
    });
    expect(container.querySelector('.bottom-nav')).toBeNull();
    await act(async () => { window.dispatchEvent(new CustomEvent('goltou:keyboard', { detail: { visible: false } })); });
    expect(document.activeElement).toBe(input);
    expect(container.querySelectorAll('.bottom-nav button')).toHaveLength(3);
    expect(container.querySelector('.savebar')).toBeNull();
    expect(store.request.mock.calls.some(([command]) => command === 'settings.save')).toBe(false);
  } finally { await act(async () => root.unmount()); }
});
