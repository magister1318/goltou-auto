import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient, type Post, type PostUpdate } from '@goltou/api-client';
import { deleteIdentity, requireDeleteConfirmation, type DeletePage } from '@goltou/sites';
import { AppCore, MemoryTokenStore } from '../src/app';
import { canDeletePost, deletedPost, deletedUpdate, requireDeletablePost } from '../src/post-delete-policy';
import type { AppRequest } from '../src/protocol';
const remove = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/post-delete', async original => ({ ...await original<object>(), removeRecordedBlogPost: remove }));
const post: Post = { postNo: 1, productNo: 1, productTitle: '합성 상품', channel: 'blog', mode: 'publish', targetName: '', status: 'published', step: 7, failReason: '', postUrl: 'https://blog.naver.com/synthetic/9001', userName: '', startedAt: 'synthetic', finishedAt: 'synthetic', productChanged: false };
const page: DeletePage = { url: post.postUrl, titles: [post.productTitle], privateLabels: 0, publicLabels: 1, photos: 2, edits: 1, deletes: 1 };
describe('regular deletion identity and record policy', () => {
  it('accepts an ordinary public title and arbitrary photo count, without experiment markers', () => {
    expect(deleteIdentity([page], { url: post.postUrl, title: post.productTitle }).every(i => i.pass === 1)).toBe(true);
  });
  it.each<Partial<DeletePage>>([{ titles: ['changed'] }, { titles: [post.productTitle, post.productTitle] }, { url: page.url.replace('9001', '9002') }, { url: page.url.replace('synthetic', 'other') }, { edits: 0 }, { deletes: 0 }, { deletes: 2 }])('refuses a title, owner or URL mismatch (%#)', change => {
    expect(deleteIdentity([{ ...page, ...change }], { url: post.postUrl, title: post.productTitle }).some(i => i.pass === 0)).toBe(true);
  });
  it.each<Partial<Post>>([{ channel: 'band' }, { status: 'draft_saved' }, { mode: 'draft' }, { postUrl: '' }, { postUrl: 'https://example.invalid/9001' }])('hides and refuses ineligible records (%#)', change => {
    expect(canDeletePost({ ...post, ...change }, 'mine')).toBe(false);
    expect(() => requireDeletablePost({ ...post, ...change })).toThrow();
  });
  it('hides all-scope actions and refuses a changed product without guessing its published title', () => {
    expect(canDeletePost(post, 'all')).toBe(false);
    expect(() => requireDeletablePost({ ...post, productChanged: true })).toThrow('발행 당시 제목');
    expect(deletedPost({ ...post, ...deletedUpdate(post) })).toBe(true);
  });
  it.each(['정말 삭제하시겠습니까?', '삭제하시겠습니까?', '삭제된 글은 복구할 수 없습니다. 삭제하시겠습니까? 추가'])('rejects every other dialog message (%s)', message => {
    expect(() => requireDeleteConfirmation({ id: '1', kind: 'confirm', url: post.postUrl, message }, { url: post.postUrl, postId: '9001' })).toThrow();
  });
});
async function fixture() {
  remove.mockReset(); remove.mockResolvedValue();
  let record = { ...post }, fail = false;
  const updates: PostUpdate[] = [];
  const api = { request: async (route: string, input: unknown) => {
    if (route === '/auto/me') return { user: { userNo: 1, role: 'manager', userType: 4, name: '합성' }, settings: {} };
    if (route === '/auto/posts/list') return { total: 1, items: [record] };
    if (route === '/auto/posts/update') { updates.push(structuredClone(input as PostUpdate)); if (fail) throw new ApiError('server', '합성 실패'); record = { ...record, ...input as PostUpdate, finishedAt: '2026-11-14T12:00:00+09:00' }; return {}; }
    throw new Error('UNEXPECTED_API');
  } } as ApiClient;
  const tokens = new MemoryTokenStore(); await tokens.write('synthetic');
  const app = new AppCore(api, tokens, undefined, undefined, { device: vi.fn(), deleteHost: {} as never });
  await app.restoreSession();
  const call = (command: AppRequest['command'], input: unknown = {}) => app.handle({ type: 'app', id: 1, command, input } as AppRequest);
  return { app, call, updates, change: (value: Partial<Post>) => { record = { ...record, ...value }; }, fail: (value: boolean) => { fail = value; } };
}
describe('confirmed deletion orchestration', () => {
  it('requires an owned record and a fresh explicit confirmation; never changes the record on refusal', async () => {
    const f = await fixture();
    await expect(f.call('posts.delete.prepare', { postNo: 2 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(f.call('posts.delete.confirm', { confirmation: 'invented' })).rejects.toMatchObject({ code: 'invalid' });
    const pending = await f.call('posts.delete.prepare', { postNo: 1 }) as { confirmation: string };
    f.change({ productTitle: '바뀜' });
    await expect(f.call('posts.delete.confirm', pending)).rejects.toMatchObject({ code: 'conflict' });
    expect(remove).not.toHaveBeenCalled(); expect(f.updates).toEqual([]); f.app.dispose();
  });
  it('records only verified deletion on the original record and retries only the same API update', async () => {
    const f = await fixture();
    const pending = await f.call('posts.delete.prepare', { postNo: 1 });
    f.fail(true);
    await expect(f.call('posts.delete.confirm', pending)).rejects.toThrow();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(f.app.snapshot().postDeletion).toMatchObject({ verifiedGone: true, recorded: false });
    await expect(f.call('posts.delete.prepare', { postNo: 1 })).rejects.toMatchObject({ code: 'conflict' });
    f.fail(false); await f.call('posts.delete.retryRecord');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(f.updates).toEqual([deletedUpdate(post), deletedUpdate(post)]);
    expect(f.app.snapshot().postDeletion).toMatchObject({ recorded: true, at: '2026-11-14T12:00:00+09:00' }); f.app.dispose();
  });
  it('makes no update if the site result is unclear', async () => {
    const f = await fixture(); remove.mockRejectedValueOnce(new Error('UNCONFIRMED'));
    const pending = await f.call('posts.delete.prepare', { postNo: 1 });
    await expect(f.call('posts.delete.confirm', pending)).rejects.toThrow('UNCONFIRMED');
    expect(f.updates).toEqual([]); expect(f.app.snapshot().postDeletion).toBeUndefined(); f.app.dispose();
  });
  it('blocks posting and a second deletion while deleting', async () => {
    const f = await fixture(); let finish!: () => void;
    remove.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = await f.call('posts.delete.prepare', { postNo: 1 });
    const active = f.call('posts.delete.confirm', pending);
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    await expect(f.call('posts.delete.prepare', { postNo: 1 })).rejects.toMatchObject({ code: 'conflict' });
    await expect(f.call('job.start', {})).rejects.toMatchObject({ code: 'conflict' });
    finish(); await active; f.app.dispose();
  });
});
