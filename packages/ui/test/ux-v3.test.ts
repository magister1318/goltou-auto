// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sheet } from '../src/Sheet';
import { BandChooser } from '../src/BandChooser';
import {
  bandChoiceReason,
  targetStatus,
  resultKind,
  historyStatus,
} from '../src/ux-state';
import { ConversionPreview } from '../src/ConversionPreview';
import { bandText, photoUrls } from '@goltou/sites';
import type { InputPlan } from '@goltou/core';
import type { Job } from '@goltou/core/protocol';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
describe('WP17 choices and channel outcomes', () => {
  it.each([
    { loading: true, failed: false },
    { loading: false, failed: true },
    { loading: false, failed: false },
  ])(
    'always allows blog-only when the Band list is unavailable %j',
    (state) => {
      expect(
        bandChoiceReason({
          blog: true,
          band: false,
          selected: false,
          ...state,
        }),
      ).toBe('');
      expect(
        bandChoiceReason({ blog: true, band: true, selected: false, ...state }),
      ).not.toBe('');
    },
  );
  it('requires an explicit destination and selected writable band', () => {
    expect(
      bandChoiceReason({
        blog: false,
        band: false,
        selected: true,
        loading: false,
        failed: false,
      }),
    ).toContain('하나 이상');
    expect(
      bandChoiceReason({
        blog: false,
        band: true,
        selected: true,
        loading: false,
        failed: false,
      }),
    ).toBe('');
  });
  it('preserves successful channels while identifying uncertain, waiting and not-started channels', () => {
    const job = {
      step: 6,
      status: 'failed',
      publicationUncertain: true,
      activeTargetKey: '222',
    } as Job;
    expect(
      targetStatus(job, {
        channel: 'blog',
        key: '111',
        name: '',
        status: 'published',
      }),
    ).toBe('발행됨');
    expect(
      targetStatus(job, {
        channel: 'band',
        key: '222',
        name: '',
        status: 'failed',
      }),
    ).toBe('확인 필요');
    expect(resultKind(job)).toBe('uncertain');
    const paused = {
      ...job,
      status: 'dialog_paused',
      publicationUncertain: false,
      activeTargetKey: '111',
    } as Job;
    expect(
      targetStatus(paused, {
        channel: 'blog',
        key: '111',
        name: '',
        status: 'running',
      }),
    ).toBe('확인을 기다리는 중');
    expect(
      targetStatus(paused, {
        channel: 'band',
        key: '222',
        name: '',
        status: 'running',
      }),
    ).toBe('시작 전');
    expect(resultKind({ ...paused, status: 'record_failed' })).toBe('record');
    expect(
      historyStatus({
        status: 'failed',
        failReason: 'PHOTO_DOWNLOAD_FAILED',
      } as never),
    ).toContain('공개되지 않음');
    expect(
      historyStatus({
        status: 'failed',
        failReason: 'BAND_POST_UNCONFIRMED',
      } as never),
    ).toBe('확인 필요');
  });
  it('draws a searchable radio list only from nine bands, with the last choice selected', () => {
    const bands = Array.from({ length: 9 }, (_, i) => ({
      key: String(i),
      name: `합성 밴드 ${i}`,
      photoLimit: null,
      observedAt: null,
    }));
    const render = (n: number) =>
      renderToStaticMarkup(
        createElement(BandChooser, {
          bands: bands.slice(0, n),
          value: '1',
          choose() {},
          back() {},
        }),
      );
    expect(render(8)).not.toContain('<input');
    expect(render(9)).toContain('밴드 이름으로 찾기');
    expect(render(9).match(/aria-checked="true"/g)).toHaveLength(1);
    expect(render(9)).not.toContain('<select');
  });
  it('derives the Band preview from engine text and photo order while keeping blog bold, links and tag box', () => {
    const steps: InputPlan['steps'] = [
      { kind: 'text', role: 'title', text: '합성 제목' },
      {
        kind: 'text',
        role: 'body',
        text: '강조 문의',
        runs: [
          { text: '강조', bold: true },
          { text: ' 문의', href: 'https://example.invalid/ask' },
        ],
      },
      { kind: 'photos', urls: ['https://goltou.kr/a.png'] },
      {
        kind: 'table',
        role: 'body',
        rows: [
          ['머리', '값'],
          ['가', '나'],
        ],
      },
      { kind: 'text', role: 'hashtags', text: '#합성' },
    ];
    const node = document.createElement('div');
    const band: InputPlan = {
      channel: 'band',
      steps,
      discarded: [],
      notices: [],
    };
    node.innerHTML = renderToStaticMarkup(
      createElement(ConversionPreview, {
        plan: band,
        expanded: true,
        droppedStruckCharacters: 0,
      }),
    );
    expect(node.querySelector('.band-text')!.textContent).toBe(bandText(band));
    expect(
      node.querySelectorAll('.band-photo-grid .preview-photo'),
    ).toHaveLength(photoUrls(band).length);
    node.innerHTML = renderToStaticMarkup(
      createElement(ConversionPreview, {
        plan: { ...band, channel: 'blog' },
        expanded: true,
        droppedStruckCharacters: 0,
      }),
    );
    expect(node.querySelector('strong')!.textContent).toBe('강조');
    expect(node.querySelector('a')!.getAttribute('href')).toBe(
      'https://example.invalid/ask',
    );
    expect(node.querySelectorAll('th')).toHaveLength(2);
    expect(node.querySelector('.tag-box')!.textContent).toContain('합성');
    expect(node.querySelector('.post-body')!.textContent).not.toContain(
      '#합성',
    );
  });
});
describe('sheet back and reading position', () => {
  it.each([true, false])(
    'dismissible=%s locks the background, treats Android back and outside tap consistently and restores scroll',
    async (dismissible) => {
      const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      Object.defineProperty(window, 'scrollY', {
        value: 450,
        configurable: true,
      });
      const container = document.createElement('div');
      container.className = 'app-body';
      document.body.append(container);
      const root = createRoot(container),
        close = vi.fn();
      await act(() =>
        root.render(
          createElement(
            Sheet,
            { title: '합성 창', close, dismissible },
            createElement('button', null, '선택'),
          ),
        ),
      );
      expect(document.body.style.position).toBe('fixed');
      expect(document.body.style.top).toBe('-450px');
      expect(container.hasAttribute('inert')).toBe(true);
      await act(() => window.dispatchEvent(new Event('goltou:close-sheet')));
      await act(() =>
        document
          .querySelector('.dim')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true })),
      );
      expect(close).toHaveBeenCalledTimes(dismissible ? 2 : 0);
      await act(() => root.unmount());
      expect(container.hasAttribute('inert')).toBe(false);
      expect(document.body.style.position).toBe('');
      expect(scroll).toHaveBeenCalledWith(0, 450);
    },
  );
});
