# 골투오토 작업 규칙

사람이든 에이전트(Codex, Claude)든 이 파일을 먼저 읽고 작업합니다. 지시서는 Claude가 쓰고, 코딩은 Codex가 하고, 검토는 Claude가 합니다.

## 제품 원칙 (바꾸지 않습니다)

- 한 번에 한 건만 등록합니다. 여러 상품을 한꺼번에 돌리는 기능, 예약 발행, 반복 실행을 만들지 않습니다.
- 입력은 사람이 쓰는 속도로 합니다. 네이버·밴드 편집기는 버튼, 키보드, 마우스 입력으로만 다룹니다. 화면 내용(DOM)을 직접 고쳐 넣고 성공으로 치지 않습니다. 저장 뒤 다시 읽어 확인한 것만 완료입니다.
- 골투, 네이버, 밴드 로그인은 사용자가 직접 합니다. 아이디·비밀번호를 받아 대신 넣는 코드, 비밀번호나 쿠키를 저장하거나 서버로 보내는 코드를 만들지 않습니다.
- 가격, 출발일, 골프장 이름, 상품 주소는 골투 API 값을 그대로 씁니다. AI(구글 AI Mode) 응답에서 나온 숫자를 본문에 쓰지 않습니다.
- 등록 방식은 임시저장(기본)과 발행 둘입니다. 발행은 사용자가 그 작업에서 발행을 골랐을 때만 누릅니다.
- 문장 다듬기, 글 끝 문구, 골투 링크 카드는 선택 옵션이며 기본은 모두 꺼짐입니다.

## 폴더 규칙

- `apps/android`, `apps/desktop`, `apps/ios`: 기기별 껍데기. 브라우저 화면을 만들고 `packages/surface`의 약속을 그 기기 방식으로 구현하는 코드만 둡니다.
- `packages/core`, `packages/sites`, `packages/ui`, `packages/api-client`: 기기와 무관해야 합니다. Android, Electron, iOS 전용 API를 직접 부르지 않습니다. 필요한 기기 기능은 `packages/surface`나 `core`의 인터페이스로 받아 씁니다.
- `packages/sites`의 조작 규칙은 `surface`의 공통 약속(열기, 주소·상태 읽기, 클릭, 글자 입력, 키 입력, 파일 첨부, 스크립트로 화면 읽기)만 씁니다.
- 1차는 안드로이드만 만듭니다. `apps/desktop`, `apps/ios`는 README만 둡니다.

## 기술

- pnpm 워크스페이스, TypeScript(strict), React + Vite(화면), vitest(시험).
- 안드로이드 껍데기는 Kotlin. 내장 Node는 nodejs-mobile 18.20.4이므로 `packages/*`의 실행 코드는 Node 18에서 돌아야 합니다.
- 앱 패키지 이름 `kr.goltou.auto`, 앱 이름 `골투오토`.
- 화면은 `docs/design/README.md`의 B안 토큰과 `docs/design/mockups/`를 따릅니다. 카드·그림자·둥근 큰 버튼·왼쪽 색 띠를 새로 넣지 않습니다.

## 참고 저장소 (읽기 전용)

작업 폴더 옆 `../refs/`에 있습니다. 코드를 가져올 때는 필요한 부분만 옮기고, 가져온 파일 맨 위에 출처 경로를 한 줄 적습니다. 참고 저장소는 고치지 않습니다.

- `../refs/DAF`: `daf3/apps/mobile`(안드로이드 껍데기, 숨김 WebView + DevTools 중계, 내장 Node), `daf3/modules/helper`(네이버 편집기 입력, 로그인 확인·복구), AI Mode 엔진. 설명은 `docs/daf3/p9-mobile.md`.
- `../refs/golfliat`: `programs/golfliat-workbench/electron/renderer.js`의 `fillBandComposerInWebview`(밴드 글쓰기 입력, 사진 붙여넣기), `main.cjs`의 골투 상품 읽기와 AI 지시문.
- `../refs/goltou-hybrid`: 골투 API(`API/`, Express + MySQL)와 화면(`MOBILE/`). 이 저장소의 `AGENTS.md` 규칙을 함께 지킵니다.

## 금지

- 비밀 값(키, 토큰, 비밀번호, 서명 키, `local.properties`)을 커밋하지 않습니다.
- 운영 서버와 운영 DB에 연결하지 않습니다. 운영 반영은 사용자가 승인한 뒤 Claude가 합니다.
- 실제 네이버·밴드 계정으로 글을 발행하지 않습니다. 실기기 시험은 사용자가 로그인한 시험 계정에서 임시저장까지만 합니다.
- `main`에 직접 푸시하지 않습니다.

## 작업 순서

1. `docs/wp/WPn-*.md` 지시서 하나가 작업 하나입니다. 범위 밖 일은 하지 않고, 필요해 보이면 보고서에 적습니다.
2. 브랜치 `codex/wpN-짧은이름`을 `origin/main`에서 만듭니다.
3. 끝나면 확인 명령을 돌립니다: `pnpm install`, `pnpm typecheck`, `pnpm test`. 안드로이드를 건드렸으면 `apps/android`에서 `./gradlew assembleDebug`.
4. `docs/reports/WPn.md`에 한 일, 돌린 확인 명령과 결과, 확인하지 못한 것, 다음 작업에 넘길 것을 적습니다. 못 한 것을 한 것처럼 쓰지 않습니다.
5. 커밋하고 브랜치를 푸시한 뒤 초안 PR을 엽니다. PR 본문은 보고서 요약입니다.
