import { ApiError, type Post, type PostUpdate } from '@goltou/api-client';
import { postIdentity } from '@goltou/sites';
export function canDeletePost(post: Post, scope: 'mine' | 'all') {
  return scope === 'mine' && post.channel === 'blog' && post.mode === 'publish' && post.status === 'published' && !!postIdentity(post.postUrl);
}
export function requireDeletablePost(post: Post) {
  if (!canDeletePost(post, 'mine')) throw new ApiError('invalid', '앱에서 발행한 내 블로그 글만 삭제할 수 있습니다.');
  // productTitle is a live join. Only an unchanged hash proves this is still
  // the API title used by the publisher. Never guess an old title.
  if (post.productChanged || !post.productTitle.trim()) throw new ApiError('conflict', '발행 당시 제목을 확인할 수 없습니다. 상품이 바뀐 기록은 삭제할 수 없습니다.');
}
export const deletedPost = (post: Pick<Post, 'status' | 'failReason'>) => post.status === 'stopped' && ['BLOG_POST_DELETED', 'BLOG_TEST_POST_DELETED'].includes(post.failReason);
export const deletedUpdate = (post: Pick<Post, 'postNo' | 'step'>): PostUpdate => ({ postNo: post.postNo, status: 'stopped', step: post.step, failReason: 'BLOG_POST_DELETED', postUrl: '' });
