// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversionPreview } from '../src/ConversionPreview';
import type { InputPlan } from '@goltou/core';
import { failedStepLabel, logReasonLabel } from '../src/JobLogs';

describe('Band preview matches the full post and folded feed', () => {
  it('keeps exact wording and all line breaks, 29 ordered full-width photos, links and tags', () => {
    const body = Array.from({ length: 159 }, (_, i) => `합성 문단 ${i}`).join('\n') + '\n#합성 #태그\nhttps://example.invalid/a https://example.invalid/b';
    const photos = Array.from({ length: 29 }, (_, i) => `https://www.goltou.com/synthetic-${i}.jpg`);
    const plan: InputPlan = { channel: 'band', steps: [{ kind: 'text', role: 'body', text: body }, { kind: 'photos', urls: photos }], discarded: [], notices: [] };
    document.body.innerHTML = renderToStaticMarkup(<ConversionPreview plan={plan} expanded ratios={{}} droppedStruckCharacters={0} />);
    const text = document.querySelector('.band-full-text')!;
    expect(text.textContent).toBe(body);
    expect(text.querySelectorAll('a')).toHaveLength(2); expect(text.querySelectorAll('.band-hashtag')).toHaveLength(2);
    expect(document.querySelectorAll('.band-photo-stack > .preview-photo')).toHaveLength(29);
    expect(document.querySelectorAll('.band-feed-tile')).toHaveLength(3); expect(document.querySelector('.band-remaining')?.textContent).toBe('+26');
    expect(document.querySelector('.band-feed-sample .band-text')?.textContent).toBe(Array.from(body).slice(0, 115).join('') + '… 더보기');
    expect(document.querySelector('.band-full-text')?.nextElementSibling?.className).toBe('band-photo-stack');
    expect(plan.steps[0]).toMatchObject({ text: body }); expect(plan.steps[1]).toMatchObject({ urls: photos });
  });
  it('explains failure steps and reasons in Korean without requiring a raw code', () => {
    expect(failedStepLabel('sites.band.plan.BandExecution.publish')).toBe('게시와 게시 확인');
    expect(logReasonLabel('QUERY_BLOCKED')).toContain('차단'); expect(logReasonLabel('INTERRUPTED')).toContain('앱이 종료');
    expect(logReasonLabel('UNEXPECTED_FAILURE')).not.toContain('UNEXPECTED_FAILURE');
  });
});
