# WP2. 골투 API `/auto`

작업 저장소는 **goltou-hybrid**입니다(이 저장소가 아님). 브랜치 `codex/auto-api`를 `origin/main`에서 만듭니다. goltou-hybrid의 `AGENTS.md`와 이 저장소의 `docs/api-contract.md`를 먼저 읽습니다.

## 목표

`docs/api-contract.md`의 `/auto` API를 goltou-hybrid `API`에 추가합니다. 기존 라우트와 화면은 고치지 않습니다(`API/routes.js`에 마운트 한 줄만 추가).

## 할 일

1. `API/routes/auto.js`, `API/utilities/auto/`(auth, repo, mapper). CMS 구현(`API/routes/cms.js`, `API/utilities/cms/`)의 구조와 응답 처리 방식을 따릅니다.
2. 로그인: 기존 골투 로그인이 비밀번호를 어떻게 확인하는지 `API/routes/user.js`와 `MOBILE/pages/signIn.vue`에서 확인하고 같은 규칙을 씁니다. 확인한 규칙을 보고서에 적습니다.
3. 상품: `gf_board_foregin_tour`의 칸 이름은 `API/routes/mobilepage03.js`와 상품 상세 라우트에서 확인합니다. 사진 주소, 국가·지역 이름, 골프장 이름을 어떻게 얻는지 기존 코드를 따릅니다. 상품 화면 주소(`productUrl`) 규칙도 기존 공유 기능에서 확인합니다.
4. SQL `API/sql/20261112_create_auto_tables.sql`과 `_rollback.sql`.
5. 시험 `API/test/auto-api.test.js`: `API/test/cms-api.test.js`와 같은 방식(테스트 DB에 스키마를 넣고 실제 HTTP로 호출). 최소 항목: 등급 0~2 로그인 거부, 3·7·8 로그인, 토큰 없음·폐기 토큰 거부, 등급이 내려간 뒤 요청 거부, 상품 목록 필터(검색·월·안 올린 상품), 상품 상세에 회원 칸 없음, 숨김 상품 제외, 기록 시작·갱신·되돌리기 거부, `scope: all` 권한, 밴드 하루 상한, 설정 저장 권한.
6. 테스트용 스키마 파일 `API/test/auto-test-schema.sql`(시험에 필요한 기존 테이블의 최소 정의).

## 끝내는 기준

- 이 PC에 MariaDB/MySQL이 있으면 테스트 DB를 만들어 시험을 돌리고 결과를 보고서에. 없으면 설치하지 말고 '시험 미실행'으로 적습니다(검토 때 Claude가 돌립니다).
- 운영·개발 공용 DB에 연결하지 않습니다. `API/dbconfig.js`, `SERVER/secrets/`를 열지 않습니다.
- `node --check`로 새 파일 문법 확인.
- 보고서는 goltou-auto 저장소가 아니라 PR 본문에 적습니다: 한 일, 확인한 기존 규칙(비밀번호, 사진 주소, 상품 주소), 돌린 시험과 결과, 확인하지 못한 것.
- 초안 PR을 엽니다. 운영 반영은 하지 않습니다.
