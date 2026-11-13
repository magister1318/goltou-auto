# WP12 릴리스 빌드

2026-11-13 KST. `AGENTS.md`, `docs/wp/README.md`를 읽고 fetch한 `origin/main`의
`6c3eded`에서 `codex/release-build`를 만들었다. 범위는 [WP12 지시](../wp/WP12-release.md)다.

## 감사와 변경

| 항목 | 작업 전 → release 결과 |
| --- | --- |
| 빌드·서명 | release 변형 비활성 → 활성화. 외부 키/설정 필수, debug 키 대체 없음 |
| 변환 점검·실험 | 엔진만 선택적 제거, UI 코드는 포함 → release 엔진·UI·예시 사진에서 제외 |
| `experimentTitle`, `draftSaveLimit` | debug에 제목 접두사·저장 1회 옵션 → release에 전달하지 않음. 공통 저장 안전 한도 3회는 유지 |
| 진단·가짜 실행·캡처 | 일부 UI/콜백은 항상 연결 → release UI 제외, 요청 거절, 캡처 콜백 미등록. Kotlin `debug.*` 거절 유지 |
| WebView CDP | `BuildConfig.DEBUG`여서 release 자동 입력 불가 → 드라이버 필수 예외로 양쪽 활성화. 아래 제한 참조 |
| 로그 | Node stdout/stderr 원문 중계·예외 상세·페이지 console → release Node 출력 폐기, 페이지 console 처리, Kotlin 고정 오류 코드 |
| 평문 통신 | 기본 차단·loopback 예외 → 유지. manifest도 false, loopback의 하위 도메인 허용 false. Node API·사진은 HTTPS |
| 디버그·백업 | debug는 디버그 가능, `allowBackup=false` → release 디버그 false, 백업 false 유지, fullBackup/기기 이전도 제외 |
| 축소·버전·이름 | 버전 중복 하드코딩 → `apps/android/version.properties`에서 Android·번들 버전 관리. 이름 유지. JNI/Node 호환성 미검증으로 R8·리소스 축소 꺼짐 |
| 재현성 | 강제 재빌드의 파일 내용·서명은 같으나 SDK 메타데이터 블록만 달랐음 → 스토어용 `dependenciesInfo` 제외. [공식 설정](https://developer.android.com/reference/tools/gradle-api/7.2/com/android/build/api/dsl/DependenciesInfo) |

Gradle이 변형별 자산을 생성하므로 수동 `pnpm build`의 debug 자산이 release에 섞이지 않는다.
시작 때 번들 변형·버전 불일치도 거절한다. 서명 설정은 외부 properties 또는 무시되는
`apps/android/release-signing.properties`에서 읽으며 키는 항상 저장소 밖이어야 한다.
실제 배포 키는 만들지 않았다. 저장소 밖 `../runs/wp12-release-throwaway/`의
명시적인 일회용 시험 키로만 서명했다. 키·비밀번호·계정/상품 원문은 커밋하지 않았다.

CDP는 Node → 앱 전용 `files/devtools.sock` → WebView 추상 소켓으로 연결한다.
`setWebContentsDebuggingEnabled(false)`면 검색·입력이 불가능하다. 사설 중계가 있어도
원래 소켓은 adb에 노출된다. 일반 다른 UID는 Chromium이 거절하지만 같은 UID·root·shell은
가능하다. 이를 막는 공개 WebView 옵션은 없다. USB/무선 디버깅을 끄고 adb 승인을 취소하는
운영 전제가 필요하다. 근거와 키 생성·빌드·업데이트 방법은 [배포 안내](../release.md)에 있다.

## 확인

- `pnpm install`: 통과, 잠금 파일 변경 없음.
- `pnpm -r typecheck`, Android bridge를 포함한 `pnpm typecheck`, `pnpm build`: 통과.
- 최종 루트 `pnpm test`: **33개 파일, 319개 시험 통과**, 289.77초.
- `./gradlew.bat :buildSrc:test assembleRelease assembleDebug --console=plain --no-daemon`: 통과. 설정 단위 시험 **10개**, 실패 0.
- 서명 설정 없는 `assembleRelease`: 안내와 함께 의도한 실패, debug 키 대체 없음.
- 최초 release lint의 기존 `includeSubdomains` 누락을 고쳤다. 기본 병렬 실행에서 브라우저/정리 hook 시간 초과와 loopback HTTP 연결 실패가 발생했다. 연결 실패 파일은 단독 19개 통과했고, worker를 2개로 제한한 최종 전체 시험도 통과했다. 제품 코드와 시험 제한 시간은 이 문제 때문에 바꾸지 않았다.
- release 자산 시험은 debug UI/실험 제거·버전·안전한 출력 경로와 외부 요청 없는 데스크톱 코어 시작을 검사한다.
- APK의 실제 자산에서 debug=false, 실험·예시 사진 제외, 두 ABI의 Node 로그 중계 문자열 제외를 확인했다.
- 최종 `:app:assembleRelease --rerun-tasks`도 통과했다. 같은 PC·도구·시험 키로 만든 두 APK는 SHA-256이 같아 바이트가 일치했다. 다른 환경까지 동일하다는 검증은 하지 않았다.

## 시험 서명 APK

`apkanalyzer`, `aapt`, `apksigner verify --verbose`로 확인했다.

| 항목 | 값 |
| --- | --- |
| 패키지 / 이름 | `kr.goltou.auto` / 골투오토 |
| versionName / versionCode | `0.1.0` / `1` |
| 크기 | 55,389,180 bytes (52.82 MiB) |
| debuggable / allowBackup | false / false |
| usesCleartextTraffic | false. 네트워크 설정의 loopback 두 주소만 예외 |
| Android / ABI | minSdk 30, targetSdk 36 / arm64-v8a, armeabi-v7a |
| 서명 | APK v2 검증 통과, 서명자 1명, 일회용 시험 키 |
| APK SHA-256 | `54f3bf8bc8386052e6a24f18c211267cbf6ce4789262ed11fc3a38595f20dddd` |

산출물은 `apps/android/app/build/outputs/apk/release/app-release.apk`이며 저장소 밖
`../runs/wp12-release-throwaway/goltou-auto-0.1.0-1-THROWAWAY.apk`에도 복사했다. 배포용으로 쓰지 않는다.
사용자 지시대로 연결된 휴대폰에는 설치·삭제·재시작하지 않았다. Android release의 실제 시작,
CDP 연결·로그인·임시저장·업데이트는 미확인이다. 데스크톱 코어 시작 시험을 기기 검증으로 보지 않는다.
운영 API/DB 접속, 네이버·밴드 등록·발행은 하지 않았다.

## 소유자에게 넘길 것

- CDP의 adb 노출 제한을 사내 배포에서 수용할지 결정한다. adb에도 소켓을 감춰야 한다면 드라이버 변경이 별도 작업이다.
- 실제 키 생성·보관·복구 담당자와 첫 배포 버전 `0.1.0 (1)`을 정한다. 키를 잃으면 삭제 후 재설치와 로그인 손실이 필요하다.
- debug 앱을 쓰는 휴대폰의 전환 시점과 데이터 손실을 확인한 뒤, 실제 키 APK로 별도 시험 계정의 시작·CDP·임시저장·같은 키 업데이트를 검증한다.
