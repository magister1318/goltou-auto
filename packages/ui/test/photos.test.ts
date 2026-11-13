// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { InputPlan } from '@goltou/core';
import { photoSource, ProductPhoto } from '../src/ProductPhoto';
import { ConversionPreview } from '../src/ConversionPreview';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
let observers: { reveal(): void; disconnect: ReturnType<typeof vi.fn> }[];
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback) {
      observers.push({ reveal: () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver), disconnect: this.disconnect });
    }
    observe() {}
  });
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async (element: React.ReactNode) => { await act(() => root.render(element)); };

describe('display-only API photos', () => {
  it.each(['https://goltou.kr/a.jpg', 'https://images.goltou.kr/a.jpg', 'https://cdn.images.goltou.kr/a.jpg'])('accepts the download policy host: %s', url => {
    expect(photoSource(url)).toBe(url);
  });
  it.each(['http://goltou.kr/a.jpg', 'https://notgoltou.kr/a.jpg', 'https://goltou.kr.evil.test/a.jpg', 'https://user@goltou.kr/a.jpg', 'https://goltou.kr:8443/a.jpg', 'data:image/png,abc', '//goltou.kr/a.jpg', '', undefined])('renders a neutral placeholder without a request for %s', async url => {
    await render(createElement(ProductPhoto, { ...(url === undefined ? {} : { url }) }));
    expect(photoSource(url)).toBeUndefined();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('이미지 없음');
    expect(container.textContent).not.toContain('사진');
  });
  it('lazy-loads the thumbnail, hides failed images and retries a changed URL', async () => {
    await render(createElement(ProductPhoto, { url: 'https://goltou.kr/a.jpg' }));
    const img = container.querySelector('img')!;
    expect(img.getAttribute('loading')).toBe('lazy'); expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    await act(() => img.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull(); expect(container.querySelector('.photo-placeholder')).not.toBeNull();
    await render(createElement(ProductPhoto, { url: 'https://goltou.kr/b.jpg' }));
    expect(container.querySelector('img')?.src).toBe('https://goltou.kr/b.jpg');
  });
  it.each(['blog', 'band'] as const)('preserves %s photo positions, numbering and URLs without eagerly requesting the run', async channel => {
    const plan: InputPlan = { channel, discarded: [], notices: [], steps: [
      { kind: 'text', role: 'body', text: '앞 문단' },
      { kind: 'photos', urls: ['https://goltou.kr/a.jpg', 'https://images.goltou.kr/b.jpg'] },
      { kind: 'text', role: 'body', text: '중간 문단' },
      { kind: 'photos', urls: ['https://goltou.kr/c.jpg'] },
    ] };
    const original = JSON.stringify(plan);
    await render(createElement(ConversionPreview, { plan, expanded: true, droppedStruckCharacters: 0 }));
    expect(container.querySelectorAll('figure')).toHaveLength(3);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect([...container.querySelectorAll('figcaption')].map(e => e.textContent)).toEqual(['사진 1/3', '사진 2/3', '사진 3/3']);
    expect([...container.querySelector('.converted-content')!.children].map(e => e.textContent)).toEqual(['앞 문단', '사진 1/3사진 2/3', '중간 문단', '사진 3/3']);
    await act(() => observers[0]!.reveal());
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')?.src).toBe('https://goltou.kr/a.jpg');
    expect(observers[0]!.disconnect).toHaveBeenCalled();
    await act(() => container.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('이미지를 표시할 수 없습니다');
    expect(JSON.stringify(plan)).toBe(original);
  });
  it('uses the whole-plan photo total even when later steps are collapsed', async () => {
    const plan: InputPlan = { channel: 'blog', discarded: [], notices: [], steps: [{ kind: 'photos', urls: ['https://goltou.kr/a.jpg'] }, ...Array.from({ length: 8 }, () => ({ kind: 'break' as const })), { kind: 'photos', urls: ['https://goltou.kr/b.jpg'] }] };
    await render(createElement(ConversionPreview, { plan, expanded: false, droppedStruckCharacters: 0 }));
    expect(container.querySelector('figcaption')?.textContent).toBe('사진 1/2');
    expect(container.querySelectorAll('figure')).toHaveLength(1);
  });
});
