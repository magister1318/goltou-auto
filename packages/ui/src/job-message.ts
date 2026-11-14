import type { Job } from '@goltou/core/protocol';
/** Never show engine codes, page messages, identifiers or transport errors. */
export function jobMessage(job: Job): [string, string] {
  const code = job.failureCode ?? '';
  if (job.status === 'draft_unverified' || code === 'BLOG_DRAFT_SAVED_UNVERIFIED') return [
    '임시저장은 됐지만 내용을 다시 확인하지 못했습니다',
    '네이버 블로그 앱의 임시저장함에서 저장 시각과 내용을 확인해 주세요. 같은 글을 바로 다시 저장하지 마세요.',
  ];
  if (code === 'DRAFT_SAVE_UNCONFIRMED') return [
    '임시저장됐는지 확인하지 못했습니다.',
    '네이버 블로그 앱의 임시저장함에서 저장 시각과 내용을 확인해 주세요. 같은 글을 바로 다시 저장하지 마세요.',
  ];
  if (
    job.publicationUncertain ||
    /BAND_POST_UNCONFIRMED|BLOG_PUBLISH|PUBLISH_RESPONSE|PUBLISH_IDENTITY/.test(
      code,
    )
  )
    return [
      '게시됐는지 확인하지 못했습니다.',
      '네이버 또는 밴드 앱에서 글을 확인한 뒤 담당자에게 알려 주세요. 같은 글을 다시 올리지 마세요.',
    ];
  const publicState = job.targetResults?.some((t) => t.status === 'published')
    ? '이미 발행한 글이 있습니다.'
    : job.targetResults?.some((t) => t.status === 'draft_saved')
      ? '블로그에는 임시저장됐으며 공개되지 않았습니다.'
      : '글은 공개되지 않았습니다.';
  const cause = /PHOTO_(DOWNLOAD|HOST)|NETWORK|TIMEOUT/.test(code)
    ? '사진을 옮기는 도중 연결이 끊겼습니다.'
    : /READBACK|MISMATCH/.test(code)
      ? '옮긴 내용이 원문과 달라 멈췄습니다.'
      : /LIMIT/.test(code)
        ? '이곳에 올릴 수 있는 글이나 사진 수를 넘었습니다.'
        : /CONTROL|EDITOR|SURFACE/.test(code)
          ? '글쓰기 화면이 평소와 달라 멈췄습니다.'
          : /RECORD/.test(code)
            ? '등록 기록을 저장하지 못했습니다.'
            : job.status === 'stopped'
              ? '옮기기를 중단했습니다.'
              : '끝까지 옮기지 못했습니다.';
  return [
    `${publicState} ${cause}`,
    /RECORD/.test(code)
      ? '기록 다시 시도를 눌러 주세요. 글은 다시 올리지 않습니다.'
      : '등록 기록을 확인한 뒤 다시 시도해 주세요. 같은 문제가 계속되면 담당자에게 알려 주세요.',
  ];
}
