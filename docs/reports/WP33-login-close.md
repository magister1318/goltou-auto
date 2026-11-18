# WP33 로그인 화면 종료 복구

1.0.0 (4) 코드에서 로그인 팝업을 거절했고, 인증 경로와 로그인 후 이동 경로를 너무 좁게
허용했다. 보이는 창에서 차단된 이동은 코어에 전달되지 않아 로그인 확인이 멈출 수 있었다.
이전 실행의 미커밋 수정은 검토 후 이어서 완성했다.

- 로그인 정책이 있는 창에서 실제 자식 WebView를 만들고 같은 프로필·설정·정책을 적용했다.
  부모와 메시지를 주고받는 구조를 유지하며 같은 돌아가기 표시줄 아래에 올린다.
  자식 닫기, 부모 숨기기, 파괴 때 자식도 제거한다. 분리된 View의 파괴는 메인 큐에서 처리한다.
- 인증은 NAVER의 nid 호스트 전체, BAND는 auth.band와 nid 호스트 전체를 허용한다.
  지정한 서비스 홈 호스트는 모든 경로를 숨긴 상태로만 처리하고 나머지는 차단한다.
- 차단·랜딩은 즉시 숨기고 숨김 확인을 한다. 미확인은 로그인 화면을 다시 열고,
  세 번째에는 멈추고 앱 오류 문구를 보인다. 보이는 페이지 확인 주기는 유지하면서
  약 3초 간격으로 같은 프로필의 별도 숨김 창을 확인한다. 취소·종료 때 확인과 타이머를 정리한다.
- 실제 host와 path를 진단 및 영구 login_check 작업 로그에 남긴다. 쿼리·조각·페이지 내용·
  입력값·쿠키는 담지 않는다. path의 연속 3자리 이상 숫자는 {n}으로 가리고 80자로 제한한다.
  팝업 열기·닫기, 랜딩·차단 숨김, 확인 결과, 재시도 한도를 구분한다.
- 버전은 소유자 결정대로 1.0.1 (5)다. 골투 로그인 등급과 등록·발행 동작은 변경하지 않았다.

현재 확인: 로그인 관련 TypeScript 5파일 97시험 통과, pnpm typecheck 통과.
Android :buildSrc:test 10시험, debug/release JVM 각 10시험, assembleDebug 통과.
처음 Android 명령은 외부 서명 설정 환경 변수 누락으로 실패했고 경로 지정 후 통과했다.
기존 좁은 경로를 전제로 한 시험 기대값도 새 정책에 맞게 고쳤다.
깨끗한 커밋에서 release VerifyOnly 게이트와 이전 APK 인증서 대조 결과는 후속 기록한다.

실기기 미확인: 실제 NAVER 로그인 후 자동 닫힘, BAND NAVER ID 팝업의 opener/postMessage 왕복,
휴대폰 WebView의 추가 인증·캡차, 실제 업데이트 설치와 로그인·데이터 보존, 로그 내보내기 UI.
휴대폰·계정·로그인 페이지를 열지 않았고 설치·삭제·데이터 초기화·게시를 하지 않았다.

구현 근거: [Android 자식 창 전달](https://developer.android.com/reference/android/webkit/WebChromeClient#onCreateWindow(android.webkit.WebView,%20boolean,%20boolean,%20android.os.Message)),
[사용 전 프로필 지정](https://developer.android.com/reference/androidx/webkit/WebViewCompat#setProfile(android.webkit.WebView,java.lang.String)).
