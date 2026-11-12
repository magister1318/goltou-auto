# WP0 실기기·실험 도구 보고서

**실험 화면 진입: 골투오토 실행 → 로그인 화면의 `설정 · 로그인 없이 진단` → 설정 맨 아래 `실험 화면 열기`. 골투 로그인은 필요 없다.** 앱은 SM-S928N에 설치된 채로 두었으며, 네이버·밴드는 모두 **풀림** 상태다.

- 작업일: 2026-11-12, Windows / KST.
- 지시서: `docs/wp/WP0-device.md`의 **1·2단계만** 수행. 3단계는 실행하지 않았다.
- 브랜치: `codex/wp0-device`, 시작점 `origin/main`의 `58543ad`.
- `AGENTS.md`, PRD, WP1·WP3 보고서, B안 디자인 지침을 먼저 읽었다.

## 1단계 결과

| 항목 | 판정 | 실기기에서 확인한 내용 |
| --- | --- | --- |
| main 디버그 APK 빌드·설치·실행 | 됨 | 수정 전 main APK부터 빌드·설치했다. 최초 `am start -W`의 COLD Activity 시간 646ms. WP3 로그인 화면 표시 |
| 내장 Node·화면 기동 | 됨 | 앱 코어 `/health`에서 `v18.20.4`, 코어 준비 로그 확인. 최종 APK의 세션 생성→UI 문서 로드 완료는 **714ms**. Activity 시간과 서로 다른 측정값이며 반복 성능 시험은 아님 |
| 설정 > 진단 | 됨 | 실제 UI 버튼 → core → 앱 전용 DevTools 중계 → 숨김 WebView에서 `https://example.com/`의 **Example Domain** 제목 읽기 |
| WebView·기능 지원 | 됨 | WebView **156.0.8078.47**, Android API **37**, `MULTI_PROFILE=true`, `DELETE_BROWSING_DATA=true` |
| 세션 3개 분리 | 됨 | 실제 WebView에 프로필을 지정하고 다시 읽은 이름이 `goltou-naver`, `goltou-band`, `goltou-ai`로 모두 다름. 공유 프로필 대체 없음 |
| Surface 보이기·숨기기 | 고침 → 됨 | 고정 데스크톱 에뮬레이션을 그대로 보이면 빈 회색 화면이었다. 보일 때 에뮬레이션을 해제하고 숨길 때 1280×900과 입력 포커스 에뮬레이션을 복원. 예제 페이지가 실제로 보이는 것까지 캡처로 확인 |
| 앱을 뒤로 보냈다가 복귀 | 고침 → 됨 | 자동 전면 실행은 Android가 차단했다. 사용자 복귀를 최대 30초 기다리는 도구로 변경. 시험에서는 **이 앱만** `am start`로 다시 열었다. pause 0→1 / resume 1→2, 같은 페이지와 코어 연결 유지 |
| 회전·Activity 재생성 | 고침 → 됨 | Activity가 바뀔 때 WebView·CoreLink를 파괴하던 수명을 ViewModel의 AppSession으로 옮겼다. 가로 회전→명시적 recreate→세로 복귀 동안 Activity 생성 수 1→2→3→4, 페이지 동일·코어 연결 유지 |

기동 시간은 최종 한 번의 관측값이다. 프로필 이름·바인딩과 기능 지원은 확인했지만, 로그인 쿠키의 내용이나 실제 로그인 데이터의 격리·삭제 동작은 읽거나 시험하지 않았다. 로그인 제한 때문에 실기기에서 WP3의 로그인 이후 가짜 상품 흐름을 조작하지 않았다. 해당 흐름은 PC 로컬 시뮬레이션으로만 확인했다.

## 원인과 수정

1. 설정이 골투 로그인 뒤에만 있어 로그인 없는 진단을 할 수 없었다. 네이티브 디버그 플래그가 허용할 때만 로그인 화면에 설정 진입을 노출했다. 로그인 전 설정에는 진단과 실험만 표시한다. 디버그 기능을 제공하지 않는 코어는 실험 메시지를 거부한다.
2. Activity 재생성 때 UI·Surface·소켓을 함께 닫던 코드를 분리했다. 같은 ViewModel이 WebView와 CoreLink를 유지하고 MutableContextWrapper를 새 Activity로 연결한다. 영구 종료 때만 정리한다.
3. 숨김 데스크톱 크기와 실제 전면 크기의 충돌을 보이기/숨기기 전환에서 처리했다. 네이티브 뒤로/닫기에도 숨김 크기 복원을 알리는 이벤트를 연결했다. 돌아가기 줄은 그림자 없는 평면 모양으로 맞췄다.
4. 밴드는 자바스크립트로 다른 문서로 이동해 최초 loader의 load가 끝나지 않았다. 이전 문서를 성공으로 인정하지 않으면서, 새 주 문서의 load 완료를 인정하도록 고쳤다. 수정 전에는 30초 시간 초과, 최종 익명 상태 확인은 728ms였다.
5. 읽기 전용 DevTools 평가에서 `Element.matches`와 `new URL`이 부작용 검사에 막혔다. 태그 이름·속성·정규식으로 읽도록 바꿨다. 부작용 검사는 끄지 않았다.
6. 백그라운드에서 자동으로 자신을 다시 띄우려던 진단을 제거했다. 앱 밖을 조작하지 않고 명시적으로 이 앱에 복귀하는 방식으로 확인한다. 백그라운드 실패 시 캡처는 거부한다.

수정 전 실패 기록도 [pre-fix-failures.json](wp0/pre-fix-failures.json)에 남겼다. 당시 캡처 경로가 거부되거나 읽기 검사에 막힌 것은 `unavailable` 그대로 보존했다. 수정 뒤 별도 예제 진단으로 캡처·DOM 요약·추출 성공을 확인했다.

## 2단계 도구와 설치 확인

| 도구 | 구현·설치한 동작 | 이번 실행의 확인 범위 |
| --- | --- | --- |
| 로그인 화면 열기 | 지정된 네이버·밴드 로그인 주소를 각 프로필의 Surface에 보이게 열고 네이티브 돌아가기 줄로 닫기. 로그인 입력값·쿠키 읽기 없음 | 설치·코드 경로 확인. 로그인 화면에서 입력하거나 로그인하지 않음 |
| 로그인 상태 확인 | 네이버 보호된 글쓰기 이동 및 밴드 화면의 로그인/로그아웃 신호로 로그인됨·풀림·모름 판정. DAF의 화면·이동 판정 참고 | 최종 네이버 **풀림(958ms)**, 밴드 **풀림(728ms)**. 로그인됨의 실제 계정 판정은 미확인 |
| 블로그 실험 | 데스크톱 UA·1280×900, 고유 예시 제목과 16문단·3,000자 이상 본문, 내장 PNG 5장. 글자당 60ms 입력, 임시저장 버튼만 클릭, 새 편집기에서 임시저장 목록의 같은 제목 하나를 다시 열어 본문·문단·사진 대조 | 설치 확인. 실제 편집기 입력·첨부·임시저장·재열람 **미실행** |
| 밴드 실험 | 내 밴드 이름·식별키를 읽고 UI에서 하나 선택. 모바일/데스크톱 UA 선택 후 같은 예시 글·사진 입력. 파일 입력과 `maxlength`, 임시저장 제어 유무 기록. 임시저장이 보이면 저장·재열람 대조를 시도하고, 보이지 않으면 게시 직전 캡처 후 취소·닫힘 확인 | 설치 확인. 목록 읽기·글쓰기·UA 비교·첨부·한도·임시저장 동작 **미실행** |
| 단계별 기록 | 시각(UTC), 단계, 결과, 소요 ms, 실패 코드. DOM은 문서·편집기·파일 입력·사진·버튼 개수만 기록. 화면의 텍스트·입력·이미지·iframe을 마스킹하며 로그인 화면 픽셀은 저장하지 않음 | `example.com`으로 캡처와 DOM 기록 성공. 로그인 후 편집기 캡처 품질은 미확인 |
| `pnpm device:pull` | `run-as kr.goltou.auto`로 `files/wp0`의 허용된 JSON·PNG 파일만 읽음. 기본 출력은 Git에서 제외된 `tmp/wp0-device-시각` | **40개 파일 추출 성공**. 그중 최종 확인 12개 JSON을 보고서에 첨부 |

실험은 한 번에 하나만 실행하며 중단할 수 있다. 기존 글이 비어 있지 않거나 대상·확인창이 모호하면 오류로 멈춘다. 실험 모듈에는 실제 발행·게시·예약 명령이 없다. 실제 저장을 다시 읽어 대조하지 못하면 완료로 표시하지 않는다.

사진 파일 입력은 편집기 iframe 안에서도 찾도록 Surface를 보완했다. **사진 붙여넣기는 구현하지 않았으며 결과에 `not-tested`로 남긴다.** 공통 Surface의 파일 첨부 경로만 사용하고 개인 폰의 시스템 클립보드·사진첩은 조작하지 않았다. 3단계에서 파일 입력이 가능한지 먼저 확인하고, 불가능하면 지시를 받아 앱 내부에 한정된 대안을 검토해야 한다. `maxlength`가 없다는 이유로 무제한이라고 결론 내리지 않으며, 입력 성공 글자 수와 선언된 한도만 기록한다.

## 확인 명령과 결과

| 명령 / 확인 | 결과 |
| --- | --- |
| `pnpm install` | 통과, 잠금 파일과 workspace 연결 확인 |
| `pnpm typecheck` | 통과, strict 및 Android bridge 포함 |
| `pnpm test` | 통과, **7개 파일·48개 시험** |
| `pnpm sim:check` | 통과, WP3 가짜 흐름·권한·진단·이어하기. 시뮬레이션의 외부 서비스 요청 0 |
| `pnpm build` | 통과, Node 18 대상 번들·내장 UI·PNG 포함 |
| `apps/android`에서 `./gradlew.bat assembleDebug --console=plain --no-daemon` | 통과, 마지막 빌드 18초 |
| APK 설치·실행 | 최종 APK 교체 설치 성공. 실험 화면 및 익명 판정 확인, 앱 유지 |
| `pnpm device:pull tmp/wp0/final-pull` | 통과, 앱 전용 파일만 추출 |
| `git diff --check` | 통과 |

새 시험은 비로그인 입력 차단, 한 실험 제한·중단, 비밀을 포함한 예외의 기록 제외, 밴드 선택 검증, 디버그 기능 거부, 리다이렉트·크기 전환·iframe 파일 첨부를 확인한다. 기존 Chrome의 새 임시 컨텍스트에 로컬 HTML 응답만 공급해 읽기 전용 판정·밴드 목록·iframe 좌표와 글자/사진 개수도 확인했다. 이 시험은 실제 로그인·편집기 시험을 대신하지 않는다.

APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`, **64,103,014 bytes**.
SHA-256: `1b71e5737640ded71c96debe98151952d6aa69f0503d77ca1e8399292921f13d`.
APK·생성 번들·캐시·서명 키·local.properties는 커밋하지 않는다.

## 증거

- [설정 진단](wp0/01-settings-diagnostic.png), [실험·프로필](wp0/02-runtime-profiles.png), [보이는 예제 Surface](wp0/03-example-visible.png).
- [두 서비스 풀림·기동/재생성 값](wp0/04-login-expired.png), [로그인 후 실험 버튼 비활성](wp0/05-tools-disabled.png).
- [마스킹 캡처 점검](wp0/06-evidence-redacted.png): 숨김 WebView의 비식별 캡처 경로 확인용이며 편집기 성공 증거가 아니다.
- [최종 앱 JSON 12개](wp0/device-results.json): 20:57:16~20:57:28 KST. 원본 기록의 UTC 시각·단계·결과·소요 시간을 유지했다.

모든 휴대폰 캡처는 골투오토가 전면인 상태에서만 했다. 다른 앱 실행·삭제·설정 변경·파일 열람, 서비스 로그인·자격 증명 입력·실제 게시/발행, 골투 서버·운영 DB 접속을 하지 않았다. adb는 이 패키지 설치·실행, 앱 PID로 거른 로그, 전면 캡처, 이 앱의 DevTools 연결 및 `run-as` 전용 파일에만 사용했다. USB가 한 번 재연결돼 이 앱의 포워딩만 다시 설정했다.

## 다음 실행에 넘길 것

1. 사용자가 실험 화면에서 네이버·밴드에 직접 로그인한 뒤 Claude의 3단계 지시를 기다린다. 이번에는 로그인 버튼을 대신 누르거나 계정 정보를 입력하지 않았다.
2. 실제 편집기의 선택자·대기 조건, 제목/본문 포커스, 5장 파일 첨부, 임시저장 목록과 재열람 대조를 검증한다. 현재 선택자는 참고 코드와 로컬 HTML에서만 검증했다.
3. 밴드 UA 비교, 실제 첨부 가능 방식, 글자 수 한도, 임시저장 존재·동작은 **아직 모름**이다. 임시저장 제어를 못 찾으면 게시하지 않고 캡처·닫기만 한다.
4. 로그인된 화면에서 마스킹 캡처의 진단 유용성, 네이티브 돌아가기/시스템 뒤로의 실제 사용자 조작, 프로세스 강제 종료 뒤 복구·장시간 백그라운드·다른 기기는 미확인이다. 세션 삭제도 수행하지 않았다.

## 참고·GitHub

DAF `modules/helper/src/workflow/{naver,naver-page,editor,publish-draft}.ts`, `packages/engine-naver-editor/src/{page/editor-page,verify/page,verify/draft-verifier}.ts`의 필요한 선택자·판정·저장 후 재열람 순서만 참고했다. 밴드는 golfliat `programs/golfliat-workbench/electron/renderer.js`의 `fillBandComposerInWebview`를 참고했다. 출처는 각 구현 파일 첫 줄에 적었으며 참고 저장소는 수정하지 않았다. 직접 DOM을 고치는 입력·CKEditor setter·합성 붙여넣기 코드는 옮기지 않았다.

Android API 확인에는 [WebViewCompat](https://developer.android.com/reference/androidx/webkit/WebViewCompat), [Profile](https://developer.android.com/reference/androidx/webkit/Profile), [WebView 초기 배율](https://developer.android.com/reference/android/webkit/WebView#setInitialScale(int)) 공식 문서를 참고했다.

GitHub 작업에는 기존 gh 인증과 `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`를 사용했다. 로그인·계정 선택 창은 발생하지 않았다. 이 브랜치만 푸시하고 `main` 대상 초안 PR로 제출한다.
