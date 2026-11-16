# WP18 — Bold text and links must reach the real blog post

Owner decision (2026-11-16): bold text (for emphasis) and links (customers use them to ask about the product) from the
product page are mandatory in the blog post. Today the blog engine types `step.text` only and drops `runs`
(`bold`, `href`). Read `docs/wp/WP18-notes.md` first. Branch: `codex/blog-rich-text` (based on `codex/ux-v3`).

## Goal

After a blog draft save or publish, every paragraph in the saved Naver post has the same bold ranges and the same
link targets (same visible text, same href) as the conversion plan's `runs`, in the same order.

## Rules

- Move content as it is. Do not change conversion output wording, do not append URLs to the body as a substitute for a
  real link, do not add or drop characters to make verification pass.
- Input only through the existing surface contract the way a person would (toolbar, keyboard, the editor's own link
  dialog). No DOM setters, no innerHTML, no scripted Selection changes. If the contract truly lacks something, stop
  and describe the smallest addition instead of working around it.
- If formatting cannot be applied or verified, the job must not silently succeed: follow the existing
  stop/"확인 필요" paths, and report formatting loss per paragraph. Never publish a post whose formatting check failed
  without telling the user on the result screen.
- All existing guarantees stay: typing pace, photo order, tables, tags, price/date number checks, draft identity,
  leftover-autosave prevention, the one-shot Band gate.
- Band is unchanged (Band has no bold; link text stays as the band plan already produces it).
- No credentials, never open a login page, never wake or unlock the phone, touch nothing outside `kr.goltou.auto`,
  `adb install -r` only, nothing identifying in the repo or report (no account ids, blog ids, band names, post URLs,
  real product text). No AI model names in commits or the PR. Do not skip or weaken tests.

## Phase A — no phone needed

1. Carry `runs` through `BlogPlan` / `BlogExecution` so each paragraph is typed run by run with the right bold state
   and links.
2. Extend the saved-document reader to return normalized runs (text, bold, href) per paragraph and compare them with
   the plan after save, before and after reopening, as the notes describe.
3. Build this against a synthetic editor fixture that models toolbar state, selection by keyboard, a link dialog, and
   the failure cases in the notes (dialog cancelled, state not toggled, partial input then resume, Hangul/emoji
   boundaries). Keep every real-editor selector and shortcut in one clearly marked place.
4. Progress screen: keep the live view truthful (bold shown as bold, links as links while typing). Result screen and
   history: show a formatting problem as "확인 필요" with which paragraphs, per the UX v3 patterns.
5. `pnpm -r typecheck` and `pnpm test` pass with 0 skipped on this machine.

## Phase B — needs the phone awake with the app in the foreground (read-only two-signal check first)

Allowed on the real service in this work package: opening the Naver blog write page inside the app's hidden WebView,
typing in it, and **saving a draft (never public) at most 3 times in total**. Publishing is forbidden. Band is not
touched. Use a product that is on sale and has both bold text and at least one link in its description.

1. Probe the real editor read-only first: record the actual toolbar/shortcut/link-dialog structure (in the report,
   without identifying data), then align the marked selector block with it.
2. Run one full draft save through the app and verify the saved draft's runs against the plan. If it fails, fix and
   retry within the 3-save budget. Leave no unsaved leftover in the editor.
3. Capture the progress screen and the result, unredacted, into `..\runs\wp18-shots\` with a `summary.txt`
   (plain text, under 60 lines: what matched, what did not, paragraph counts, timings).

If the phone is not awake, finish Phase A, push, open the draft PR, and say clearly that Phase B is pending.

## Report

`docs/reports/WP18-blog-bold-links.md`: what the user gets now, verification table (bold ranges / links: planned vs
saved), real-editor facts learned, what remains unverified. Draft PR against `main` (it will show WP17 commits until
PR #21 is merged; say so in the PR body).
