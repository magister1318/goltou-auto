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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        observers.push({
          reveal: () =>
            callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            ),
          disconnect: this.disconnect,
        });
      }
      observe() {}
    },
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async (element: React.ReactNode) => {
  await act(() => root.render(element));
};

describe('display-only API photos', () => {
  it.each([
    'https://goltou.kr/a.jpg',
    'https://images.goltou.kr/a.jpg',
    'https://cdn.images.goltou.kr/a.jpg',
    'https://coresos-phinf.pstatic.net/a.jpg',
  ])('accepts the download policy host: %s', (url) => {
    expect(photoSource(url)).toBe(url);
  });
  it.each([
    'http://goltou.kr/a.jpg',
    'https://notgoltou.kr/a.jpg',
    'https://goltou.kr.evil.test/a.jpg',
    'https://user@goltou.kr/a.jpg',
    'https://goltou.kr:8443/a.jpg',
    'http://coresos-phinf.pstatic.net/a.jpg',
    'https://coresos-phinf.pstatic.net.evil.test/a.jpg',
    'https://evil.coresos-phinf.pstatic.net/a.jpg',
    'https://user@coresos-phinf.pstatic.net/a.jpg',
    'https://coresos-phinf.pstatic.net:8443/a.jpg',
    'data:image/png,abc',
    '//goltou.kr/a.jpg',
    '',
    undefined,
  ])('renders a neutral placeholder without a request for %s', async (url) => {
    await render(
      createElement(ProductPhoto, { ...(url === undefined ? {} : { url }) }),
    );
    expect(photoSource(url)).toBeUndefined();
    expect(container.querySelector('img')).toBeNull();
    expect(
      container.querySelector('[role="img"]')?.getAttribute('aria-label'),
    ).toBe('이미지 없음');
    expect(container.textContent).not.toContain('사진');
  });
  it('lazy-loads the thumbnail, hides failed images and retries a changed URL', async () => {
    await render(
      createElement(ProductPhoto, { url: 'https://goltou.kr/a.jpg' }),
    );
    const img = container.querySelector('img')!;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    await act(() => img.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.photo-placeholder')).not.toBeNull();
    await render(
      createElement(ProductPhoto, { url: 'https://goltou.kr/b.jpg' }),
    );
    expect(container.querySelector('img')?.src).toBe('https://goltou.kr/b.jpg');
  });
  it.each(['blog', 'band'] as const)(
    'preserves %s service photo order and URLs without eagerly requesting the run',
    async (channel) => {
      const plan: InputPlan = {
        channel,
        discarded: [],
        notices: [],
        steps: [
          { kind: 'text', role: 'body', text: '앞 문단' },
          {
            kind: 'photos',
            urls: ['https://goltou.kr/a.jpg', 'https://coresos-phinf.pstatic.net/b.jpg'],
          },
          { kind: 'text', role: 'body', text: '중간 문단' },
          { kind: 'photos', urls: ['https://goltou.kr/c.jpg'] },
        ],
      };
      const original = JSON.stringify(plan);
      await render(
        createElement(ConversionPreview, {
          plan,
          expanded: true,
          droppedStruckCharacters: 0,
        }),
      );
      expect(container.querySelectorAll(channel === 'band' ? '.band-photo-stack .preview-photo' : '.preview-photo')).toHaveLength(3);
      expect(container.querySelectorAll('img')).toHaveLength(0);
      if (channel === 'blog') {
        const body = container.querySelector('.post-body')!;
        expect([...body.children].map((e) => e.tagName)).toEqual([
          'P',
          'DIV',
          'P',
          'DIV',
        ]);
        expect(body.children[0]!.textContent).toBe('앞 문단');
        expect(body.children[2]!.textContent).toBe('중간 문단');
      } else {
        expect(container.querySelector('.band-full-text')!.textContent).toBe(
          '앞 문단\n\n중간 문단',
        );
        expect(
          container.querySelector('.band-full-text')!.nextElementSibling?.className,
        ).toBe('band-photo-stack');
      }
      const offset = channel === 'band' ? 3 : 0;
      await act(() => observers[offset]!.reveal());
      expect(container.querySelectorAll('img')).toHaveLength(1);
      expect(container.querySelector('img')?.src).toBe(
        'https://goltou.kr/a.jpg',
      );
      expect(observers[offset]!.disconnect).toHaveBeenCalled();
      await act(() => observers[offset + 1]!.reveal());
      expect([...container.querySelectorAll('img')].map(img => img.src)).toEqual([
        'https://goltou.kr/a.jpg', 'https://coresos-phinf.pstatic.net/b.jpg',
      ]);
      await act(() => container.querySelectorAll('img')[1]!.dispatchEvent(new Event('load')));
      expect(container.querySelectorAll('.photo-loaded')).toHaveLength(1);
      await act(() =>
        container.querySelector('img')!.dispatchEvent(new Event('error')),
      );
      expect(container.querySelectorAll('img')).toHaveLength(1);
      expect(container.textContent).toContain('이미지를 표시할 수 없습니다');
      expect(JSON.stringify(plan)).toBe(original);
    },
  );
  it('keeps collapsed later photos out of the blog preview without adding captions', async () => {
    const plan: InputPlan = {
      channel: 'blog',
      discarded: [],
      notices: [],
      steps: [
        { kind: 'photos', urls: ['https://goltou.kr/a.jpg'] },
        ...Array.from({ length: 8 }, () => ({ kind: 'break' as const })),
        { kind: 'photos', urls: ['https://goltou.kr/b.jpg'] },
      ],
    };
    await render(
      createElement(ConversionPreview, {
        plan,
        expanded: false,
        droppedStruckCharacters: 0,
      }),
    );
    expect(container.querySelector('figcaption')).toBeNull();
    expect(container.querySelectorAll('figure')).toHaveLength(1);
  });
});
