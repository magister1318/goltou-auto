# apps/android

Kotlin 껍데기. 패키지 `kr.goltou.auto`, 앱 이름 `골투오토`, Android 11(API 30) 이상.
디버그 빌드만 사용합니다. 릴리스 변형과 릴리스 서명 설정은 없습니다.

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
libnode와 빌드된 core/UI 자산은 Git에서 제외합니다. Gradle 실행 전에 `pnpm build`가 필요합니다.

`bridge/`는 공통 Surface를 Android 프로필·숨김 WebView·사설 DevTools 소켓과 연결합니다.
Kotlin은 NodeRuntime, DevtoolsRelay, CoreLink, SurfaceHost와 진단 UI 호스팅만 제공합니다.
별도의 NativeOps는 진단에 필요하지 않아 가져오지 않았습니다.
`naver`, `band`, `ai`는 각각 `goltou-*` WebView 프로필을 사용합니다.
MULTI_PROFILE 미지원 WebView에서는 공유 프로필로 대체하지 않고 진단에 오류를 돌려줍니다.
세션 지우기는 `WebStorageCompat.deleteBrowsingData` 완료 콜백 뒤에만 응답합니다.
쿠키·캐시·스크립트 저장소를 함께 지우며 DELETE_BROWSING_DATA 미지원이면 오류를 반환합니다.
로그인·상품·사이트별 편집기 조작·업데이트 기능은 포함하지 않습니다.
