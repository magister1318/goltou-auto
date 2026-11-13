# apps/android

Kotlin 껍데기. 패키지 `kr.goltou.auto`, 앱 이름 `골투오토`, Android 11(API 30) 이상.
debug와 release 빌드를 제공합니다. 배포 서명·설치 방법은 [배포 안내](../../docs/release.md)를 따릅니다.

저장소 루트에서:

```powershell
pnpm install
pnpm android:libnode
pnpm build
cd apps/android
./gradlew.bat assembleDebug --console=plain
```

JDK 17, ANDROID_HOME의 SDK platform 36, build-tools 36.0.0, NDK 27.3.13750724,
CMake 3.22.1이 필요합니다. `local.properties`는 커밋하지 않습니다.
시스템 환경 변수 변경 없이 캐시를 저장소에 둘 경우 현재 PowerShell 프로세스에만
`$env:GRADLE_USER_HOME = Join-Path (Resolve-Path ../..) '.gradle-cache'`를 지정할 수 있습니다.

APK: `app/build/outputs/apk/debug/app-debug.apk`. ARM64와 ARMv7용 libnode 18.20.4를 포함합니다.
libnode와 빌드된 core/UI 자산은 Git에서 제외합니다. Gradle이 변형별 core/UI 자산을 생성합니다.

`bridge/`는 공통 Surface를 Android 프로필·숨김 WebView·사설 DevTools 소켓과 연결합니다.
Kotlin은 NodeRuntime, DevtoolsRelay, CoreLink, SurfaceHost와 진단 UI 호스팅만 제공합니다.
별도의 NativeOps는 진단에 필요하지 않아 가져오지 않았습니다.
`naver`, `band`, `ai`는 각각 `goltou-*` WebView 프로필을 사용합니다.
MULTI_PROFILE 미지원 WebView에서는 공유 프로필로 대체하지 않고 진단에 오류를 돌려줍니다.
세션 지우기는 `WebStorageCompat.deleteBrowsingData` 완료 콜백 뒤에만 응답합니다.
쿠키·캐시·스크립트 저장소를 함께 지우며 DELETE_BROWSING_DATA 미지원이면 오류를 반환합니다.
WP7 기본 경로는 실제 `/auto` API입니다. 주소는 `scripts/app-config.mjs` 한 곳에서 정합니다.
사용자가 로그인 화면에 직접 입력한 정보는 로그인 요청 한 번에만 쓰며 받은 토큰만 Keystore AES-GCM 저장소에 보관합니다.
`auth`/`forbidden`이면 토큰을 지우고 로그인 화면으로 돌아갑니다. 이전 합성 세션 인텐트는 제거했습니다.

`pnpm build`는 디버그 실험을 포함합니다. 로그인 후 실험의 **변환 점검**은 등록·사이트 열기 없이
최신 상품 최대 60개를 읽고 수치만 앱 내부 `files/wp7/conversion.json`에 남깁니다.
`node scripts/build-core.mjs --release`는 실험 코드를 제외한 Node 번들을 생성합니다.
release Gradle 작업은 별도 자산을 생성하며 외부 서명 설정이 없으면 실패합니다.
사진은 HTTPS `goltou.kr` 및 그 하위 호스트의 API 원본만, 리다이렉트 없이 받습니다.
debug에서는 실험 제목 접두사·저장 시도 1회 제한을 적용합니다. release에서는 이 실험 옵션을 넘기지 않습니다.
