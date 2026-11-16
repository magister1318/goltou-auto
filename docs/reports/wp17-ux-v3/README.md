# UX v3 비교 캡처

왼쪽은 구현, 오른쪽은 기준 목업이다. 상품·회원·밴드·기록은 합성 자료다. 목업의 화면 10개, 상태 버튼 34개, 시트 16개를 모두 포함한다. 기본 화면과 같은 상태는 아래 별칭으로 연결한다.

비교 PNG 59장: 서로 다른 목업 장면 53개와 추가 장면 6개(표·태그·사진 묶음·사진 실패·alert·범위 오류). 화면 검사 68건, 브라우저 오류와 허용된 외부 요청은 0건이다. 키보드 상태는 WebView 높이를 480px로 줄인 시뮬레이션이다.

재현: `pnpm build` 후 `node scripts/simulate-ux-v3.mjs`. 특정 장면 갱신은 `--only=home-err,settings-typing,settings-range-error`처럼 지정한다. 실제 서비스 엔진이나 계정은 연결하지 않는다.

| 비교 캡처 | 목업 화면 / 상태 / 시트 |
| --- | --- |
| [login-ok](01-login-ok.png) | login / ok |
| [login-empty](02-login-empty.png) | login / empty |
| [login-wrong](03-login-wrong.png) | login / wrong |
| [login-off](04-login-off.png) | login / off |
| [login-busy](05-login-busy.png) | login / busy |
| [home-ok](06-home-ok.png) | home / ok |
| [home-loading](07-home-loading.png) | home / loading |
| [home-searching](08-home-searching.png) | home / searching |
| [home-none](09-home-none.png) | home / none |
| [home-empty](10-home-empty.png) | home / empty |
| [home-err](11-home-err.png) | home / err |
| [product-blog](12-product-blog.png) | product / blog |
| [product-table-scroll](13-product-table-scroll.png) | product / blog |
| [product-tag-bottom](14-product-tag-bottom.png) | product / blog |
| [product-band](15-product-band.png) | product / band |
| [product-photo-grid](16-product-photo-grid.png) | product / band |
| [product-wait](17-product-wait.png) | product / wait |
| [product-photo-failed](18-product-photo-failed.png) | product / wait |
| [product-err](19-product-err.png) | product / err |
| [polish](20-polish.png) | polish |
| [progress](21-progress.png) | progress |
| [result-done](22-result-done.png) | result / done |
| [result-draft](23-result-draft.png) | result / draft |
| [result-uncertain](24-result-uncertain.png) | result / uncertain |
| [result-recfail](25-result-recfail.png) | result / recfail |
| [result-paused](26-result-paused.png) | result / paused |
| [result-relogin](27-result-relogin.png) | result / relogin |
| [result-fail](28-result-fail.png) | result / fail |
| [connect-ok](29-connect-ok.png) | connect / ok |
| [connect-need](30-connect-need.png) | connect / need |
| [connect-checking](31-connect-checking.png) | connect / checking |
| [connect-unknown](32-connect-unknown.png) | connect / unknown |
| [svc](33-svc.png) | svc |
| [history-ok](34-history-ok.png) | history / ok |
| [history-empty](35-history-empty.png) | history / empty |
| [history-err](36-history-err.png) | history / err |
| [history-delprep](37-history-delprep.png) | history / delprep |
| [history-delq](38-history-delq.png) | history / delq |
| [settings-view](39-settings-view.png) | settings / view |
| [settings-typing](40-settings-typing.png) | settings / typing |
| [settings-unsaved](41-settings-unsaved.png) | settings / unsaved |
| [sheet-draft](42-sheet-draft.png) | product / blog / draft |
| [sheet-publish](43-sheet-publish.png) | product / blog / publish |
| [sheet-bands](44-sheet-bands.png) | product / blog / bands |
| [sheet-bandsMany](45-sheet-bandsMany.png) | product / blog / bandsMany |
| [sheet-pubNone](46-sheet-pubNone.png) | product / blog / pubNone |
| [sheet-pubLoading](47-sheet-pubLoading.png) | product / blog / pubLoading |
| [sheet-pubEmpty](48-sheet-pubEmpty.png) | product / blog / pubEmpty |
| [sheet-pubErr](49-sheet-pubErr.png) | product / blog / pubErr |
| [sheet-confirm](50-sheet-confirm.png) | product / blog / confirm |
| [sheet-stop](51-sheet-stop.png) | progress / stop |
| [sheet-unfinished](52-sheet-unfinished.png) | product / blog / unfinished |
| [sheet-changed](53-sheet-changed.png) | product / blog / changed |
| [sheet-dialog](54-sheet-dialog.png) | result / paused / dialog |
| [sheet-delBlog](55-sheet-delBlog.png) | history / ok / delBlog |
| [sheet-delBand](56-sheet-delBand.png) | history / ok / delBand |
| [sheet-leave](57-sheet-leave.png) | settings / unsaved / leave |
| [dialog-alert](65-dialog-alert.png) | result / paused / dialog |
| [settings-range-error](66-settings-range-error.png) | settings / unsaved |

기본 화면 별칭: `login` → `login-ok`, `home` → `home-ok`, `product` → `product-blog`, `result` → `result-done`, `connect` → `connect-ok`, `history` → `history-ok`, `settings` → `settings-view`.
