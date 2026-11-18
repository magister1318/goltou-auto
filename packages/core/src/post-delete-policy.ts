import { ApiError, type Post, type PostUpdate } from '@goltou/api-client';
import { postIdentity, bandPostIdentity } from '@goltou/sites';
export function canDeletePost(post: Post, scope: 'mine' | 'all') {
  return scope === 'mine' && !!(post.channel === 'blog' ? postIdentity(post.postUrl) : bandPostIdentity(post.postUrl));
}
export function requireDeletablePost(post: Post) {
  if (!canDeletePost(post, 'mine')) throw new ApiError('invalid', '내 등록 기록에서 글 주소를 확인해 주세요.');
}
export const deletedPost = (post: Pick<Post, 'status' | 'failReason'>) => post.status === 'stopped' && ['BLOG_POST_DELETED', 'BLOG_TEST_POST_DELETED', 'BAND_POST_DELETED', 'BAND_POST_ALREADY_DELETED'].includes(post.failReason);
export const deletedUpdate = (post: Pick<Post, 'postNo' | 'step'> & Partial<Pick<Post, 'channel'>>, alreadyAbsent = false): PostUpdate => ({ postNo: post.postNo, status: 'stopped', step: post.step, failReason: post.channel === 'band' ? alreadyAbsent ? 'BAND_POST_ALREADY_DELETED' : 'BAND_POST_DELETED' : 'BLOG_POST_DELETED', postUrl: '' });
