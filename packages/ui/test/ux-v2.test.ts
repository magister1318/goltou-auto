import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Job } from '@goltou/core/protocol';
import type { PreparedPreview } from '@goltou/core';
import { LiveProgress, progressFraction } from '../src/LiveProgress';
import { jobMessage } from '../src/job-message';
const job = {
  id: 1,
  step: 4,
  status: 'running',
  mode: 'draft',
  current: 0,
  total: 1,
  targets: [{ channel: 'blog', key: 'fixture', name: '시험' }],
  completedSteps: [1, 2, 3],
  startedAt: 0,
  activity: {
    channel: 'blog',
    stage: 'write',
    phase: 'start',
    blockIndex: 0,
    blockTotal: 3,
    blockKind: 'title',
    fraction: 0,
    at: 0,
  },
  activityLog: [],
} as Job;
describe('WP16 live progress and plain failure guidance', () => {
  it('interpolates continuously, never regresses and never reaches 100 before completion', () => {
    const values = [0, 100, 1000, 10000, 1000000].map((now) =>
      progressFraction(job, now),
    );
    expect(values[1]).toBeGreaterThan(values[0]!);
    expect(values[4]).toBeLessThan(1);
    expect(progressFraction({ ...job, step: 1 }, 100, 0.8)).toBe(0.8);
    expect(progressFraction({ ...job, step: 7 }, 1e9)).toBeLessThan(1);
  });
  it('rebuilds from job state and shows thumbnails only after the corresponding engine completion', () => {
    const activity = {
      channel: 'blog',
      stage: 'write',
      phase: 'start',
      blockIndex: 1,
      blockKind: 'photos',
      photoIndex: 0,
      photoTotal: 1,
      at: 0,
    } as const;
    const preview = {
      blog: {
        steps: [
          { kind: 'text', role: 'title', text: '합성 제목' },
          { kind: 'photos', urls: ['https://goltou.kr/fixture.png'] },
        ],
      },
    } as PreparedPreview;
    const render = (phase: 'start' | 'finish') =>
      renderToStaticMarkup(
        createElement(LiveProgress, {
          job: {
            ...job,
            activity: { ...activity, phase },
            activityLog: [{ ...activity, phase }],
          },
          preview,
        }),
      );
    expect(render('start')).toContain('사진 1 올리는 중');
    expect(render('start')).not.toContain(
      'src="https://goltou.kr/fixture.png"',
    );
    expect(render('finish')).toContain('preview-photo');
    expect(render('finish')).not.toContain('사진 1 올리는 중');
  });
  it.each([
    'CONTROL_NOT_FOUND:BLOG_IMAGE_BUTTON:PHOTOS:4',
    'PHOTO_DOWNLOAD_FAILED',
    'BLOG_READBACK_MISMATCH:text',
    'BAND_PHOTO_LIMIT',
    'RECORD_FAILED:server',
    'UNRECOGNIZED_FAILURE',
  ])('maps %s without showing a code or page contents', (failureCode) => {
    const messages = jobMessage({ ...job, failureCode });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('공개되지');
    expect(messages.join(' ')).not.toContain(failureCode);
    expect(messages[1]).toMatch(/확인|시도/);
  });
  it('reports partial publication and ambiguous publication honestly', () => {
    expect(
      jobMessage({
        ...job,
        failureCode: 'PHOTO_DOWNLOAD_FAILED',
        targetResults: [
          {
            channel: 'blog',
            key: 'fixture',
            name: '시험',
            status: 'published',
          },
        ],
      })[0],
    ).toContain('이미 발행한 글');
    expect(
      jobMessage({ ...job, failureCode: 'BAND_POST_UNCONFIRMED' })[0],
    ).toBe('게시됐는지 확인하지 못했습니다.');
    expect(
      jobMessage({ ...job, failureCode: 'BAND_POST_UNCONFIRMED' })[1],
    ).toContain('다시 올리지');
  });
});
