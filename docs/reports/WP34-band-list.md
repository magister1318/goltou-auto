# WP34 밴드 목록 복구와 실패 진단

소유자가 1.0.1 (5) 서명 릴리스에서 NAVER ID로 밴드 로그인한 뒤 목록을
읽지 못한 문제를 대상으로 했다. 실기기 로그가 없어서 실제 원인은 확정하지 않았다.
특정 API 호스트·버전에 묶인 읽기 허용과 화면만 사용하는 목록 읽기를 보완했다.
기존 `codex/release-connect-fix`, 초안 PR #31에서 이어서 작업한다.

- 목록 조회 중에만 HTTPS band.us 계열의 get_, check_, is_, read_, sync_, batch
  POST를 허용한다. 작성기가 있거나 제출 승인이 있으면 이 단계에 진입하지 않는다.
  요청 때도 작성기 여부를 확인하며 생성 후보는 계속 차단한다. 조회가 끝나면 원래 차단 규칙으로 돌아간다.
- 같은 조회의 응답 훅에서 호스트·숫자 버전이 다른 get_band_list GET/POST 응답도
  읽는다. 별도 API 호출은 하지 않는다. 화면 읽기가 성공하면 화면 결과를 우선하고,
  실패하면 같은 15초 관찰 시간에 받은 API 목록을 쓴다. 중첩 목록·중복·빈 목록을 구분한다.
  명시적인 쓰기 금지는 제외하고 권한 정보가 없으면 남겨 기존 작성기 검사에 맡긴다.
- 영구 band_list 작업 로그에 마지막 host/path, legacy/home/my 표식의 각각 존재 여부
  (모두 false면 none), 로그인 폼, 타일 수, 차단 요청 method/host/path/코드,
  API 포착 여부·행 수, DOM/API/none 출처, 최종 사유를 남긴다.
  재사용한 창의 응답도 현재 목록 작업 로그에 남긴다. WP33과 같은 정제로
  path의 연속 3자리 이상 숫자를 `{n}`으로 가리고 80자로 제한한다.
  페이지 내용·이름·밴드 번호·요청 본문·쿠키·쿼리 문자열은 진단에 넣지 않는다.
- 최종 사유는 BAND_LIST_DOM, BAND_LIST_API_ONLY, BAND_LIST_EMPTY,
  BAND_HOME_UNRECOGNIZED, BAND_LIST_INCOMPLETE, BAND_LOGIN_LOST 등으로 구분한다.
  화면의 실패 문구와 다시 읽기는 유지하고 로그인 해제 안내 또는 잠시 뒤 다시 읽기
  안내 한 줄만 추가했다. WP33 로그인 코드는 변경하지 않았다.
- 버전을 1.0.2 (6)으로 올렸다. 기존 외부 키만 사용하며 키·비밀번호를 출력·복사·커밋하지 않는다.

최종 확인 결과:

| 명령·검사 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile`, `pnpm typecheck` | 통과, lockfile 변경 없음 |
| `pnpm test` + JSON 증거 검사 | 99파일·1,206시험 통과, 실패·건너뜀·TODO 0, 961.20초. 런타임 시험 6개 포함 |
| 새 시험과 목록·읽기 배치·게시 차단 개별 회귀 | 5파일·73시험 통과. 새 시험 22개 포함 |
| 영구 로그 개별 회귀 | 53시험 통과 |
| `pnpm check:secrets`와 소스 내장 엔진 검사 | 통과, 소스 99파일 |
| `pnpm build`, `assembleDebug`, `assembleRelease` | 통과. 최종 소스에서 debug 8초, release 24초 |
| `scripts/install-device.ps1 -Variant release -VerifyOnly -ArtifactDirectory ../release-out` | 통과. INSTALLED=False. 실제 APK의 두 내장 번들·소스 커밋·release 변형·v2/v3 서명 검사 통과 |
| apksigner·aapt 직접 비교, SHA-256 파일 비교 | 인증서 SAME, 패키지 kr.goltou.auto, versionCode 5 → 6 증가, 해시 파일 일치 |

깨끗한 소스 커밋 `5fa100981ea42cb5af02fc6f631c2ea2fae942b7`에서 전체 게이트를 실행했다.
이후 커밋은 이 보고서의 결과만 기록하며 실행 코드는 바꾸지 않는다.
전체 게이트 첫 실행은 동시 요청별 진단 코드 보완을 위해 시험 도중 중단했다.
그 회귀를 추가한 뒤 새 커밋에서 전체 게이트를 다시 실행해 위 결과를 얻었다.
초기 타입·fixture 기대값 오류도 수정한 뒤 전체 검사에 통과했다.

배포 파일: `../release-out/goltou-auto-1.0.2-6-release.apk` 및 `.apk.sha256`.
크기: 56,110,356 bytes.
APK SHA-256: `66c3c16ade69ccc5a073de6f66230a077f1fa3095ea3ae8c3e426629402b9a98`.

apksigner 인증서 SHA-256 직접 대조:

- 이전 1.0.1 (5): `B8EA4A8C931A8C711B2D4538ED8618045ABC202A3CF58B35639CCDACE5950665`
- 새 1.0.2 (6): `B8EA4A8C931A8C711B2D4538ED8618045ABC202A3CF58B35639CCDACE5950665`
- 결과: SAME. 새 APK의 v2/v3 서명 모두 검증했다.
- aapt: `kr.goltou.auto`, `1.0.1 (5)` → `1.0.2 (6)`.

외부 증거: `../runs/blog-shots/wp34-install-gate.log`, `wp34-android-debug.log`,
`wp34-apk-verification.txt`, `wp34-summary.txt`.

실기기·실제 계정·네이버/밴드 호출·게시·휴대폰 설치·삭제·데이터 초기화는 하지 않았다.
실제 NAVER ID 로그인 프로필의 목록 응답 형태, 실기기 목록 표시와 업데이트 후
로그인·데이터 보존은 소유자의 후속 확인이 필요하다.
