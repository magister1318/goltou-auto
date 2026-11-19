# WP35 밴드 목록 기억하기

기존 codex/release-connect-fix 브랜치와 초안 PR #31에서 작업했다. 새 PR을 열거나 병합하지 않았다.

바꾼 내용:

- 기존 preferences와 같은 앱 전용 파일 저장 방식으로 band-list-cache.json에 savedAt과 key/name만 원자적으로 저장한다. 서버 전송, 작업 로그, 로그 내보내기, 로컬 데이터 옮기기에 포함하지 않는다.
- 24시간 미만 목록은 BAND surface 없이 즉시 반환한다. 재시작 뒤 choices를 채워 기존 대상 검증을 유지하고, 같은 키의 사진 한도와 관측 시각을 보존한다.
- 24시간 이상 목록은 먼저 반환하고 백그라운드에서 한 번 읽는다. 동시에 들어온 읽기는 공유하며, 같은 오래된 목록의 자동 갱신이 실패하면 수동 새로고침 전까지 반복하지 않는다.
- refresh=true는 BAND를 읽는다. 일반 실패에는 이전 목록과 시각을 보존하고 실패 안내를 함께 전달한다. 로그인 해제와 연결 초기화에서는 파일·메모리 목록을 비우며, 진행 중 읽기가 뒤늦게 끝나도 캐시를 복구하지 못하게 했다. 기존 로그아웃·연결 초기화 감지 경계를 계정 전환의 무효화 경계로 사용하며 쿠키나 계정 식별자를 새로 읽지 않는다.
- 앱 snapshot으로 갱신 결과를 전달한다. 선택한 키가 남으면 유지하고 사라지면 선택을 비운다. 응답 순서가 뒤집혀도 이전 목록으로 돌아가지 않는다.
- 발행 창과 밴드 선택 창에 작은 새로고침 글자 버튼과 회색 마지막 확인 시각을 넣었다. 갱신 중과 캐시를 보존한 실패에서도 목록을 사용할 수 있다.
- 캐시 대상의 경로 이탈, 탈퇴·없어진 밴드·글쓰기 권한 없음의 화면/확인창을 발행 전에 확인한다. 발견 시 해당 대상은 실패, 나머지 미실행 대상은 중단하고 캐시를 비운다. 안내는 ‘밴드 목록이 바뀌었습니다. 새로고침 후 다시 골라 주세요.’다. 같은 작업의 이어하기와 재시도도 막는다. 작성기를 열기 전에 실패한 작업은 빈 작성기를 버리려 하지 않고 종료할 수 있다. 기존 armed create·대상 검증·요청 차단 규칙은 유지한다.
- band_list 로그에는 cache/band, 경과 분, 오래됨, 수동 요청 여부, 행 수, 캐시 제거와 고정 사유 코드만 추가한다. 이름·밴드 번호·쿼리는 기록하지 않는다.
- 버전은 1.0.3 (7)이다. WP33 로그인 코드는 변경하지 않았고 WP34 목록 읽기에는 캐시 선택 초기화만 연결했다.

확인한 내용:

- 새 코어 시험 23개와 UI 시험 3개 통과. 정상 캐시 대상의 작성기 열기·게시 전 검증, 임시로 꺼진 게시 버튼 구분, 실제 App의 선택 유지, 갱신 중 조작, 실패 안내, 오래된 응답 무시와 결과 화면의 정확한 한국어 안내까지 확인했다.
- 기존 밴드 목록 시험 21개도 수정 없이 통과했다.
- `scripts/install-device.ps1 -Variant release -VerifyOnly -ArtifactDirectory ../release-out` 통과. `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `assembleRelease`, 비밀 파일 검사, 소스·APK 내부 엔진 검사를 모두 포함한다.
- 전체 101파일·1,232시험 통과. 실패·건너뜀·TODO 0, 런타임 시험 6개 포함. 최종 전체 시험 시간 959.42초.
- Node 18 소스 호환성 검사 100파일, 실제 APK 내부 번들 검사 2파일 통과. APK의 sourceCommit과 release 변형도 확인했다.
- `apps/android`에서 `./gradlew.bat :buildSrc:test testDebugUnitTest testReleaseUnitTest assembleDebug --console=plain` 통과. 빌드 설정 시험 10개와 앱 시험 debug/release 각 10개, 실패·오류·건너뜀 0. 최종 debug 빌드 14초.
- 외부의 기존 키로 `assembleRelease` 통과(별도 9초, 전체 게이트에서는 최신 산출물 재확인 1초). 키·비밀번호는 출력·복사·커밋하지 않았다.
- apksigner로 이전 1.0.2 (6)와 배포 폴더의 새 APK를 직접 대조했다. v2/v3 서명 모두 유효하며 인증서 SAME이다. aapt로 패키지 kr.goltou.auto, 버전 1.0.2 (6) → 1.0.3 (7), versionCode 증가를 확인했다. APK 해시와 .apk.sha256 내용도 일치한다.

실기기, 실제 계정, 실제 BAND/NAVER 호출, 게시, 휴대폰 설치·삭제·데이터 초기화는 하지 않았다. 전체 게이트의 결과는 INSTALLED=False다.
실기기의 표시 속도, 실제 서비스의 권한 안내 형태, 업데이트 뒤 기존 로그인·데이터 보존은 소유자 확인이 필요하다.


배포 파일:

- `../release-out/goltou-auto-1.0.3-7-release.apk`
- `../release-out/goltou-auto-1.0.3-7-release.apk.sha256`
- 크기: 56,124,432 bytes.
- APK SHA-256: `faa108c529f8773b99a5df22040d390bdf0bd7dc6022d87b5f3bbe03a0222549`.
- 이전 1.0.2 (6) 인증서 SHA-256: `B8EA4A8C931A8C711B2D4538ED8618045ABC202A3CF58B35639CCDACE5950665`.
- 새 1.0.3 (7) 인증서 SHA-256: `B8EA4A8C931A8C711B2D4538ED8618045ABC202A3CF58B35639CCDACE5950665`.
- 인증서 비교 SAME, versionCode 6 → 7.

깨끗한 소스 커밋 `452aedc18e6598c0914c0857f77db99c6214bb1b`에서 전체 게이트를 완주했다.
이후 커밋은 이 보고서의 최종 결과만 기록하며 실행 코드를 바꾸지 않는다.

초기 전체 게이트 세 번은 결과 화면의 한국어 안내, 권한 확인창 선확인, 정상 작성기의 일시 비활성 게시 버튼 구분을 보강하기 위해 중단했다. 초기 합성 시험의 타입·기대값 오류도 수정했다.
최종 소스의 첫 전체 실행에서는 기존 로컬 API 계약 시험 2개에 연결 오류가 나서 1,230통과·2실패로 게이트가 중단됐다. 해당 파일 24개 단독 실행과 캐시 시험 뒤 연속 실행 47개가 통과했다. 소스와 시험을 바꾸지 않고 전체 게이트를 다시 실행해 위의 1,232개 전체 통과를 확인했다. 연결 오류의 원인은 확정하지 못했으며 실패 로그도 보관했다. 운영 API나 실제 계정은 사용하지 않았다.

외부 확인 자료는 `../runs/blog-shots/`에 있다:

- `wp35-install-gate.log`: 최종 전체 통과와 INSTALLED=False.
- `wp35-install-gate-local-api-failed.log`: 로컬 API 연결 오류가 난 이전 전체 실행.
- `wp35-install-gate-interrupted.log`, `wp35-install-gate-interrupted2.log`, `wp35-install-gate-interrupted3.log`: 보강을 위해 중단한 실행.
- `wp35-android-debug.log`, `wp35-release-build.log`: Android 검사와 빌드.
- `wp35-apk-embedded.log`, `wp35-apk-verification.txt`: 실제 APK 내부 검사, 서명·버전·해시 대조.
- `wp35-summary.txt`: 소유자용 20줄 이하 요약.
