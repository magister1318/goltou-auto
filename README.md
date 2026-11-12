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
