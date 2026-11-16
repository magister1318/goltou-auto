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
  historyLine,
} from '../src/ux-state';
import { ConversionPreview } from '../src/ConversionPreview';
import { bandText, photoUrls } from '@goltou/sites';
import type { InputPlan } from '@goltou/core';
import type { Job } from '@goltou/core/protocol';
import type { Post } from '@goltou/api-client';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
describe('WP17 choices and channel outcomes', () => {
  it.each(['draft_saved', 'running', 'stopped', 'stopped_before_post', 'failed'] as const)(
    'never adds a visibility label to a %s blog row, including stale known visibility', status => {
      for (const blogVisibility of [undefined, 'public', 'private'] as const) {
        const post = { channel: 'blog', status, blogVisibility } as Post;
        const line = historyLine(post, '11.16 10:00');
        expect(line).toBe(`블로그 ${historyStatus(post)} · 11.16 10:00`);
        expect(line).not.toMatch(/공개 범위|비공개|전체공개/);
      }
    },
  );
  it('keeps draft copy, published visibility and band destinations distinct', () => {
    const post = { channel: 'blog', status: 'draft_saved' } as Post;
    expect(historyLine(post, '11.16 10:00')).toBe('블로그 임시저장 · 11.16 10:00');
    expect(historyLine({ ...post, status: 'published' }, '날짜')).toBe('블로그 발행 · 공개 범위 확인 필요 · 날짜');
    expect(historyLine({ ...post, status: 'published', blogVisibility: 'private' }, '날짜')).toBe('블로그 발행 · 비공개 · 날짜');
    expect(historyLine({ ...post, status: 'published', blogVisibility: 'public' }, '날짜')).toBe('블로그 발행 · 전체공개 · 날짜');
    expect(historyLine({ ...post, status: 'failed', failReason: 'BLOG_PUBLISH_UNCONFIRMED' }, '날짜')).toBe('블로그 확인 필요 · 날짜');
    expect(historyLine({ ...post, status: 'failed', failReason: 'BLOG_FORMATTING_AFTER_SAVE:1' }, '날짜')).toBe('블로그 확인 필요 · 날짜');
    expect(historyLine({ ...post, channel: 'band', status: 'published', targetName: '합성 밴드' }, '날짜')).toBe('밴드 게시 · 합성 밴드 · 날짜');
    expect(historyLine({ ...post, channel: 'band', status: 'stopped', failReason: 'BAND_POST_ALREADY_DELETED', targetName: '합성 밴드' }, '날짜')).toBe('밴드에서 이미 삭제됨 · 합성 밴드 · 날짜');
  });
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
        text: '강조 문의 #본문',
        runs: [
          { text: '강조', bold: true },
          { text: ' 문의 #본문', href: 'https://example.invalid/ask' },
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
    expect(node.querySelector('.band-full-text')!.textContent).toBe(bandText(band));
    expect(
      node.querySelectorAll('.band-photo-stack .preview-photo'),
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
    expect([...node.querySelectorAll('.tag-box > span')].map(e => e.textContent)).toEqual(['태그 칸', '합성', '본문']);
    expect(node.querySelector('.post-body')!.textContent).toContain('강조 문의 #본문');
    expect(node.querySelector('.post-body')!.textContent).not.toContain(
      '#합성',
    );
  });
  it('shows the selected band only in the preview header and uses the mock hint until one is known', () => {
    const plan: InputPlan = { channel: 'band', steps: [{ kind: 'text', role: 'body', text: '원문' }], discarded: [], notices: [] };
    const node = document.createElement('div');
    for (const bandName of [undefined, '합성 밴드']) {
      node.innerHTML = renderToStaticMarkup(createElement(ConversionPreview, { plan, bandName, expanded: true, droppedStruckCharacters: 0 }));
      expect(node.querySelector('.post-caption')!.textContent).toBe(`밴드 글${bandName || '밴드를 고르면 이름이 나옵니다'}`);
      expect(node.querySelector('.band-full-text')!.textContent).toBe('원문');
    }
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
