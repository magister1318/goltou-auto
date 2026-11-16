import { expect, it } from 'vitest';
import type { Job } from '@goltou/core/protocol';
import type { Post } from '@goltou/api-client';
import { targetStatus, historyStatus, resultKind } from '../src/ux-state';
import { jobMessage } from '../src/job-message';
import { safeFailureCode } from '@goltou/sites';

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
