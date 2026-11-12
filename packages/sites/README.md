# packages/sites

네이버 블로그, 밴드, AI Mode 조작 규칙. surface의 공통 약속만 사용.

블로그의 `prepareBlogEditor` / `fillBlog` / `saveAndReopen`은 자동복구 안내에서 기본적으로 클릭 없이 중단한다. 사용자가 앱에서 동의한 해당 작업에만 `autoRecover: 'decline-with-user-consent'`를 전달하면, 정확한 작성 중 글 복구 안내의 `취소`를 누르고 빈 편집기를 다시 확인한다. 이 옵션은 저장된 임시글·발행된 글의 삭제 권한이 아니다.

WP0 예시 제목은 `[골투오토 실험]`으로 시작한다. `blogImageLayout`은 예시 PNG 번호와 앞선 비어 있지 않은 문단 수만 반환하며 사진 주소·계정 정보는 기록하지 않는다.
