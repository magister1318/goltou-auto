# 골투 API 계약: `/auto`

골투오토 앱만 쓰는 API입니다. 구현 위치는 goltou-hybrid 저장소의 `API/routes/auto.js`(마운트 `/auto`)와 `API/utilities/auto/`. 앱과 서버는 이 문서만 보고 맞춥니다. 바꿀 때는 이 문서를 먼저 고칩니다.

## 공통

- 모두 `POST`, 본문 JSON(`Content-Type: application/json`), 응답 JSON.
- 성공 `{ "ok": true, "data": ... }`, 실패 `{ "ok": false, "code": "...", "message": "사용자에게 보여 줄 한국어 문장" }`.
- 실패 코드: `auth`(토큰 없음·만료·폐기), `forbidden`(등급 부족), `invalid`(입력 오류), `not_found`, `conflict`, `server`.
- `/auto/login`을 뺀 모든 요청은 헤더 `Authorization: Bearer <token>`. 서버는 매 요청 `gf_user`를 다시 읽어 `is_disable = 0`이고 `user_type >= 3`인지 확인합니다. 아니면 `forbidden`.
- 역할: `manager`(3~6), `staff`(7), `admin`(8·9).
- SQL은 바인딩만 씁니다. 응답에 회원 정보 칸(비밀번호 해시, 연락처 등)을 넣지 않습니다. 상품 응답은 아래 적힌 칸만 내보냅니다.
- 날짜·시각은 ISO 8601 문자열(KST 기준 날짜는 `YYYY-MM-DD`).

## 로그인

### `POST /auto/login`

입력 `{ "loginId": "...", "password": "...", "device": { "kind": "android", "model": "SM-A305N", "appVersion": "0.1.0" } }`

- 비밀번호 확인은 골투 기존 로그인과 같은 규칙으로 합니다(기존 로그인 화면과 `user` 라우트가 쓰는 해시 방식을 그대로 따름). 규칙을 새로 만들지 않습니다.
- `user_type < 3`이면 `forbidden`, 문장 "골투오토는 골투 매니저와 직원만 쓸 수 있습니다."
- 성공하면 토큰을 발급합니다. 토큰은 무작위 32바이트(base64url), DB에는 SHA-256 해시만 저장. 유효 30일이며 쓸 때마다 연장.
- 같은 아이디로 5분에 10번 넘게 실패하면 잠시 막습니다(`invalid`, "잠시 뒤 다시 해 주세요.").

출력 `data`: `{ "token": "...", "user": { "userNo": 12, "name": "김매니저", "userType": 4, "role": "manager" } }`

### `POST /auto/logout`

현재 토큰을 폐기. `data: {}`

### `POST /auto/me`

`data`: `{ "user": {...위와 같음}, "settings": { "closingText": "", "defaultHashtags": ["골투"], "bandDailyLimit": 3 } }`

## 상품

### `POST /auto/products/list`

입력 `{ "q": "", "country": "", "region": "", "month": "2026-12", "sort": "recent" | "departure", "onlyUnposted": false, "page": 1, "pageSize": 20 }` (모두 선택, `pageSize` 최대 50)

- 대상: `gf_board_foregin_tour`에서 `gf_is_comment = 0 AND gf_is_disable = 0`.
- `month`가 있으면 그 달에 출발일(`gf_start_date_0..9`, 가격 > 0)이 하나라도 있는 상품.
- `onlyUnposted`: 요청한 사람이 블로그와 밴드 어느 쪽에도 `draft_saved`/`published` 기록이 없는 상품.
- `myPosts.band`에는 `stopped_before_post`도 표시합니다. 밴드 작성기 확인이 남은 상태이며 저장된 임시글로 표시하지 않습니다.

출력 `data`: 
```json
{ "total": 42, "items": [ {
  "productNo": 1234, "title": "...", "country": "베트남", "region": "다낭",
  "thumbUrl": "https://api.goltou.kr/...", "priceFrom": 1190000, "departureCount": 6,
  "updatedAt": "2026-11-10T09:00:00+09:00",
  "myPosts": { "blog": { "status": "published", "at": "2026-11-10" } , "band": null }
} ] }
```

### `POST /auto/products/get`

입력 `{ "productNo": 1234 }`

출력 `data`:
```json
{ "productNo": 1234, "title": "...", "country": "베트남", "region": "다낭",
  "contentsHtml": "<p>...</p>",
  "images": [ { "order": 1, "url": "https://..." } ],
  "departures": [ { "date": "2026-12-03", "price": 1190000 } ],
  "golfCourses": ["..."],
  "productUrl": "https://goltou.kr/...",
  "updatedAt": "...", "contentHash": "sha256 of title+contents+images+departures" }
```

- `images`는 원본 주소(WebP 변환본이 아닌 원본). 순서는 상품 등록 순서.
- `departures`는 가격이 0보다 큰 것만, 날짜 오름차순.
- `productUrl`은 골투 화면에서 그 상품이 열리는 주소. 기존 화면의 공유 주소 규칙을 그대로 씁니다.

## 등록 기록

### `POST /auto/posts/start`

입력 `{ "productNo": 1234, "channel": "blog" | "band", "mode": "draft" | "publish", "target": { "name": "해외골프" , "key": "" }, "options": { "polish": false, "closing": false, "linkCard": false }, "contentHash": "..." }`

- `channel = band`이고 같은 사람이 같은 밴드(`target.key`)에 오늘 올린 건수가 `bandDailyLimit` 이상이면 `conflict`. `stopped_before_post`도 하루 한도에 포함합니다.

출력 `data`: `{ "postNo": 88 }`

### `POST /auto/posts/update`

입력 `{ "postNo": 88, "status": "running" | "draft_saved" | "published" | "failed" | "stopped" | "stopped_before_post", "step": 4, "failReason": "", "postUrl": "" }`

`stopped_before_post`는 **band 전용**이며 블로그에는 허용하지 않습니다. 작성기 입력·대조 후 게시 전 멈춤이며 서버에 저장된 임시글이 아닙니다. 작성 취소를 확인하면 `stopped`, 사용자 게시 후 새 글 주소와 본문·사진 대조까지 확인하면 `published`로 갱신합니다.

- 허용 전이: `stopped_before_post → published | stopped | stopped_before_post`. 같은 상태·내용의 갱신은 멱등적이며 새 기록이나 하루 건수를 추가하지 않습니다.
- `stopped_before_post`에서 `running` 또는 `draft_saved`로 되돌릴 수 없습니다. 위 세 상태 이외의 전이도 허용하지 않습니다.
- 이 상태는 밴드 하루 한도에 포함되고 상품 목록의 `myPosts.band`와 등록 기록에 표시됩니다.
- 기록 갱신이 실패하면 앱은 사이트의 입력·대조 결과를 보존하고 `RECORD_FAILED:<API 코드>`와 안전한 한국어 API 안내를 표시합니다. 자동 재요청하지 않으며 사용자가 `기록 다시 시도`를 눌렀을 때 같은 `postNo`와 동일 갱신 본문만 재전송합니다. 사이트 입력·저장·게시를 다시 실행하지 않습니다. 서버 반영 및 실제 계정에서의 새 상태 수용 확인은 별도 작업입니다.

- 본인 기록만 고칠 수 있습니다. `published`와 `draft_saved`에서 `running`으로 되돌릴 수 없습니다.

### `POST /auto/posts/list`

입력 `{ "scope": "mine" | "all", "page": 1, "pageSize": 20 }`. `all`은 `user_type >= 7`만, 아니면 `forbidden`.

출력 `data`: `{ "total": 12, "items": [ { "postNo": 88, "productNo": 1234, "productTitle": "...", "channel": "blog", "mode": "draft", "targetName": "해외골프", "status": "draft_saved", "step": 7, "failReason": "", "postUrl": "", "userName": "김매니저", "startedAt": "...", "finishedAt": "...", "productChanged": false } ] }`

- `productChanged`: 기록의 `contentHash`와 지금 상품의 해시가 다르면 `true`.

## 설정

### `POST /auto/settings/save` (관리자 8·9만)

입력 `{ "closingText": "...", "defaultHashtags": ["..."], "bandDailyLimit": 3 }`. 읽기는 `/auto/me`.

## 테이블

- `gf_auto_session`(token_hash, user_no, device_kind, device_model, app_version, created_at, last_used_at, expires_at, revoked_at)
- `gf_auto_post`(post_no, user_no, product_no, channel, mode, target_name, target_key, options_json, content_hash, status, step, fail_reason, post_url, started_at, finished_at)
- `gf_auto_setting`(setting_key, setting_value, updated_at, updated_by)

`API/sql/YYYYMMDD_create_auto_tables.sql`과 `_rollback.sql`을 함께 둡니다. 문자셋 `utf8mb4`.
