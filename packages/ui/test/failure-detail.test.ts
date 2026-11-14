import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FailureDetail } from '../src/FailureDetail';

describe('failure screen detail', () => {
  it('renders the stable control and plan position without any job content', () => {
    const job = { step: 4, failureCode: 'CONTROL_NOT_FOUND:BLOG_TAG_INPUT:TEXT_HASHTAGS:97', title: 'PRIVATE-TITLE', message: 'PRIVATE-BODY' };
    const html = renderToStaticMarkup(createElement(FailureDetail, { job }));
    expect(html).toContain('실패 상세'); expect(html).toContain('작업 단계 4/7');
    expect(html).not.toContain(job.failureCode); expect(html).not.toContain('PRIVATE');
    expect(renderToStaticMarkup(createElement(FailureDetail, { job: { step: 4 } }))).toBe('');
  });
});
