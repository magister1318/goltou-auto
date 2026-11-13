# 사내 APK 배포

패키지는 `kr.goltou.auto`, 이름은 `골투오토`다. 스토어에 올리지 않는다.
Android 11 이상 ARM64/ARMv7 휴대폰용이다. Android System WebView를 최신으로 유지한다.

## 키는 한 번만 만들기

담당자가 저장소 밖의 접근 제한 폴더에서 다음 명령을 한 번 실행한다.
비밀번호는 프롬프트에서 직접 입력한다. 이번 WP12에서는 실제 배포 키를 만들지 않았다.

```powershell
keytool -genkeypair -keystore C:/CompanySecrets/goltou-auto-release.jks -alias goltou-auto -keyalg RSA -keysize 3072 -validity 10000
```

키와 비밀번호는 회사 비밀 보관소에 별도로 백업하고 담당자를 정한다.
키를 잃거나 다른 키로 서명하면 기존 앱 위에 업데이트할 수 없다.
휴대폰에서 앱을 삭제한 뒤 다시 설치해야 하며 로그인과 앱 데이터가 지워진다.
debug 앱에서 배포 키 앱으로 바꿀 때도 같다. 자동으로 삭제하지 않는다.

저장소 밖 `C:/CompanySecrets/goltou-auto-signing.properties`를 만든다.
아래 `<...>`는 담당자가 채우는 자리이며 파일은 Git에 넣지 않는다.
경로는 `/`로 쓴다. 상대 키 경로는 이 properties 파일 기준이다.

```properties
storeFile=C:/CompanySecrets/goltou-auto-release.jks
storePassword=<키 저장소 비밀번호>
keyAlias=goltou-auto
keyPassword=<키 비밀번호>
```

환경 변수 `GOLTOU_SIGNING_PROPERTIES`에 이 파일의 절대 경로를 지정한다.
대신 Git에서 제외된 `apps/android/release-signing.properties`를 써도 되지만,
키 파일은 반드시 저장소 밖에 둔다. 설정 누락·잘못된 키는 빌드 실패이며 debug 키로 대체하지 않는다.

## main에서 빌드

JDK 17, Node 18.20.4 이상, pnpm 10.11.0과 Android SDK 36, build-tools 36.0.0,
NDK 27.3.13750724, CMake 3.22.1이 필요하다. 내장 Node는 18.20.4로 고정되어 있다.
로컬 변경이 없는 checkout에서 실행한다. 배포할 커밋 SHA도 보관한다.

```powershell
$env:GIT_TERMINAL_PROMPT='0'
$env:GCM_INTERACTIVE='never'
git fetch origin main
git switch --detach origin/main
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm android:libnode
pnpm typecheck
pnpm test
pnpm build
$env:GOLTOU_SIGNING_PROPERTIES='C:/CompanySecrets/goltou-auto-signing.properties'
cd apps/android
./gradlew.bat :buildSrc:test assembleRelease --console=plain --no-daemon
```

Gradle이 release 전용 Node·UI 자산을 다시 만든다. 이전 debug 자산은 포함하지 않는다.
APK는 `apps/android/app/build/outputs/apk/release/app-release.apk`다.
`apps/android/version.properties`에서만 Android 버전을 바꾼다. 새 배포마다 versionCode를 올린다.
R8/리소스 축소는 내장 Node·JNI 호환성을 실기기에서 검증하기 전까지 꺼 둔다.
서명 블록의 스토어용 SDK 메타데이터는 제외한다. 같은 환경·키의 재빌드는 비교하지만
다른 PC/도구 버전까지 APK 바이트 동일성을 보장하지는 않는다.

## 휴대폰 설치·업데이트

실제 배포 키로 서명한 APK만 회사 휴대폰에 전달한다. 파일을 열고 해당 파일 앱의
‘이 출처 허용’을 켜 설치한다. 업데이트는 같은 키와 더 큰 versionCode를 사용한다.
USB로 설치할 때는 `adb -s <기기> install -r <APK경로>`를 쓴다.
서명 오류가 나면 멈추고 담당자가 데이터 손실과 전환 시점을 결정한다.
설치 뒤 앱 시작과 직접 로그인을 확인하고 시험 계정에서는 임시저장·재열람까지만 확인한다.
`runs/wp12-release-throwaway`의 시험 키/APK는 배포·업데이트에 쓰지 않는다.

## 현재 보안 예외

외부 평문 통신은 차단한다. UI HTTP·네이티브 WebSocket 때문에 `127.0.0.1`과
`localhost`만 평문 예외다. 코어는 loopback에만 바인딩하고 실행마다 새 토큰으로 인증한다.
Node의 API·사진 요청은 별도로 HTTPS로 제한한다. 백업과 기기 간 데이터 이전은 끈다.

자동 입력은 Node → 앱 전용 `files/devtools.sock` → WebView의
`@webview_devtools_remote_<pid>`로 CDP를 연결한다. 그래서 release에서도
`setWebContentsDebuggingEnabled(true)`가 필요하다. 끄면 대상 검색·입력이 작동하지 않는다.
공개 API에는 ‘같은 프로세스만 허용’ 옵션이 없어 adb 접근까지 없앨 수 없다.
일반 다른 UID 앱은 Chromium의 자격 검사로 거절되지만 같은 UID·root·adb shell은 접근할 수 있다.
사설 중계만으로 원래 소켓을 숨겼다고 보지 않는다. 배포 휴대폰은 USB/무선 디버깅을 끄고
기존 adb 승인을 취소한다. 소유자가 이 제한을 수용할지 결정해야 한다.
근거: [Android WebView 설명](https://developer.android.com/reference/android/webkit/WebView#setWebContentsDebuggingEnabled(boolean)),
[Chromium 소켓 생성](https://chromium.googlesource.com/chromium/src/+/main/android_webview/browser/aw_devtools_server.cc),
[접속 자격 검사](https://chromium.googlesource.com/chromium/src/+/main/content/browser/android/devtools_auth.cc).
