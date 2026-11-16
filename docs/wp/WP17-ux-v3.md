# WP17 — UX v3: close the design gaps, real-looking previews, Band post delete

Owner decisions on 2026-11-16 are binding. Read `docs/design/ux-v3.html` (open it in a browser and click through every
screen, every "state" button and every bottom sheet) before writing code. It is the source of truth for layout, copy
and states. The audit that produced it is on this machine only, at `..\runs\audit\audit.md` (finding ids H01–H07,
M01–M26, L01–L06) with captures under `..\runs\audit\device` and `..\runs\audit\sim`. Do not commit audit files.

## Hard rules

- Branch `codex/ux-v3` already exists on origin (this document and the mock are on it). Work there, push, open a draft PR.
- Never store, type, read or automate any credential. Never open a login page yourself.
- No real Naver publish, no real Naver draft save, no real Band post and no real Band delete in this work package.
  Device work is limited to installing the debug APK (`adb install -r` only) and capturing screens that need no job.
- Phone: read-only two-signal check first (screen awake AND `kr.goltou.auto` in the foreground or launchable without
  waking). Never wake or unlock the phone, touch nothing outside `kr.goltou.auto`. If the screen is off, skip device
  captures, say so in the report, and rely on the simulator.
- Nothing identifying goes into the repo or the report: no account ids, nicknames, blog ids, band names, post URLs,
  cookies, tokens or real product text. Unredacted device captures go only to `..\runs\wp17-shots\`.
- Do not skip, disable or weaken tests. `pnpm -r typecheck` and `pnpm test` must pass with 0 skipped on this machine.
- No AI model names in commits or the PR.

## Content rule (owner, 2026-11-16): move content as it is

The app must not rewrite or add wording to product data. Therefore:

- **M05 is NOT fixed.** Keep showing the price/departure values exactly as the API gives them (e.g. "0원부터 · 출발일 0개").
- **M07 is NOT fixed.** Do not add dividers, labels or captions around the departure table or anywhere inside the
  converted content.
- Do not change the conversion output in this work package at all.

## Bold and links (owner: mandatory, next work package)

The owner requires that bold text and links from the product page reach the real blog post (WP18, immediately after
this one). In WP17:

- The blog preview keeps rendering bold as bold and links as links, exactly as the source has them. Do not downgrade it.
- Do not touch the blog typing engine here, but while you are in the code, write `docs/wp/WP18-notes.md` with what you
  learn about how bold and links could be applied in the Naver editor through the existing surface contract
  (toolbar buttons, shortcuts, link dialog, paste of rich text), and what the verification after typing would read.

## What to build

Implement every remaining finding as drawn in the mock. Group summary:

1. **Publish sheet and band chooser (H01, H07, L03).** Replace the native `<select>` in `packages/ui/src/App.tsx` with
   the "올릴 밴드" row plus the app-drawn band list sheet. Rows at least 56dp, long names wrap to two lines, radio mark,
   search field when there are 9 or more bands, back arrow / Android back returns without changing the choice,
   remember the last chosen band and preselect it. The band name appears once. The band checkbox can always be
   switched off; loading, empty and failed list states never block a blog-only publish; when "다음" is disabled the
   reason is shown above the buttons.
2. **Preview tabs drawn as each service really shows the post (H02, tag part of H03, M08, M09, M10, M24).**
   Blog: title area, body in source order, tables with a header row and horizontal scroll inside the table, tag box at
   the bottom (tags are not body text). Band: the title is the first line of the body, tables become "a | b" lines,
   hashtags at the end of the text, all photos gathered in a grid under the text. The band preview must be derived
   from the same functions the band engine uses (`bandText`, `photoUrls` in `packages/sites/src/band/plan.ts`) so the
   two cannot drift. Sticky tabs with the three-option summary line under them. Photo placeholders reserve the image
   ratio and distinguish loading from failed. The "원문과 달라지는 점" notes under each preview are app chrome, not
   content, and are allowed.
3. **After-run screens (H05, H06, M11, M12, M20, M21).** Separate screens for done, draft saved, "확인 필요"
   (publication uncertain, per-channel rows), record-save failed (headline says published), paused (neutral mark),
   re-login, failed. Per-channel statuses: 발행됨 / 게시됨 / 임시저장됨 / 확인 필요 / 확인을 기다리는 중 / 시작 전 /
   실패. Visibility and band name are kept on the done screen and in history. A service dialog opens a sheet that
   quotes `job.dialog.message` verbatim and labels each button with its consequence; alert-type dialogs show one
   button. Progress title uses the current channel's name.
4. **Sheets (M22, M26, L04, L06).** The unfinished-post sheet and content-changed sheet do not close and do not
   change the job on Android back or outside tap. All sheets lock background scroll and restore the reading position.
   Delete warning uses the red tokens. No default focus outline on the sheet container.
5. **Lists and forms (M03, M04, M06, M13, M14, M15, M19, M25).** Login keeps the id on failure and shows field-level
   errors; product list has distinct first-load skeleton, searching (previous items dimmed and inert), no search
   result, nothing unposted, and failed states; account connect has checking / could-not-check states; the
   intermediate service-login guide page is removed in favour of one line above the real login page; history
   distinguishes a certain failure ("공개되지 않음") from "확인 필요", shows errors inline under the row that caused
   them, and words "could not start deleting" differently from "could not confirm the deletion".
6. **Settings (H04, M16, M17, M23, L01).** When a field gets focus and the keyboard resizes the WebView, scroll the
   field with its label above the keyboard and hide the bottom tabs while editing (fix in the Android shell and/or
   the UI, whichever is reliable; verify on the device if it is awake). Split "내 글 옵션" (applies immediately) from
   "공통 설정" (needs save), show the unsaved-changes bar and the leave-without-saving sheet, radio rows for the
   polish level with a description that follows the selection, long hashtag values wrap under their label, numeric
   range hint and inline range error, no textarea resize handle.
7. **Polish comparison screen (M18).** Only changed paragraphs, changed characters highlighted, per-paragraph revert,
   unchanged paragraphs collapsed, no internal counters.
8. **Common (M01, M02, L02, L05).** Every tappable target at least 48×48dp without enlarging the visible glyphs,
   a pressed state on every button and row, consistent thin scroll indicators, large titles at weight 700.

## Band post delete (formal feature)

- Add a delete function for Band posts next to the blog one, driven through the surface contract in the hidden
  WebView: open the post the app created (from the stored record), use the post's own menu to delete, confirm,
  then verify by re-reading that the post is gone. Return distinct results for deleted / not started / uncertain.
- History: "글 삭제" on band rows → confirmation sheet (red warning, band name, mentions comments are lost) → delete
  → status "삭제함". Only posts recorded by this app can be deleted. Wire the inline error states from item 5.
- The real Band page structure for deletion is not verified. Build it against fixtures, list every selector/assumption
  in the report under "unverified on the real service", and make the code fail safe (never click anything when the
  post identity or the delete control cannot be established with certainty).
- **One-shot real-post gate.** The debug APK keeps blocking real Band submits by default. Add a one-shot allowance that
  an operator sets from the PC (for example a flag file in the app's files dir written with `adb shell run-as`),
  which permits exactly one real Band post and is consumed when the submit is attempted. Deleting a post recorded by
  the app needs no gate. Do not set the allowance yourself.

## Verification and report

- Unit/UI tests for the new state logic (band chooser rules, per-channel statuses, sheet back behaviour, delete
  result mapping, preview derived from engine functions).
- Simulator captures of every screen/state/sheet in the mock, side by side with the mock, in
  `docs/reports/wp17-ux-v3/` (synthetic data only).
- If the phone is awake: install the debug APK and capture the screens reachable without starting a job, unredacted
  into `..\runs\wp17-shots\`, plus a short `..\runs\wp17-shots\summary.txt` (plain text, under 60 lines).
- `docs/reports/WP17-ux-v3.md`: a table of all 39 finding ids with status (done / not fixed by owner decision /
  unverified on device), then what is still unverified.
