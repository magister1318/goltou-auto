import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makePreview } from '../../core/src/preparation';
import { fixtureProduct } from '../../core/test/fixtures/catalog';
import { ConversionPreview } from '../src/ConversionPreview';

describe('struck text preview notice', () => {
  it.each(['blog', 'band'] as const)('shows only the mandatory count in the collapsed %s preview', channel => {
    const preview = makePreview(fixtureProduct('<p>첫 안내</p>'.repeat(6) + '<p><del>PRIVATE 999</del>남은 안내</p>', 0), {});
    const html = renderToStaticMarkup(createElement(ConversionPreview, { plan: preview[channel], expanded: false, droppedStruckCharacters: preview.droppedStruckCharacters }));
    expect(html.match(/취소선 글자 11자는 옮기지 않습니다/g)).toHaveLength(1);
    expect(html).not.toMatch(/PRIVATE|999|input|button/);
    expect(html).toContain('<p>취소선 글자 11자는 옮기지 않습니다</p>');
  });
  it('does not show an omission notice for ordinary text', () => {
    const preview = makePreview(fixtureProduct('<p>현재 18홀</p>', 0), {});
    const html = renderToStaticMarkup(createElement(ConversionPreview, { plan: preview.blog, expanded: true, droppedStruckCharacters: preview.droppedStruckCharacters }));
    expect(html).not.toContain('취소선 글자');
    expect(html).toContain('현재 18홀');
  });
});
