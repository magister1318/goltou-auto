# 골투오토 (goltou-auto)

골투(goltou.kr)에 올라온 해외투어 상품을 네이버 블로그와 네이버 밴드에 옮겨 쓰는 내부 전용 앱입니다.
골투 매니저(등급 3~6), 내부직원(7), 관리자(8·9)만 씁니다. 공개 배포하지 않습니다.

- 기획: `docs/PRD.md`
- 화면: `docs/design/README.md` (B안, 초록)
- 작업 규칙: `AGENTS.md`
- 작업 묶음과 지시서: `docs/wp/`

## 폴더

```
apps/
  android/      안드로이드 껍데기 (1차)
  desktop/      윈도우·맥 껍데기, Electron (나중)
  ios/          아이폰 껍데기 (나중)
packages/
  core/         작업 순서, 상품 변환, 원문 대조, 로그인 복구, 기록
  sites/        네이버 블로그, 밴드, AI Mode 조작 규칙
  surface/      숨김 브라우저를 다루는 공통 약속과 기기별 연결
  ui/           앱 화면 (React, 모든 기기 공용)
  api-client/   골투 API 호출과 응답 모양
docs/
```

기기별 폴더(`apps/*`)에는 브라우저를 띄우고 조작하는 껍데기만 둡니다. 나머지는 모두 `packages/`에 두고 기기가 같이 씁니다.

## WP1 개발·확인

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm sim
```

PC 시뮬레이션은 설치되어 있는 Chrome/Edge/Chromium을 새 임시 프로필의 headless 모드로
실행합니다. 브라우저를 설치하거나 기존 사용자 프로필을 열지 않습니다. 필요하면 현재 프로세스의
`CHROMIUM`에 실행 파일 경로를 지정합니다. 로컬 예제 주소로 진단을 실행하여 화면에 제목이
표시되는지 확인하고 종료합니다. 화면 캡처는 `tmp/wp1-sim.png`입니다.
Android 빌드 방법은 `apps/android/README.md`, 확인 결과는 `docs/reports/WP1.md`에 둡니다.
