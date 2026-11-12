# packages/ui

앱 화면 (React). 모든 기기 공용. B안 디자인.

WP1은 제목과 브라우저 진단 화면만 제공합니다. B안 토큰은 `src/style.css`에 CSS 변수로
정의하며 Noto Sans KR 네 가지 굵기는 앱에 포함합니다. 외부 폰트 서버에 연결하지 않습니다.
화면은 코어의 `/ui/`에서 제공하며 같은 출처의 `/ui-socket`으로 진단을 요청합니다.
