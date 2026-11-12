# packages/api-client

골투 API 호출과 응답 모양. 계약은 docs/api-contract.md.

`ApiRoutes`는 계약의 9개 POST 경로를 입력·출력 타입으로 묶습니다.
`createApiClient(baseUrl, fetcher)`에는 fetch를 주입하며 요청마다 호출자가 토큰을 넘깁니다.
클라이언트는 토큰을 보관하지 않습니다. 모든 실패는 한국어 메시지와 `code`를 가진 `ApiError`입니다.
실제 서버 주소는 기본값으로 두지 않으며 WP3 앱은 이 HTTP 구현을 연결하지 않습니다.

`createFakeApi()`는 같은 `ApiClient`의 메모리 구현입니다. 예시 상품 16개, 채널별 기록,
설정, 세션과 권한을 포함합니다. manager / staff / admin 계정은 비밀번호 demo,
member 또는 0~2는 일반 회원 차단 안내를 재현합니다. 실제 자격 증명을 쓰지 마세요.
가짜 주소는 전부 example.invalid이며 네트워크를 호출하지 않습니다.
