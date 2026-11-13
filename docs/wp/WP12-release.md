# WP12 릴리스 빌드

이번 사용자 지시가 범위다. 최신 origin/main에서 `codex/release-build`를 만든다.

- 사내 소수 휴대폰에 직접 설치할 `kr.goltou.auto` release APK를 만든다. 앱 이름은 유지한다.
- debug 전용 화면·실험 옵션·로그·보안 설정을 감사하고 release에서 제거/비활성화한다. CDP 필수 예외와 adb 노출은 설명한다.
- 버전은 한 곳에서 관리한다. 서명은 외부 키와 환경 변수/무시되는 로컬 설정을 사용하며, 없으면 명확히 실패한다.
- 실제 배포 키는 만들지 않는다. 저장소 밖 runs의 일회용 시험 키만 사용한다.
- 설정 단위 시험, pnpm install/typecheck/test/build, Gradle debug/release 빌드를 확인한다.
- 연결된 휴대폰에는 설치·삭제하지 않는다. APK 도구로 패키지·버전·보안 플래그·크기를 확인한다.
- 한국어 배포 안내·보고서와 WP 목록을 갱신하고 커밋·푸시·초안 PR을 만든다.
