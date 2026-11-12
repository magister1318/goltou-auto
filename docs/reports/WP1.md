# WP1 작업 보고서

- 작업일: 2026-11-12 (Windows, KST)
- 지시서: `docs/wp/WP1-android-shell.md`
- 브랜치: `codex/wp1-android-shell`
- 시작점: `origin/main`의 `0d5d376`
- 결과: 공통 코드 검사, PC 진단 시뮬레이션, Android 디버그 APK 빌드 성공. **실기기 미확인**.

## 한 일

1. pnpm 워크스페이스, TypeScript strict 설정, `typecheck`, `test`, `build`, `sim` 스크립트와 잠금 파일을 추가했다. `packages/sites`, `packages/api-client`, `apps/desktop`, `apps/ios`는 기존 README만 유지했다.
2. `packages/surface`에 Surface / SurfaceHost 계약과 WebSocket CDP 구현을 추가했다. URL·UA·화면 크기·세션을 지정해 열기, 상태·제목 읽기, 이동 대기, 읽기 평가, 좌표 클릭, 문자·키 입력, 파일 첨부, 보이기·숨기기·닫기를 제공한다. 입력은 Input 명령을 쓰며 기본 간격은 60ms다. 읽기 평가는 `throwOnSideEffect`를 켠다. 파일 첨부만 `DOM.setFileInputFiles`를 사용한다.
3. `packages/core`에 127.0.0.1 서버를 추가했다. `/native`, `/ui/`, `/ui-socket`, `/health`를 실행마다 새 토큰으로 보호한다. UI 실행 쿠키는 HttpOnly/SameSite=Strict이며 네이티브 채널은 쿠키만으로 인증하지 않는다. Host·Origin·정적 파일 경로를 검사한다. 진단은 한 번에 한 요청만 받아 Surface 하나에서 제목을 읽고 닫는다.
4. `packages/ui`에 골투오토 제목과 진단 화면만 만들었다. B안 색 토큰, 24px 여백, Noto Sans KR 400/500/700/900, 화면 아래 실행 막대를 적용했다. 글꼴은 빌드에 포함하며 외부 글꼴 서버를 쓰지 않는다.
5. `apps/android`에 Kotlin 껍데기와 Android용 Surface 연결을 추가했다. NodeRuntime, 사설 소켓 DevtoolsRelay, CoreLink, WebView SurfaceHost, MainActivity, JNI/CMake와 Gradle wrapper를 구성했다. 진단에 별도 NativeOps가 필요하지 않아 가져오지 않았다. 패키지는 `kr.goltou.auto`, 앱 이름은 `골투오토`, minSdk 30 / compileSdk·targetSdk 36, 임시 단색 초록 아이콘이다. 디버그 변형만 활성화했다.
6. 네이버·밴드·AI는 각각 `goltou-naver`, `goltou-band`, `goltou-ai` 프로필을 쓴다. MULTI_PROFILE 미지원이면 공유 프로필로 대체하지 않고 오류를 반환한다. 세션 지우기는 해당 Surface들을 닫고 쿠키·캐시·스크립트 저장소 삭제 완료 콜백 뒤에 응답한다. DELETE_BROWSING_DATA 미지원도 오류로 알린다.
7. Node 18 대상 코어/UI 번들 스크립트, nodejs-mobile 18.20.4 내려받기·고정 체크섬 확인 스크립트, 기존 Chromium으로 실행하는 PC 시뮬레이션을 추가했다. 시뮬레이션은 새 headless 프로필과 로컬 예제 서버를 쓰고 종료한다.

공통 `packages/core`, `packages/ui`, `packages/surface` 계약과 기존 `packages/sites`에는 Android/Electron 전용 API 호출이 없다. Android 관련 연결은 `apps/android/bridge`와 Kotlin에 있다. CDP의 WebSocket·파일 소켓 전송은 Node 기반 공통 구현이다.

## 참고한 코드와 API

DAF의 아래 파일에서 필요한 부분만 가져오거나 축소해 작성했으며 각 파일 맨 위에 출처를 적었다. wrapper JAR의 출처는 옆 README에 기록했다. 참고 저장소는 수정하지 않았다.

- `../refs/DAF/daf3/apps/mobile/android`: NodeRuntime, DevtoolsRelay, CoreLink, SurfaceHost, MainActivity, `cpp/native-lib.cpp`, CMake·Gradle wrapper 및 빌드 설정.
- `../refs/DAF/daf3/apps/mobile/src/core/{native,cdp,cdp-native,main}.ts`: 요청/응답·DevTools·로컬 서버 구조 확인. iOS용 cdp-native 구현은 가져오지 않았다.
- `../refs/DAF/daf3/apps/mobile/scripts/{fetch-libnode,build-core,simulate}.mjs`와 `../refs/DAF/docs/daf3/p9-mobile.md`.

프로필 삭제 API는 현재 프로세스에 로드된 프로필에 제약이 있어 세션 지우기에 쓰지 않았다. 삭제 범위와 완료 콜백은 Android 공식 [WebStorageCompat 문서](https://developer.android.com/reference/androidx/webkit/WebStorageCompat), 프로필 제약은 [ProfileStore 문서](https://developer.android.com/reference/androidx/webkit/ProfileStore)를 확인했다.

오토파일럿, 결제, 리뷰, 알림, village, 자동 업데이트, DAF 계정·이용권·아이콘·앱 이름은 가져오지 않았다. 골투 로그인, 상품, 블로그·밴드 편집기 규칙, AI Mode, 발행 기능을 구현하지 않았다. 운영 서버·DB 및 실제 서비스 계정에 연결하지 않았다.

## 설치·환경

시스템 환경 변수는 바꾸지 않았다. SDK는 기존 `ANDROID_HOME`인 `C:\Users\magis\AppData\Local\Android\Sdk`에만 설치했다. 브라우저·에뮬레이터·다른 Node 버전은 설치하지 않았다.

| 항목 | 버전 / 처리 |
| --- | --- |
| pnpm | `npm.cmd install -g pnpm@10.11.0`으로 설치 |
| Android command-line tools | 19.0, Google 저장소의 Windows ZIP과 SHA-1 대조 |
| platform-tools | 37.0.1 |
| platforms;android-36 | revision 2 |
| build-tools | 36.0.0 |
| NDK | 27.3.13750724 |
| CMake | 3.22.1 |
| SDK 라이선스 | `sdkmanager.bat --licenses` 동의 완료 |
| JDK | 기존 Microsoft OpenJDK 17.0.16 사용 |
| PC Node / npm | 기존 24.19.0 / 11.17.0 사용 |
| 내장 Node | nodejs-mobile 18.20.4, ARM64·ARMv7 라이브러리 및 헤더 포함 |
| Gradle / AGP / Kotlin | wrapper 8.14.3 / 8.13.2 / 2.2.20 |
| PC 진단 브라우저 | 기존 Chrome 157.0.8103.50, playwright-core로 실행 |

SDK 설치 명령은 `sdkmanager.bat --sdk_root=<ANDROID_HOME> "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.3.13750724" "cmake;3.22.1"`이다.
Gradle 배포본·프로젝트 의존성은 빌드 과정에서 내려받았다. `GRADLE_USER_HOME`은 명령 프로세스 안에서만 저장소의 `.gradle-cache`로 지정했다. 처음 캐시 경로를 저장소 내부의 한 단계 중첩된 폴더로 지정했으나 빌드 종료 후 `.gradle-cache`로 옮겨 정리했다. 다른 WorkFolder 폴더는 수정하지 않았다.

## 실행한 확인과 결과

| 명령 / 확인 | 결과 |
| --- | --- |
| `pnpm install` | 성공. 최종 실행에서 잠금 파일 변경 없이 설치 확인 |
| `pnpm typecheck` | 성공. 공통 패키지와 Android bridge 포함 |
| `pnpm test` | 성공. 2개 파일, 15개 시험 통과 |
| `pnpm android:libnode` | 성공. 고정 npm 패키지 체크섬 확인, 재실행 시 기존 설치 확인 |
| `pnpm build` (`pnpm sim` 내부에서도 실행) | 성공. esbuild `node18` 코어와 Vite UI를 APK assets에 생성 |
| `pnpm sim` | 성공. React 진단 시작 → core → 실제 CDP → 로컬 예제의 `골투오토 진단 예제` 제목 표시 |
| `apps/android`에서 `./gradlew.bat assembleDebug --console=plain --no-daemon` | 성공. 최종 실행 `BUILD SUCCESSFUL`, 11초 |
| `aapt dump badging` | 패키지 `kr.goltou.auto`, 앱 이름 `골투오토`, 최소 SDK 30 / 대상 SDK 36, ARM64·ARMv7 확인 |
| `apksigner.bat verify --print-certs` | 성공. `CN=Android Debug` 서명 확인 |
| APK ZIP 내용 검사 | 양 ABI의 libnode / libgoltounode / libc++_shared 포함, APK 안 번들 manifest와 최종 생성 manifest 일치 |
| `git diff --check` | 공백 오류 없음 |
| 공통 코드 검색·읽기 | 공통 계약·core·ui·sites에 Android/Electron API 호출 없음 |
| `tmp/wp1-sim.png` 시각 확인 | 412×915 화면에서 제목·입력·진단 결과·아래 실행 막대 확인 |

Surface 시험은 가짜 CDP 서버로 요청/응답 순서, 오류·타임아웃·단절, 새 문서 이동 대기, 입력 명령, 파일 첨부, 읽기 평가 오류, 표시·닫기와 세션 검증을 확인한다. 코어 시험은 실행별 토큰, HTTP·WebSocket 거부, 쿠키·Origin·Host·경로 검사, 네이티브 응답·단절을 확인한다.

첫 시험에서는 Host 헤더 검사 하나가 실패했다(14/15). PC Node 24의 `fetch` 대신 Host를 명시하는 `http.get`으로 시험 요청을 바꾼 후 15/15 통과했다. 첫 APK 빌드의 manifest `extractNativeLibs` 중복 설정 및 오래된 inset/back API 경고는 설정·API를 정리했고 최종 빌드는 해당 경고 없이 성공했다.

APK는 `apps/android/app/build/outputs/apk/debug/app-debug.apk`에 있다.

- 크기: **64,102,531 bytes (61.13 MiB)**
- SHA-256: `e5ac2573f4a4bc84415e1cb27a9ecc27d55310079da1f115c4fabf7950ea560e`
- APK·libnode·생성 bundle·캐시·local.properties·서명 키는 커밋하지 않는다. 릴리스 키를 만들지 않았다.

## 확인하지 않은 것 / 다음 작업에 넘길 것

- **실기기 미확인**. 폰이 연결되지 않은 조건이므로 설치·실행하지 않았고 에뮬레이터도 설치하지 않았다.
- Android 안에서 libnode 기동, 사설 DevTools 중계, 실제 WebView 진단, 프로필의 로그인 상태 분리·보존·삭제, 화면 보이기/숨기기, 키보드·파일 첨부, Activity 재생성·복귀·저사양 기기 동작은 아직 검증하지 않았다. APK 빌드 성공을 실행 성공으로 해석하면 안 된다.
- PC 시뮬레이션은 Node 24와 Chrome에서 실행했다. 번들은 Node 18을 대상으로 만들고 Node 18 타입을 사용하지만, PC Node 18 실행이나 Android 내장 Node 18.20.4 런타임 동작은 확인하지 않았다.
- 실제 네이버·밴드·AI 사이트와 외부 HTTPS 페이지의 진단·로그인·입력은 확인하지 않았다. 시뮬레이션은 로컬 예제 주소만 사용했다. headless 시뮬레이션에서 네이티브 표시 레이어는 재현하지 않는다.
- 이후 실기기 작업에서 WebView의 MULTI_PROFILE·DELETE_BROWSING_DATA 지원 여부와 세션 데이터 삭제 완료를 확인해야 한다. 지원하지 않으면 현 구현은 오류를 반환한다.
- 상품·로그인·발행·AI·업데이트·릴리스·운영 반영은 WP1 범위 밖이므로 수행하지 않았다. WP0 등의 후속 시험에서 계속한다.

GitHub 작업은 `gh` 및 gh 인증을 쓰는 git 명령으로 수행하며 `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`를 명령 프로세스에 설정했다. 계정 선택·로그인 창은 나타나지 않았다. 이 브랜치만 푸시하고 `main` 대상 초안 PR을 연다.

첫 커밋은 Git 작성자 이름·이메일 미설정으로 실패했다. `gh api user`로 인증 계정을 확인하고 공개 이름과 GitHub noreply 이메일을 `git -c user.name=... -c user.email=... commit`에만 지정해 처리한다. 전역·시스템 Git 작성자 설정은 바꾸지 않는다.
