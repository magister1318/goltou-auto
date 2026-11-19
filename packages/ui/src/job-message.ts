import { existingServiceResult } from '@goltou/core/job-safety';
import type { Job } from '@goltou/core/protocol';
import { formattingMessage } from './formatting-message';
import { bandPostBlocked } from '@goltou/sites';
/** Never show engine codes, page messages, identifiers or transport errors. */
export function jobMessage(job: Job): [string, string] {
  const code = job.failureCode ?? '';
  if (code === 'BAND_WRITE_NOT_ALLOWED') return ['이 밴드에서 글을 쓸 권한이 없습니다.', '밴드 관리자에게 글쓰기 권한을 확인해 주세요.'];
  if (code === 'BAND_COMPOSER_UNAVAILABLE') return ['밴드 글쓰기 화면을 열지 못했습니다.', '밴드에서 글쓰기 화면이 열리는지 확인해 주세요.'];
  if (code === 'BAND_TARGET_INVALID') return [
    '밴드 목록이 바뀌었습니다. 새로고침 후 다시 골라 주세요.',
    existingServiceResult(job) ? '앞서 저장하거나 발행한 글은 등록 기록에서 확인해 주세요.' : '밴드에는 게시하지 않았습니다.',
  ];
  if (code === 'POST_RECORD_START_FAILED') return ['등록 기록을 시작하지 못했습니다.', '연결과 등록 기록을 확인해 주세요.'];
  if (code === 'BAND_INPUT_MISMATCH:input') return ['밴드 작성기에 입력한 내용을 확인하지 못했습니다.', '작성 화면을 확인해 주세요.'];
  if (job.readbackIssues?.length) {
    const names = {number:'가격 또는 출발일 숫자',cursor:'커서 위치',input:'입력 결과',href:'링크 주소',photo:'사진 수 또는 순서',table:'표',title:'제목',text:'본문 글자',line_breaks:'줄바꿈 수',photos:'사진 수 또는 순서',order:'본문과 사진 순서',hashtags:'태그',links:'링크 주소',bold:'문단 굵기',visibility:'공개 범위',stability:'화면 로딩 상태'};
    const details = [...new Set(job.readbackIssues.map(issue=>`${issue.paragraph ? `${issue.paragraph}번 문단의 ` : ''}${names[issue.field]}${issue.index ? ` ${issue.index}번째가` : issue.field==='title'?'이':'가'} 계획과 다릅니다.`))].join(' ');
    return [details, existingServiceResult(job) ? '등록 기록에서 저장 또는 게시된 글을 확인해 주세요. 같은 글을 다시 올리지 마세요.' : '저장 또는 게시 전에 멈췄습니다. 내용을 확인해 주세요.'];
  }
  if (/^BLOG_(SAVED|PUBLISHED)_READBACK_/.test(code)) return [
    code.includes('MISMATCH') ? '저장 또는 발행된 글에서 계획과 다른 내용이 있습니다.' : '저장 또는 발행된 글을 끝까지 다시 읽지 못했습니다.',
    '등록 기록에서 해당 글을 확인해 주세요. 같은 글을 다시 올리지 마세요.',
  ];
  if (code.startsWith('BAND_POST_UNCONFIRMED:')) return [
    code.endsWith('IDENTITY_READ_FAILED') ? '생성 응답에 글 주소가 없고 목록도 읽지 못했습니다.' : code.endsWith('IDENTITY_AMBIGUOUS') ? '이번 글과 일치하는 후보가 여러 개라 주소를 확정하지 못했습니다.' : '생성 응답과 목록에서 이번 글을 하나로 확인하지 못했습니다.',
    '등록 기록에서 확인해 주세요. 같은 글을 다시 올리지 마세요.',
  ];
  if (code.startsWith('BAND_PUBLISHED_READBACK_')) return [
    code.includes('MISMATCH') ? '게시한 글에서 계획과 다른 내용이 있습니다.' : '게시한 글의 상세 내용을 끝까지 읽지 못했습니다.',
    '글 주소는 등록 기록에 저장했습니다. 해당 글을 확인해 주세요. 같은 글을 다시 올리지 마세요.',
  ];
  if (code === 'BAND_CREATE_REJECTED') return ['밴드가 게시 요청을 거절했습니다.', '등록 기록을 확인해 주세요. 자동으로 다시 게시하지 않습니다.'];
  if (bandPostBlocked(code)) return [
    '앱이 밴드 게시 요청을 차단해 밴드에는 게시되지 않았습니다.',
    '이번 게시 승인은 소진됐습니다. 같은 작업을 자동으로 다시 제출하지 않습니다. 등록 기록을 확인해 주세요.',
  ];
  const formatting = formattingMessage(code);
  if (formatting) return [formatting, code.startsWith('BLOG_FORMATTING_PUBLISHED:')
    ? '발행된 글에서 서식 확인이 필요합니다. 같은 글을 다시 발행하지 마세요.'
    : /BLOG_FORMATTING_(AFTER_SAVE|REOPENED):/.test(code)
    ? '저장한 글에서 해당 문단을 확인해 주세요. 같은 글을 바로 다시 저장하거나 발행하지 마세요.'
    : '작성 중인 글의 서식을 확인할 수 없어 멈췄습니다.'];
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
  if (existingServiceResult(job)) return [
    job.targetResults?.some(t=>t.status==='published') ? '이미 발행한 글이 있습니다. 해당 글에서 확인할 점이 있습니다.' : '저장 또는 게시된 글에서 확인할 점이 있습니다.',
    '등록 기록에서 해당 글을 확인해 주세요. 같은 글을 다시 올리지 마세요.',
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
