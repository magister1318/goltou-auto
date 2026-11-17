import { ApiError, type Post, type PostUpdate } from '@goltou/api-client';
import { postIdentity, bandPostIdentity } from '@goltou/sites';
export function canDeletePost(post: Post, scope: 'mine' | 'all') {
  const hasCreatedReceipt = post.status === 'failed' && (post.channel === 'band'
    ? /^(BAND_POST_UNCONFIRMED(?::[A-Z_]+)?|BAND_PUBLISHED_READBACK_(MISMATCH|UNAVAILABLE))$/.test(post.failReason)
    : /^(BLOG_PUBLISHED_READBACK_(MISMATCH|UNAVAILABLE)|BLOG_PUBLISH_[A-Z_]+|BLOG_FORMATTING_PUBLISHED:[1-9]\d*(?:,[1-9]\d*)*)$/.test(post.failReason));
  return scope === 'mine' && post.mode === 'publish' && (post.status === 'published' || hasCreatedReceipt) && !!(post.channel === 'blog' ? postIdentity(post.postUrl) : bandPostIdentity(post.postUrl));
}
export function requireDeletablePost(post: Post) {
  if (!canDeletePost(post, 'mine')) throw new ApiError('invalid', '앱에서 발행한 내 글만 삭제할 수 있습니다.');
  // productTitle is a live join. Only an unchanged hash proves this is still
  // the API title used by the publisher. Never guess an old title.
  if (post.productChanged || !post.productTitle.trim()) throw new ApiError('conflict', '발행 당시 제목을 확인할 수 없습니다. 상품이 바뀐 기록은 삭제할 수 없습니다.');
}
export const deletedPost = (post: Pick<Post, 'status' | 'failReason'>) => post.status === 'stopped' && ['BLOG_POST_DELETED', 'BLOG_TEST_POST_DELETED', 'BAND_POST_DELETED', 'BAND_POST_ALREADY_DELETED'].includes(post.failReason);
export const deletedUpdate = (post: Pick<Post, 'postNo' | 'step'> & Partial<Pick<Post, 'channel'>>, alreadyAbsent = false): PostUpdate => ({ postNo: post.postNo, status: 'stopped', step: post.step, failReason: post.channel === 'band' ? alreadyAbsent ? 'BAND_POST_ALREADY_DELETED' : 'BAND_POST_DELETED' : 'BLOG_POST_DELETED', postUrl: '' });
