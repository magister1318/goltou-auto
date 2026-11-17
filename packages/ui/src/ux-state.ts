import type { Job, TargetResult } from '@goltou/core/protocol';
import type { Post } from '@goltou/api-client';
import { formattingMessage } from './formatting-message';
import { deletedPost } from '@goltou/core/post-delete-policy';
import { bandPostBlocked } from '@goltou/sites';
export { bandPostBlocked };

export function bandChoiceReason(input: {
  blog: boolean;
  band: boolean;
  loading: boolean;
  failed: boolean;
  selected: boolean;
}) {
  if (!input.blog && !input.band) return '올릴 곳을 하나 이상 골라 주세요.';
  if (!input.band) return '';
  if (input.loading)
    return '밴드 목록을 읽고 있습니다. 밴드를 끄면 블로그만 바로 발행할 수 있습니다.';
  if (input.failed) return '밴드를 끄면 블로그만 발행할 수 있습니다.';
  return input.selected ? '' : '올릴 밴드를 골라야 다음으로 갈 수 있습니다.';
}
export function uncertainReason(reason = '') {
  return /DRAFT_SAVE_UNCONFIRMED|BLOG_SAVED_READBACK_|BLOG_PUBLISHED_READBACK_|BAND_POST_UNCONFIRMED|BAND_PUBLISHED_READBACK_(?:MISMATCH|UNAVAILABLE)|BLOG_PUBLISH_(?:UNCONFIRMED|RESPONSE_UNCONFIRMED|ID_UNCONFIRMED|ALREADY_ATTEMPTED|RESPONSE_EVIDENCE_FAILED|ID_AMBIGUOUS)|PUBLICATION_UNCERTAIN/.test(
    reason,
  );
}
export function targetStatus(job: Job, target: TargetResult): string {
  if (target.postUrl && target.status==='failed') return '확인 필요';
  if (formattingMessage(target.reason)) return '확인 필요';
  if (target.status === 'published')
    return target.channel === 'band' ? '게시됨' : '발행됨';
  if (target.status === 'draft_saved') return '임시저장됨';
  if (target.channel === 'band' && bandPostBlocked(target.reason)) return '게시 요청 차단 · 게시되지 않음';
  if (
    target.reason === 'BLOG_DRAFT_SAVED_UNVERIFIED' ||
    uncertainReason(target.reason)
  )
    return '확인 필요';
  const current = job.activeTargetKey
    ? target.key === job.activeTargetKey
    : target.channel ===
      (job.service === 'band' || job.step === 6 ? 'band' : 'blog');
  if (current && job.publicationUncertain) return '확인 필요';
  if (target.status === 'failed') return '실패';
  if (
    current &&
    [
      'dialog_paused',
      'login_paused',
      'recovery_paused',
      'user_paused',
    ].includes(job.status)
  )
    return '확인을 기다리는 중';
  if (target.status === 'running')
    return current && job.status === 'running' ? '옮기는 중' : '시작 전';
  return '중단함';
}
export function targetName(
  job: Job,
  target: Pick<TargetResult, 'channel' | 'name'>,
) {
  return target.channel === 'blog'
    ? `블로그 · ${job.blogVisibility === 'private' ? '비공개' : '전체공개'}`
    : `밴드 · ${target.name}`;
}
export function resultKind(job: Job) {
  if (job.status === 'record_failed') return 'record';
  if (bandPostBlocked(job.failureCode)) return 'blocked';
  if (job.publicationUncertain || uncertainReason(job.failureCode))
    return 'uncertain';
  if (
    [
      'user_paused',
      'dialog_paused',
      'channel_paused',
      'stopped_before_post',
    ].includes(job.status)
  )
    return 'paused';
  return 'failed';
}
export function historyStatus(post: Post) {
  if (post.postUrl && post.status==='failed') return '확인 필요';
  if (formattingMessage(post.failReason)) return '확인 필요';
  if (post.channel === 'band' && bandPostBlocked(post.failReason)) return '게시 요청 차단 · 게시되지 않음';
  if (
    uncertainReason(post.failReason) ||
    post.failReason === 'BLOG_DRAFT_SAVED_UNVERIFIED'
  )
    return '확인 필요';
  if (post.status === 'failed') return '실패 · 공개되지 않음';
  if (post.status === 'published')
    return post.channel === 'band' ? '게시' : '발행';
  if (post.status === 'draft_saved') return '임시저장';
  return post.status === 'running' ? '진행 중' : '중단';
}

export function historyLine(post: Post, date: string): string {
  const deleted = deletedPost(post);
  const destination = post.channel === 'band' ? post.targetName
    : post.status === 'published' && !deleted
      ? post.blogVisibility === 'private' ? '비공개'
        : post.blogVisibility === 'public' ? '전체공개' : '공개 범위 확인 필요'
      : '';
  return [
    post.failReason === 'BAND_POST_ALREADY_DELETED' && deleted ? '밴드에서 이미 삭제됨' : `${post.channel === 'blog' ? '블로그' : '밴드'} ${deleted ? '삭제함' : historyStatus(post)}`,
    destination,
    date,
  ].filter(Boolean).join(' · ');
}

/** History lacks the live creation latch, so unknown failures never invite replay. */
export function canRetryHistory(post: Post) {
  return post.status === 'failed' && !post.postUrl && !uncertainReason(post.failReason) && !formattingMessage(post.failReason) &&
    (/^PHOTO_(DOWNLOAD|HOST)_/.test(post.failReason) || post.step < 5 && /^(CONTROL_NOT_FOUND:|BLOG_READBACK_MISMATCH:|BAND_READBACK_MISMATCH:|NETWORK_|CDP_TIMEOUT:)/.test(post.failReason));
}
