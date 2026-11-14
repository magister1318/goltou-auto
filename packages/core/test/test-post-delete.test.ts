import { describe, expect, it } from 'vitest';
import { identifyTestPost, requireTestDeleteConfirmation, verifyTestPostAbsentFromList, type TestPostPage } from '../src/test-post-delete';
import type { Surface, SurfaceDialog } from '@goltou/surface';
const title = '[골투오토 실험] WP14 private-once synthetic';
const page: TestPostPage = { url: 'https://blog.naver.com/synthetic/9001', titles: [title], privateLabels: 1, publicLabels: 0, photos: 13 };
describe('debug cleanup page identity without a response receipt', () => {
  it.each([page.url, 'https://m.blog.naver.com/synthetic/9001', 'https://blog.naver.com/PostView.naver?blogId=synthetic&logNo=9001'])('accepts all five independent facts from the same page (%s)', url => {
    expect(identifyTestPost([{ ...page, url }], title).postId).toBe('9001');
  });
  it.each<Partial<TestPostPage>>([
    { titles: [] }, { titles: [title, title] }, { titles: ['ordinary'] }, { titles: [title.replace('WP14 private-once', 'other-run')] },
    { titles: [title.replace('[골투오토 실험]', 'other')] }, { privateLabels: 0 }, { privateLabels: 2 }, { publicLabels: 1 },
    { photos: 12 }, { photos: 14 }, { url: '' }, { url: 'https://example.invalid/synthetic/9001' },
    { url: 'https://blog.naver.com/PostList.naver?blogId=synthetic&logNo=9001' },
  ])('refuses a missing, ambiguous or different fact (%#)', change => expect(() => identifyTestPost([{ ...page, ...change }], title)).toThrow('BLOG_TEST_DELETE_REFUSED'));
  it('refuses multiple posts, a different exact title, or facts spread across pages', () => {
    expect(() => identifyTestPost([page, page], title)).toThrow();
    expect(() => identifyTestPost([page], title + 'different')).toThrow();
    expect(() => identifyTestPost([{ ...page, privateLabels: 0 }, { ...page, titles: [] }], title)).toThrow();
  });
  it.each([
    { links: [], titlePresent: false, allowed: false },
    { links: [page.url], titlePresent: false, allowed: false },
    { links: ['https://blog.naver.com/synthetic/9002'], titlePresent: true, allowed: false },
    { links: ['https://blog.naver.com/synthetic/9002'], titlePresent: false, allowed: true },
  ])('requires a populated list, absent identity and absent title (%#)', async ({ links, titlePresent, allowed }) => {
    const surface = { open: async () => {}, evaluateReadOnly: async (expression: string) => expression.includes('innerText') ? titlePresent : expression.includes('e.href') ? links : true } as unknown as Surface;
    const result = verifyTestPostAbsentFromList(surface, page.url, title);
    if (allowed) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toThrow('BLOG_TEST_DELETE_LIST_UNCONFIRMED');
  });
  const receipt = { postId: '9001', url: page.url };
  const dialog: SurfaceDialog = { id: 'synthetic', kind: 'confirm', message: '정말 삭제하시겠습니까?', url: page.url };
  it('accepts only the expected delete confirmation from this post', () => expect(() => requireTestDeleteConfirmation(dialog, receipt)).not.toThrow());
  it('accepts the observed PC post deletion warning with its fixed line break', () => {
    expect(() => requireTestDeleteConfirmation({ ...dialog, message: '삭제된 글은 복구할 수 없습니다.\n삭제하시겠습니까?' }, receipt)).not.toThrow();
  });
  const invalidDialogs: (SurfaceDialog | null | undefined)[] = [
    null, undefined, { ...dialog, kind: 'alert' }, { id: dialog.id, kind: dialog.kind, message: dialog.message },
    { ...dialog, url: page.url.replace('9001', '9002') }, { ...dialog, url: page.url.replace('synthetic', 'other') },
    { ...dialog, message: '다른 작업을 확인하시겠습니까?' }, { ...dialog, message: '정말 삭제하시겠습니까? 추가 문구' },
    { ...dialog, message: '삭제된 글은 복구할 수 없습니다.\n삭제하시겠습니까? 다른 작업' },
    { ...dialog, message: '이 글은 공지로 등록되어 있어 삭제하실 경우\n공지도 함께 삭제됩니다. 삭제하시겠습니까?' },
  ];
  it.each(invalidDialogs.map(value => ({ value })))('refuses an unknown, unrelated or changed confirmation (%#)', ({ value }) => expect(() => requireTestDeleteConfirmation(value, receipt)).toThrow('BLOG_TEST_DELETE_CONFIRM_UNCONFIRMED'));
});
