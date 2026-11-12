# packages/surface

숨김 브라우저를 다루는 공통 약속(Surface)과 기기별 연결.

`src/index.ts`는 기기 API가 없는 공통 계약입니다. 세션은 `naver`, `band`, `ai`이며
`SurfaceHost.clearSession`은 해당 세션의 Surface를 닫고 저장 데이터를 지웁니다.

`src/cdp`는 WebSocket CDP 구현입니다. Android의 사설 파일 소켓은 선택적 전송 옵션으로만
받고, 보이기·숨기기·닫기는 껍데기가 제공한 콜백으로 처리합니다. 기본 입력 간격은 60ms입니다.
읽기 평가는 CDP의 `throwOnSideEffect`를 켜며, 클릭·문자·키 입력은 Input 명령만 사용합니다.
파일 첨부는 `DOM.setFileInputFiles`를 사용합니다. 저장/발행 기능은 WP1에 없습니다.

`open`은 새 문서의 load lifecycle을 기다립니다. 클릭 후 특정 주소로의 이동을 기다릴 때는
`waitForNavigation({ url, timeoutMs })`를 씁니다. 파일 경로는 실행 기기에서 접근 가능한 절대 경로입니다.
