// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveProgress } from '../src/LiveProgress';
import { formattingMessage } from '../src/formatting-message';
import { historyStatus, targetStatus } from '../src/ux-state';
import { jobMessage } from '../src/job-message';
import type { Job } from '@goltou/core/protocol';
import type { PreparedPreview } from '@goltou/core';
import { updateInputProgress } from '../../core/src/input-progress';

it('renders only acknowledged live text, actual bold and confirmed links while formatting is still in progress', () => {
  const event = { channel: 'blog', stage: 'write', phase: 'progress', blockKind: 'paragraph', blockIndex: 0, fraction: .99, at: 0 };
  const job = { id: 1, step: 4, status: 'running', targets: [{ channel: 'blog' }], activity: event, activityLog: [event], blogLiveRuns: { 0: [{ text: '굵기', bold: true }, { text: ' 문의', href: 'https://example.invalid/ask' }] } } as unknown as Job;
  const preview = { blog: { steps: [{ kind: 'text', role: 'body', text: '굵기 문의 아직 입력하지 않음', runs: [{ text: '굵기 문의 아직 입력하지 않음', bold: true }] }] } } as PreparedPreview;
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(createElement(LiveProgress, { job, preview }));
  expect(host.querySelector('.paper-content strong')!.textContent).toBe('굵기');
  expect(host.querySelector('.paper-content a')!.getAttribute('href')).toBe('https://example.invalid/ask');
  expect(host.querySelector('.paper-content')!.textContent).toBe('굵기 문의');
  delete job.blogLiveRuns;
  host.innerHTML = renderToStaticMarkup(createElement(LiveProgress, { job, preview }));
  expect(host.querySelector('.paper-content')!.textContent).toBe('');
});
it.each(['INPUT', 'BEFORE_SAVE', 'AFTER_SAVE', 'REOPENED', 'PUBLISHED'])('shows %s formatting failure as 확인 필요 with paragraph positions in results and history', stage => {
  const reason = `BLOG_FORMATTING_${stage}:2,5`;
  const target = { channel: 'blog', key: 'fixture', name: '', status: 'stopped', reason } as const;
  const job = { status: 'draft_unverified', failureCode: reason } as Job;
  expect(targetStatus(job, target)).toBe('확인 필요');
  expect(historyStatus({ status: 'stopped', failReason: reason } as never)).toBe('확인 필요');
  expect(jobMessage(job)[0]).toContain('2, 5번 문단');
  expect(formattingMessage(reason)).toContain('확인 필요');
  expect(formattingMessage('BLOG_FORMATTING_REOPENED:https://example.invalid/private')).toBeNull();
});
it('clears previously acknowledged text and write events when recovery restarts the blog editor', () => {
  const job = { blogLiveRuns: { 2: [{ text: '이전', bold: true }] }, activityLog: [{ channel: 'blog', stage: 'write', phase: 'finish', blockIndex: 2, at: 0 }, { channel: 'band', stage: 'open', phase: 'finish', at: 0 }] } as Job;
  updateInputProgress(job, { characters: 0, totalCharacters: 10, photos: 0, totalPhotos: 0, blogInputReset: true });
  expect(job.blogLiveRuns).toBeUndefined();
  expect(job.activityLog).toHaveLength(1);
  expect(job.activityLog![0]!.channel).toBe('band');
});
