# 사내 APK 배포 준비

패키지 kr.goltou.auto, 이름 골투오토. Android 11 이상 ARM64/ARMv7용이다.
버전은 apps/android/version.properties에서 관리하고 설정에 표시한다.

**WP30 Part 2의 1.0.0 (3)는 소유자 결정으로 release 제어 채널을 켠 사내 전환용 준비본이다.
실제 release 휴대폰 동작과 Blog 임시저장 왕복은 전환 후 확인한다.**

## 서명

영구 배포 키는 저장소 밖에서 보관한다. 새로 만들거나 WP12 일회용 키를 쓰지 않는다.
키 폴더는 담당자만 접근하며 두 번째 안전한 장소에도 보관한다. 분실하면 기존 배포 앱을
같은 신원으로 업데이트할 수 없다. 키와 비밀번호를 로그·Git·보고서에 넣지 않는다.

Gradle은 GOLTOU_SIGNING_PROPERTIES의 외부 properties 또는 Git에서 제외된
apps/android/release-signing.properties를 읽는다. 항목 이름은 storeFile, storePassword,
keyAlias, keyPassword다. 상대 키 경로는 properties 파일 기준이다. 키는 반드시 저장소 밖에 둔다.
설정 누락은 release 빌드 실패이며 debug 키로 대신하지 않는다.
공개 인증서 지문은 apps/android/release-certificate.sha256이다.
`pnpm check:secrets`는 Git index의 키 파일·비밀 설정·비밀번호 속성을 검사한다.

## 검증과 빌드

JDK 17, Node 18.20.4 이상, pnpm 10.11.0, Android SDK/build-tools 36,
NDK 27.3.13750724, CMake 3.22.1이 필요하다. 내장 Node는 18.20.4다.
깨끗한 커밋에서 외부 서명 설정의 경로만 환경 변수에 지정하고 실행한다.

```powershell
$env:GIT_TERMINAL_PROMPT='0'
$env:GCM_INTERACTIVE='never'
# GOLTOU_SIGNING_PROPERTIES는 담당자의 외부 파일을 가리키도록 로컬 지정
./scripts/install-device.ps1 -Variant release -VerifyOnly -ArtifactDirectory ../release-out
```

의존성 → 타입 → 전체 시험(건너뜀·TODO 0, 런타임 시험 포함) → 소스 호환성 → 번들 빌드 →
assembleRelease → 실제 APK 내부 번들·소스 커밋·변형·v2/v3 서명·인증서를 검사한다.
검증한 동일 사본과 SHA-256 파일을 외부 폴더로 복사한다. 검사 중 HEAD/소스 변경은 거부한다.
별도로 `:buildSrc:test testDebugUnitTest testReleaseUnitTest assembleDebug`도 확인한다.
R8/리소스 축소는 JNI와 내장 Node 검증 전까지 끈다.

## 설치 전 인증서 대조

읽기 전용으로 상태와 인증서를 비교한다. dumpsys package의 짧은 signatures 값은 SHA-256이
아니다. pm path로 설치 APK를 찾아 APK만 PC로 읽어 apksigner로 확인하며 private 데이터는 읽지 않는다.

```powershell
. ./scripts/apk-signature.ps1
Compare-InstalledCertificate ../release-out/goltou-auto-1.0.0-3-release.apk
```

DIFFERENT이면 설치 금지다. 앱 삭제·초기화·오류 우회를 하지 않는다.
SAME인 검증된 향후 배포본만 `install-device.ps1 -Variant release`로 설치한다.
게이트는 인증서와 화면 켜짐·잠금 해제·앱 전면, APK 해시를 대조하고 `adb install -r`만 쓴다.
실패하면 다른 플래그나 삭제로 재시도하지 않는다. 파일 설치는 [INSTALL](INSTALL.md)을 따른다.

## 제어 채널과 접근 범위

release는 debuggable/JNI debug false이며 WEBVIEW_CONTROL_ENABLED=true는 별도로 유지한다.
소유자는 사내 비공개 배포에서 기존 CDP 드라이버를 쓰기로 결정했다.
현재 AndroidSurfaceHost.create는 사설 릴레이의 /json/list와 CDP에 의존한다.
요청 allowlist도 CdpSurface.guardRequests의 Fetch.enable과 POST 본문·응답 관찰을 쓴다.
릴레이는 앱 private 파일 소켓에서 WebView abstract 소켓으로 연결하며 CDP TCP 포트는 열지 않는다.
일반 다른 앱/인터넷에 직접 열려 있지 않지만 승인된 USB/무선 adb와 root는 페이지를 읽고 조작할 수 있다.
직원 휴대폰의 USB/무선 디버깅은 꺼 둔다. 외부 Intent로 자동 작업을 지시하는 경로는 없다.

앱 UI의 작업별 발행 확인과 Fetch 본문/응답 차단기를 유지하며 debug 허용 파일은 release에 넣지 않는다.
데이터 백업과 WP20 로그 내보내기는
네이티브 로컬 경로라 CDP/adb가 필요 없지만 실제 release 기기의 문서 선택·공유 UI는 미검증이다.

근거: [WebView API](https://developer.android.com/reference/android/webkit/WebView#setWebContentsDebuggingEnabled(boolean)),
[apksigner](https://developer.android.com/tools/apksigner),
[앱 서명과 업데이트](https://developer.android.com/studio/publish/app-signing).
자세한 결과와 데이터 전환 제안은 [WP30 보고서](reports/WP30.md)를 따른다.
