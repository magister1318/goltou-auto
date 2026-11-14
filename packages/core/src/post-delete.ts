import { ApiError, type Post } from '@goltou/api-client';
import { deleteBlogPost, openPostDeletionRead, verifyPostAbsentFromList, deletePageSource, read, verifyPostGone, type DeletePage, type DeleteLog } from '@goltou/sites';
import type { SurfaceHost } from '@goltou/surface';

export { canDeletePost, deletedPost, deletedUpdate, requireDeletablePost } from './post-delete-policy';
import { requireDeletablePost } from './post-delete-policy';

/** Opens only the record's URL. A prior uncertain click is resolved by reading
 * that URL before any further deletion, including after restarting the app. */
export async function removeRecordedBlogPost(host: SurfaceHost, post: Post, log: DeleteLog = async () => {}) {
  requireDeletablePost(post);
  const surface = await host.create('naver');
  try {
    await surface.blockRequests?.(['/RabbitWrite.naver', '/RabbitUpdate.naver', '/RabbitTempPostWrite.naver', '/RabbitTempPostUpdate.naver'].map(pathname => ({ hostname: 'blog.naver.com', pathname })));
    await log({ item: 80, pass: 1 });
    if (await openPostDeletionRead(surface, post.postUrl)) { await log({ item: 81, pass: 1 }); await verifyPostAbsentFromList(surface, post.postUrl, post.productTitle); return; }
    await surface.show();
    const pages = await read<DeletePage[]>(surface, deletePageSource);
    if (!pages.some(p => p.titles.length)) {
      await verifyPostGone(surface, { url: post.postUrl, title: post.productTitle });
      return;
    }
    await deleteBlogPost(surface, { url: post.postUrl, title: post.productTitle }, log);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const codes = ['OBSERVATION_TIMEOUT', 'SURFACE_NAVIGATION_TIMEOUT', 'BLOG_POST_DELETE_CONFIRM_UNCONFIRMED', 'BLOG_POST_DELETE_READ_ALERT_UNCONFIRMED', 'BLOG_POST_DELETE_LIST_UNCONFIRMED', 'SURFACE_READ_FAILED_OR_SIDE_EFFECT'];
    await log({ item: 90, pass: 0, actual: codes.indexOf(code) + 1 });
    const reason = code.match(/^BLOG_POST_DELETE_CHECK_(\d+)$/)?.[1];
    const messages: Record<string, string> = {
      '1': '기록에 해당하는 글 한 건을 확인하지 못했습니다.',
      '2': '네이버 글 제목이 발행 기록의 제목과 다릅니다.',
      '3': '네이버 글 주소와 글 번호가 발행 기록과 다릅니다.',
      '4': '내 글의 수정·삭제 버튼을 확인하지 못했습니다.',
      '5': '이 글의 삭제 링크를 하나로 확인하지 못했습니다.',
      '6': '화면이 움직여 삭제 링크의 위치가 안정되지 않았습니다.',
      '7': '삭제 링크가 다른 화면 요소에 가려져 있습니다.',
      '8': '골투오토 화면과 창의 포커스를 확인해 주세요.',
      '9': '이미 열린 확인창이 있어 삭제를 멈췄습니다.',
    };
    throw new ApiError('conflict', reason ? `${messages[reason] ?? '삭제할 글을 확인하지 못했습니다.'} 삭제하지 않고 멈췄습니다.` : '글 삭제 결과를 확인하지 못했습니다. 등록 기록은 바꾸지 않았습니다. 다시 시도하면 먼저 글의 존재 여부를 읽습니다.');
  } finally { await host.destroy(surface); }
}
