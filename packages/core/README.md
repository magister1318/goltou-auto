# packages/core

작업 순서, 상품 변환, 원문 대조, 로그인 복구, 기록. 기기 전용 코드 금지.

WP1에서는 `startCore({ app, host, uiDir, ... })`만 구현합니다. 127.0.0.1의 임의 포트에
실행마다 새 토큰으로 서버를 열고 `/native`, `/ui/`, `/ui-socket`, `/health`를 제공합니다.
껍데기에서 토큰을 넘길 때도 프로세스 실행마다 새 난수를 만들어야 합니다.

UI의 첫 요청은 `?token=...`으로 인증하고 HTTP-only, SameSite=Strict 실행 쿠키를 받습니다.
UI는 주소에서 토큰을 지웁니다. `/native`는 쿠키를 받지 않으며 토큰이 필요합니다.
WebSocket의 Origin과 HTTP Host를 검사합니다. 서비스 로그인 쿠키를 읽거나 서버로 보내는 API는 없습니다.

UI 진단 요청은 한 번에 한 건만 받고 Surface 하나에서 제목을 읽은 다음 닫습니다.
`NativeBridge`는 껍데기와의 요청/응답만 중계하며 기기 API를 직접 부르지 않습니다.

WP3의 `AppCore`는 `/ui-socket`의 `AppRequest`를 처리합니다. 메시지 약속과 작업 상태는
`src/protocol.ts`에 있고 UI에는 계정·설정·서비스 상태·작업 진행 스냅샷만 전달합니다.
골투 접속 토큰은 UI로 보내지 않습니다. Android는 `TokenStore`를 Keystore 암호화 저장소로 구현합니다.
로컬 시험과 시뮬레이터는 `MemoryTokenStore`를 명시적으로 사용합니다.

`AppCore`의 API 인수와 `startCore`의 app은 필수입니다. 가짜 API는 시험/시뮬레이터에서만 명시적으로 주입합니다. `RegistrationRunner`와 AppCore 생성자의 factory로
실제 실행기를 교체할 수 있습니다. checkpoint는 기록 저장, notify는 화면 진행 알림을 맡습니다.
중단·실패·로그인 풀림은 같은 작업의 단계·진행 수·기록 번호를 보존하고, 이미 저장한 채널은
다시 running으로 바꾸지 않습니다. 끝나지 않은 작업이 있으면 두 번째 작업과 로그아웃을 막습니다.
발행 작업은 `publishConfirmed: true`를 별도로 받아야 시작합니다.

서비스 로그인 표시·확인·지우기도 현재는 가짜 상태만 바꿉니다. 실제 서비스 페이지나
프로필을 건드리지 않습니다. WP1의 실제 Surface 진단 경로는 설정의 진단에서 계속 사용합니다.

WP7의 `conversion-audit.ts`는 디버그 실험에서만 연결하며 최신 상품 최대 60개를 1초 이상 간격으로 읽습니다.
본문·제목·URL·식별 계정 없이 상품 번호와 수치만 남깁니다. 사이트를 열지 않으므로 밴드 한도 미관측은 null입니다.
