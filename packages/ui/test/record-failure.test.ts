import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecordFailureActions } from '../src/RecordFailureActions';
import { FailureDetail } from '../src/FailureDetail';

describe('record failure actions', () => {
  it('keeps the filled Band composer visible and discardable alongside one record retry', () => {
    const job = { step: 6, activeTargetKey: '111', targetResults: [{ channel: 'band' as const, key: '111', name: '로컬', status: 'stopped_before_post' as const }], title: 'PRIVATE-TITLE', message: 'PRIVATE-BODY', failureCode: 'RECORD_FAILED:invalid' };
    const html = renderToStaticMarkup(createElement(RecordFailureActions, { job, busy: false, retry() {}, showBand() {}, discard() {} }));
    expect(html).toContain('밴드 화면 보기'); expect(html).toContain('버리기');
    expect(html.match(/기록 다시 시도/g)).toHaveLength(1);
    expect(html).not.toMatch(/PRIVATE|이어하기|게시 여부 확인/);
    const detail = renderToStaticMarkup(createElement(FailureDetail, { job }));
    expect(detail).toContain('RECORD_FAILED:invalid'); expect(detail).not.toMatch(/PRIVATE/);
  });
  it('offers only record retry after a verified blog save, with all controls disabled in flight', () => {
    const html = renderToStaticMarkup(createElement(RecordFailureActions, { job: { step: 6, targetResults: [{ channel: 'blog', key: '', name: '로컬', status: 'draft_saved' }] }, busy: true, retry() {}, showBand() {}, discard() {} }));
    expect(html).toContain('기록 다시 시도'); expect(html).toContain('disabled');
    expect(html).not.toMatch(/밴드 화면 보기|버리기/);
  });
});
