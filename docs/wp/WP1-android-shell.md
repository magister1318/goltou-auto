# WP1. 워크스페이스, Surface 약속, 안드로이드 껍데기

브랜치 `codex/wp1-android-shell`. 먼저 `AGENTS.md`, `docs/PRD.md`를 읽습니다.

## 목표

빈 저장소를, 디버그 APK가 빌드되고 숨김 브라우저 하나를 열어 조작할 수 있는 상태로 만듭니다. 제품 기능(로그인, 상품, 블로그, 밴드)은 이 작업에 없습니다.

## 준비 (이 PC에 없으면 설치)

- Android SDK가 `%ANDROID_HOME%`(`%LOCALAPPDATA%\Android\Sdk`)에 없습니다. 명령줄 도구로 설치합니다: `platform-tools`, `platforms;android-36`, `build-tools`(compileSdk 36에 맞는 것), `ndk;27.3.13750724`, `cmake;3.22.1`. 라이선스 동의 포함. JDK 17은 이미 있습니다.
- pnpm이 없으면 `corepack enable` 또는 `npm i -g pnpm`.
- 설치한 것과 버전을 보고서에 적습니다. 시스템 환경 변수는 바꾸지 않습니다(이미 `ANDROID_HOME`이 있음).

## 할 일

1. 루트 워크스페이스: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, 공통 스크립트 `typecheck`, `test`, `build`, `sim`.
2. `packages/surface`
   - `Surface` 인터페이스: 열기(주소, 화면 크기, UA, 세션 구분 이름), 주소·제목·로딩 상태 읽기, 이동 대기, 스크립트 평가(읽기용), 좌표 클릭, 글자 입력, 키 입력, 파일 첨부, 보이기/숨기기(사용자에게 로그인 화면을 보여 줄 때), 닫기.
   - `SurfaceHost` 인터페이스: 세션(네이버 / 밴드 / AI) 별 Surface를 만들고 없애기, 세션 저장 데이터 지우기(로그아웃).
   - Chrome DevTools Protocol 구현 하나(`cdp/`): WebSocket 주소를 받아 위 약속을 구현. 안드로이드와 PC 시뮬레이션이 같이 씁니다.
   - 조작은 `Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent` 같은 입력 명령으로 합니다. 스크립트 평가는 읽기와 요소 위치 찾기에만 씁니다.
3. `packages/core`
   - 내장 Node에서 뜨는 진입점: 127.0.0.1 서버(실행마다 새 토큰), `/native`(껍데기와의 채널), `/ui/`(화면 정적 파일), `/ui-socket`(화면과의 채널).
   - 진단 기능 하나: Surface를 열어 주소를 띄우고 제목을 읽어 화면에 보여 주기.
4. `packages/ui`
   - Vite + React. 지금은 '골투오토' 제목과 진단 화면만. `docs/design/README.md`의 토큰을 CSS 변수로 넣어 둡니다(WP3에서 화면을 만듭니다).
5. `apps/android`
   - `../refs/DAF/daf3/apps/mobile/android`와 `src/core`의 `native.ts`, `cdp.ts`, `cdp-native.ts`, `main.ts`를 읽고 필요한 것만 옮깁니다: NodeRuntime, DevtoolsRelay, SurfaceHost, CoreLink, MainActivity, 필요한 NativeOps, `cpp/native-lib.cpp`, libnode 내려받기 스크립트, 코어 번들 스크립트.
   - 가져오지 않는 것: 오토파일럿, 결제, 리뷰, 알림 문구, 마을(village), 번들·APK 자동 업데이트, DAF 계정·이용권 코드, DAF 아이콘과 이름.
   - 패키지 `kr.goltou.auto`, 앱 이름 `골투오토`, 최소 SDK는 안드로이드 11(API 30). 아이콘은 임시(초록 바탕 단색).
   - 세션 분리: 네이버, 밴드, AI를 서로 다른 WebView 프로필로.
   - 디버그 서명만. 릴리스 서명 키를 만들거나 커밋하지 않습니다.
6. PC 시뮬레이션 `pnpm sim`: 껍데기 대신 로컬 Chromium을 세워 core + ui를 띄우고 진단 기능이 도는지 확인하는 스크립트(DAF `scripts/simulate.mjs` 참고).
7. 시험: Surface CDP 구현의 단위 시험(가짜 CDP 서버), core 서버의 토큰 확인 시험.

## 끝내는 기준

- `pnpm install && pnpm typecheck && pnpm test` 통과.
- `pnpm sim`에서 진단 화면이 예시 주소의 제목을 읽어 보여 줌.
- `apps/android`에서 `./gradlew assembleDebug` 성공, APK 경로와 크기를 보고서에.
- `packages/core`, `packages/sites`, `packages/ui`, `packages/surface`의 인터페이스 쪽에 안드로이드 전용 코드가 없음.
- `docs/reports/WP1.md` 작성. 폰이 연결되어 있지 않으므로 실기기 실행은 하지 않으며, 보고서에 '실기기 미확인'으로 적습니다.

## 하지 않는 일

네이버·밴드 조작 규칙, 골투 로그인, 상품 화면, AI Mode, 업데이트 묶음, 릴리스 빌드.
