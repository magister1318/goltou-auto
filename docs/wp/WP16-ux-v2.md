# WP16. Screen rebuild to the approved mock (UX v2) + Band direct posting

The owner used the app on the phone and judged it "development-stage, far below deployable; UI/UX well below standard".
A full clickable mock was then drawn and **approved by the owner on 2026-11-14**: `docs/design/ux-v2.html`
(open it in a browser and click through every screen and sheet; the side panel explains the intent of each screen).
This package rebuilds the app screens to match that mock. The mock is the source of truth for layout, wording, hierarchy and flow.
Sample products/photos in the mock are placeholders; use real data.

Base: branch `codex/ux-v2` (already contains WP15 service login). Push to this branch and open a draft PR against `main`.

## Decisions (owner, 2026-11-14)
1. Band: after the in-app preview, pressing "발행" makes the app post to Band itself. The Band screen is never shown. This replaces "게시 전 멈춤".
2. "임시저장" applies to the blog only (Band has no drafts).
3. Blog publish default visibility is 전체공개; it can be changed in the publish sheet each time (전체공개 / 비공개).
4. Real users are not developers. Naver/Band pages are visible only during the login step. During a job only app-drawn screens are visible.
5. No "모름" state. The app checks by itself: "확인 중" briefly, then "연결됨" or "로그인 필요". If a check fails (offline etc.), say so in a plain sentence with a "다시 확인" action; never the word "모름".

## Screens to build (all in the mock)
- 골투 로그인, 상품 목록(connection chips, search, 전체/안 올린 상품, photo thumbnails, upload status per product)
- 상품 미리보기: blog/band preview switch, options row, bottom bar with **임시저장 and 발행 side by side**
- Sheets: 임시저장, 발행(destinations, visibility, band needs login → login link), 발행 확인, 중단 확인, 글 삭제 확인
- 옮기는 중 (see below), 완료, 계정 연결, 네이버·밴드 로그인(WP15 behaviour, keep), 로그인이 풀렸을 때(resume after login), 실패했을 때, 등록 기록(글 보기 / 글 삭제 / 다시 시도, 내 기록/전체 by role), 설정
- "글 보기" opens the post with an Android VIEW intent (Naver/Band app or the phone browser), never an in-app hidden surface.
- Remove every path that shows a job surface to the user ("골투오토로 돌아가기" over a WebView must exist only for the WP15 login surface, and as designed there).
- Failure/stop messages: one sentence on what happened (first of all whether anything became public) and one on what to do. No error codes on user screens; codes stay in records/logs. Provide a mapping from existing failure codes to plain Korean sentences, with a sensible generic fallback.
- Debug/experiment menus stay debug-build only and out of the normal navigation.
- Visual language: existing golf green (#0F5132 / #177A41), light theme, no generic "AI style", no cards with left colour bars. Follow the mock's spacing and type scale. Check at 360–412dp widths and with long product titles.

## "옮기는 중" — the owner's explicit request
The owner found sparse progress "boring beyond words" and approved the mock's live version. Required:
- An app-drawn "지금 만들어지는 글" pane that fills in real time with the **real product content** in insertion order: title typed, each paragraph typed, each photo shown as "사진 N 올리는 중" with its own fill and then the real thumbnail. Nothing in it is clickable. It is NOT the WebView.
- Headline = what is being done now; sub line changes continuously (which paragraph of how many, which photo of how many and its percent).
- Photo strip: one cell per photo, filling one by one. "올린 뒤 확인" pills ticking one by one during verification (제목, 본문, 사진 수, 가격·날짜 숫자, 해시태그 — use the checks the engine really performs).
- Smooth overall bar, percent, elapsed time and remaining estimate that move continuously (interpolate between engine events; estimate from block counts and measured per-block times; never jump backwards, never sit at 100% waiting).
- Destination indicator 블로그 → 밴드 when both are selected.
- To support this the engines must emit fine-grained progress events (job stage, block kind/index/total, photo index/total, per-photo fraction where observable, verification item start/finish, submit). Add them to core protocol; keep them free of page content beyond what the app already has. If an engine step gives no intermediate signal, animate within the step from the measured typical duration, but the block that is shown as done must really be done.
- Keep the screen awake during a job; handle app background/return without losing the view (rebuild from job state).
- Respect reduced-motion.

## Band direct posting
- In publish mode with Band selected: write text and photos as today, verify content against the source, then press the Band post button once and verify the post exists (result signal + post identity). Record as band published with what is needed for "글 보기".
- Guards equivalent to the blog ones: the post request stays blocked at network level until the explicit submit step; verify the target band is the selected one; one press only; on any unconfirmed result stop and report "게시됐는지 확인하지 못했습니다" with guidance, never retry blindly.
- Band target: use the existing band selection; show the band name in the publish sheet and confirmation.
- **Do NOT press the real Band post button on the device or on any real account in this package.** Build and test against fixtures only. The real Band post test needs separate owner approval.

## Verification
- typecheck, tests, build, `assembleDebug`.
- Screenshot every screen and sheet from the UI simulator into the report folder.
- Device (R3CX10HP9CB): read-only check that the screen is on and `kr.goltou.auto/.MainActivity` is foreground (two signals) before install; `adb install -r`; never wake/unlock; touch nothing outside `kr.goltou.auto`. Capture real screenshots of 상품 목록, 미리보기, both sheets, 계정 연결, 등록 기록, 설정.
- At most ONE real blog 임시저장 run to confirm the live progress screen end to end (capture several screenshots during it). No publish, no Band post, no delete of anything not created by this run.
- Report `docs/reports/WP16-ux-v2.md`: say first, in plain words, what a user can now do and what is still fixture-only or temporary. State passed vs skipped test counts separately.

## Standing rules
Never store/type/read/automate credentials for Goltou, Naver, Band or Google. No account ids, nicknames, blog ids, band names, post URLs, cookies, tokens or product text in the repo, report or logs. Use `gh`/git with `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`; never trigger login or account windows. No AI model names in commits or PR text.
