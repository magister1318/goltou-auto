import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlogVisibilityChoice, PublishConfirmation } from '../src/BlogVisibilityChoice';
describe('blog publish choices', () => {
  it.each(['public', 'private'] as const)('shows explicit choices and confirmation for %s', value => {
    const html = renderToStaticMarkup(createElement(BlogVisibilityChoice, { value, change: vi.fn() }));
    expect(html).toContain('전체공개'); expect(html).toContain('비공개');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    const confirmation = renderToStaticMarkup(createElement(PublishConfirmation, { visibility: value, count: 1, busy: false, back: vi.fn(), start: vi.fn() }));
    expect(confirmation).toContain(value === 'private' ? '비공개로 발행합니다' : '전체공개로 발행합니다');
    expect(confirmation).toContain('확인하고 발행 시작'); expect(confirmation).toContain('role="alertdialog"');
  });
});
