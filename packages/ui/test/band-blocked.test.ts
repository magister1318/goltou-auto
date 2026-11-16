import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Job } from '@goltou/core/protocol';
import type { Post } from '@goltou/api-client';
import { targetStatus, historyStatus, resultKind } from '../src/ux-state';
import { jobMessage } from '../src/job-message';
import { safeFailureCode } from '@goltou/sites';
import { JobLogFailure } from '../src/JobLogs';

it('clearly distinguishes a confirmed create block from an unconfirmed transmitted create in results and history', () => {
  const reason = 'BAND_POST_BLOCKED:TARGET_MISSING';
  const target = { channel: 'band', key: 'synthetic-target', name: '', status: 'failed', reason } as const;
  const job = { status: 'failed', failureCode: reason, publicationUncertain: false } as Job;
  expect(safeFailureCode(new Error(reason), 'FAILED')).toBe(reason);
  expect(targetStatus(job, target)).toBe('게시 요청 차단 · 게시되지 않음');
  expect(historyStatus({ channel: 'band', status: 'failed', failReason: reason } as Post)).toBe('게시 요청 차단 · 게시되지 않음');
  expect(resultKind(job)).toBe('blocked');
  expect(jobMessage(job).join(' ')).toMatch(/게시되지 않았습니다.*승인은 소진/);
  expect(jobMessage(job).join(' ')).not.toContain('TARGET_MISSING');
  expect(targetStatus({ ...job, publicationUncertain: true }, { ...target, reason: 'BAND_POST_UNCONFIRMED' })).toBe('확인 필요');
  expect(historyStatus({ channel: 'band', status: 'failed', failReason: 'BAND_POST_UNCONFIRMED' } as Post)).toBe('확인 필요');
});

it('explains identity discovery and published-content failures without claiming that a known post is private', () => {
  for (const suffix of ['IDENTITY_READ_FAILED', 'IDENTITY_NOT_FOUND', 'IDENTITY_AMBIGUOUS']) {
    const failureCode = `BAND_POST_UNCONFIRMED:${suffix}`;
    const job = { status: 'failed', failureCode, publicationUncertain: true } as Job;
    expect(resultKind(job)).toBe('uncertain');
    expect(historyStatus({ channel: 'band', status: 'failed', failReason: failureCode } as Post)).toBe('확인 필요');
    expect(jobMessage(job).join(' ')).toContain('같은 글을 다시 올리지');
    expect(jobMessage(job).join(' ')).not.toContain(suffix);
  }
  for (const suffix of ['MISMATCH', 'UNAVAILABLE']) {
    const job = { status: 'failed', failureCode: `BAND_PUBLISHED_READBACK_${suffix}`, publicationUncertain: false } as Job;
    expect(jobMessage(job).join(' ')).toContain('글 주소는 등록 기록에 저장');
    expect(jobMessage(job).join(' ')).not.toContain('공개되지 않았습니다');
  }
});

it('labels the new confirmation reasons as publication confirmation in the log screen', () => {
  const html = renderToStaticMarkup(createElement(JobLogFailure, { step: 6, reason: 'BAND_POST_UNCONFIRMED:IDENTITY_NOT_FOUND' }));
  expect(html).toContain('게시와 게시 확인'); expect(html).not.toContain('본문 입력');
});
