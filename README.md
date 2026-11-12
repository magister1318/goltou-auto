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

## 개발·확인

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm sim
pnpm sim:shots
```

PC 시뮬레이션은 설치되어 있는 Chrome/Edge/Chromium의 새 임시 프로필에서 390×844 앱을 엽니다.
예시 계정은 manager / staff / admin, 비밀번호는 demo이며 member는 일반 회원 차단 안내입니다.
실제 서버·서비스를 호출하지 않는 가짜 API와 실행기를 쓰며 Ctrl+C로 종료합니다.
브라우저를 설치하거나 기존 사용자 프로필을 열지 않습니다. 필요하면 현재 프로세스의
`CHROMIUM`에 실행 파일 경로를 지정합니다.

`pnpm sim:check`는 headless로 로그인 → 상품 선택 → 임시저장 → 완료 → 기록,
로그인 풀림 복구, 권한과 관리자 설정, 설정 아래의 로컬 WP1 진단을 확인하고 종료합니다.
`pnpm sim:shots`는 같은 검사 후 `docs/reports/wp3/`에 PNG 11개를 저장합니다.
Android 빌드 방법은 `apps/android/README.md`, 확인 결과는 `docs/reports/WP1.md`,
`docs/reports/WP3.md`에 둡니다. 실기기 실행은 별도 확인이 필요합니다.
