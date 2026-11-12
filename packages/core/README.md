# packages/core

작업 순서, 상품 변환, 원문 대조, 로그인 복구, 기록. 기기 전용 코드 금지.

WP1에서는 `startCore({ host, uiDir, ... })`만 구현합니다. 127.0.0.1의 임의 포트에
실행마다 새 토큰으로 서버를 열고 `/native`, `/ui/`, `/ui-socket`, `/health`를 제공합니다.
껍데기에서 토큰을 넘길 때도 프로세스 실행마다 새 난수를 만들어야 합니다.

UI의 첫 요청은 `?token=...`으로 인증하고 HTTP-only, SameSite=Strict 실행 쿠키를 받습니다.
UI는 주소에서 토큰을 지웁니다. `/native`는 쿠키를 받지 않으며 토큰이 필요합니다.
WebSocket의 Origin과 HTTP Host를 검사합니다. 서비스 로그인 쿠키를 읽거나 서버로 보내는 API는 없습니다.

UI 진단 요청은 한 번에 한 건만 받고 Surface 하나에서 제목을 읽은 다음 닫습니다.
`NativeBridge`는 껍데기와의 요청/응답만 중계하며 기기 API를 직접 부르지 않습니다.
