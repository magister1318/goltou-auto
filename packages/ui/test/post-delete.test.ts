import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Post } from '@goltou/api-client';
import { DeleteConfirmation, PostDeleteAction } from '../src/PostDeleteAction';
const post = { postNo: 1, channel: 'blog', mode: 'publish', status: 'published', postUrl: 'https://blog.naver.com/synthetic/9001' } as Post;
const props = { post, scope: 'mine' as const, busy: false, prepare: async () => ({ confirmation: 'fixture', productTitle: '합성 상품' }), remove: async () => {} };
describe('history deletion action', () => {
  it('shows the action only on own published blog records with a stored URL', () => {
    expect(renderToStaticMarkup(createElement(PostDeleteAction, props))).toContain('글 삭제');
    for (const change of [{ scope: 'all' as const }, { post: { ...post, channel: 'band' as const } }, { post: { ...post, status: 'draft_saved' as const } }, { post: { ...post, postUrl: '' } }]) expect(renderToStaticMarkup(createElement(PostDeleteAction, { ...props, ...change }))).toBe('');
  });
  it('names the product, warns about Naver removal and restoration, and requires a second confirmation', () => {
    const html = renderToStaticMarkup(createElement(DeleteConfirmation, { title: '합성 상품', busy: false, cancel() {}, confirm() {} }));
    for (const text of ['합성 상품', '네이버에서 삭제', '복구할 수 없습니다', '취소', '확인하고 글 삭제', 'alertdialog']) expect(html).toContain(text);
  });
});
