import { blogDeleteScrollHitClasses, traceStep, trace } from '@goltou/surface/telemetry';
import type { ClickTargetMiss, GuardedRequest, Surface, SurfaceDialog } from '@goltou/surface';
import { point, read, sleep, waitFor } from '../dom';
import { postIdentity, type PublishedPost } from './publish-safety';
import { settledReadback } from '../settled-readback';

export interface DeletePage { url: string; titles: string[]; privateLabels: number; publicLabels: number; photos: number; edits?: number; deletes?: number }
export const deleteSelector = '.area_btn_postedit a._deletePost';
/** Observed PC deletePostFrm: a POST after the native confirmation. */
export const blogDeleteFields = ['blogId', 'cpage', 'categoryNo', 'parentCategoryNo', 'viewDate', 'sourceCode', 'logNo', 'currentPage'] as const;
export function inspectBlogDeleteRequest(request: GuardedRequest, targetUrl: string): boolean {
  const target = postIdentity(targetUrl);
  if (!target || request.method !== 'POST' || !request.postDataComplete || request.contentType?.split(';')[0]?.trimStart().trimEnd().toLowerCase() !== 'application/x-www-form-urlencoded') return false;
  try {
    const url = new URL(request.url), fields = new URLSearchParams(request.postData);
    return url.protocol === 'https:' && url.hostname === 'blog.naver.com' && url.pathname === '/PostDelete.naver' && !url.search &&
      JSON.stringify([...fields.keys()].sort()) === JSON.stringify([...blogDeleteFields].sort()) &&
      fields.get('blogId') === new URL(target.url).pathname.split('/')[1] && fields.get('logNo') === target.postId;
  } catch { return false; }
}
/** Install on the fresh surface for a confirmed registration-history deletion. */
export async function guardRecordedBlogDelete(surface: Surface, targetUrl: string) {
  if (!surface.guardRequests) throw new Error('BLOG_REQUEST_BARRIER_UNAVAILABLE');
  let available = true;
  await surface.guardRequests([{ hostname: 'blog.naver.com', pathname: '/PostDelete.naver' }], request => {
    const allowed = available && inspectBlogDeleteRequest(request, targetUrl);
    available = false;
    trace('barrier', allowed ? 'ok' : 'fail', { reason: allowed ? 'BLOG_POST_DELETE_REQUEST_ALLOWED' : 'BLOG_POST_DELETE_REQUEST_NOT_AUTHORIZED' });
    return allowed;
  }, () => {}, () => false);
}
export const deletePageSource = `return docs.map(({d})=>({url:d.location.href,
  titles:Array.from(d.querySelectorAll('.se-documentTitle .se-text-paragraph')).map(e=>(e.textContent||'').trimStart().trimEnd()),
  privateLabels:Array.from(d.querySelectorAll('span,div,p')).filter(e=>!e.children.length&&visible(e)&&(e.textContent||'').trimStart().trimEnd()==='비공개').length,
  publicLabels:Array.from(d.querySelectorAll('span,div,p')).filter(e=>!e.children.length&&visible(e)&&(e.textContent||'').trimStart().trimEnd()==='전체공개').length,
  photos:d.querySelectorAll('.se-component.se-image .se-image-resource').length,
  edits:Array.from(d.querySelectorAll('.area_btn_postedit a')).filter(e=>visible(e)&&(e.textContent||'').trimStart().trimEnd()==='수정').length,
  deletes:Array.from(d.querySelectorAll('${deleteSelector}')).filter(e=>visible(e)&&(e.textContent||'').trimStart().trimEnd()==='삭제').length}));`;
// Avoid matches/closest: the Android PC page rejects those under throwOnSideEffect.
export const deleteFocusSource = `let a=document.activeElement;while(a?.tagName==='IFRAME'&&a.contentDocument)a=a.contentDocument.activeElement;return !!a&&!a.isContentEditable&&!['INPUT','TEXTAREA'].includes(a.tagName);`;
export const deleteMessage = '삭제된 글은 복구할 수 없습니다. 삭제하시겠습니까?';
export function requireDeleteConfirmation(dialog: SurfaceDialog | null | undefined, receipt: PublishedPost) {
  if (!dialog || dialog.kind !== 'confirm' || postIdentity(dialog.url ?? '')?.url !== receipt.url || dialog.message.trimStart().trimEnd().replace(/\s+/g, ' ') !== deleteMessage) throw new Error('BLOG_POST_DELETE_CONFIRM_UNCONFIRMED');
}
/** Values contain numbers only. Item numbers are documented in the WP14 report. */
export interface DeleteDiagnostic { item: number; pass: number; actual?: number; expected?: number; x?: number; y?: number; width?: number; height?: number; elapsedMs?: number; run?: number }
export interface DeleteTarget {
  url: string; title: string; verifyListTitle?: boolean;
  extraIdentity?(page: DeletePage): DeleteDiagnostic[];
}
export type DeleteLog = (value: DeleteDiagnostic) => Promise<void>;
export function deleteIdentity(pages: DeletePage[], target: DeleteTarget): DeleteDiagnostic[] {
  const posts = pages.filter(p => p.titles.length), p = posts[0];
  const expected = postIdentity(target.url), actual = p && postIdentity(p.url);
  return [
    { item: 1, pass: Number(posts.length === 1), actual: posts.length, expected: 1 },
    { item: 2, pass: Number(p?.titles.length === 1 && p.titles[0] === target.title) },
    { item: 3, pass: Number(!!expected && actual?.postId === expected.postId && actual?.url === expected.url) },
    { item: 4, pass: Number(p?.edits === 1 && p.deletes === 1) },
    ...(p ? target.extraIdentity?.(p) ?? [] : []),
  ];
}
const geometrySource = `return docs.flatMap(({d,x,y})=>Array.from(d.querySelectorAll('${deleteSelector}')).filter(e=>visible(e)&&(e.textContent||'').trimStart().trimEnd()==='삭제'&&d.querySelector('.se-documentTitle')).map(e=>{const r=e.getBoundingClientRect();return {x:x+r.left+r.width/2,y:y+r.top+r.height/2,width:r.width,height:r.height};}));`;
type Rect = { x: number; y: number; width: number; height: number };
const same = (a: Rect | undefined, b: Rect | undefined) => !!a && !!b && ['x', 'y', 'width', 'height'].every(k => a[k as keyof Rect] === b[k as keyof Rect]);
const noop: DeleteLog = async () => {};

async function findDeleteScrollPoint(surface: Surface, run: number, attempt: number) {
  const { width, height } = await read<{ width: number; height: number }>(surface, 'return {width:innerWidth,height:innerHeight};');
  const fractions = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.3], [0.5, 0.7]] as const;
  for (const [index, [left, top]] of fractions.entries()) {
    const x = width * left, y = height * top;
    let miss: ClickTargetMiss | undefined;
    let hit = false, retry = false;
    try {
      hit = !!await surface.readClickTarget?.(x, y, 'body', {
        onMiss: { classes: blogDeleteScrollHitClasses, ariaLabels: [], report: value => { miss = value; } },
      });
      // The probes never click or change focus.
      retry = !hit && index < fractions.length - 1;
    } finally {
      const rejected = miss?.rejectedHit;
      const hitDetails = rejected && {
        tag: rejected.tag, classes: rejected.classes, iframe: rejected.tag === 'iframe' || miss?.inaccessibleFrame === true,
      };
      trace('sites.naver-blog.delete.preparePostDelete', 'decision', {
        choice: hit ? 'ok' : retry ? 'retry' : 'fail',
        counts: { step: 7, runs: run, attempt },
        blogDeleteScroll: {
          x, y, ...hitDetails,
          ...(miss?.inShadow !== undefined ? { inShadow: miss.inShadow } : {}),
          ...(miss?.frameDepth !== undefined ? { frameDepth: miss.frameDepth } : {}),
        },
      });
    }
    if (hit) return { x, y };
    if (!retry) break;
  }
  return null;
}

export async function preparePostDelete(surface: Surface, target: DeleteTarget, log: DeleteLog = noop, run = 0) {
    return traceStep('sites.naver-blog.delete.preparePostDelete', async () => {
  const check = async (items: DeleteDiagnostic[]) => {
    for (const item of items) {
      if (item.item <= 4 || item.pass !== 1) trace('verification', item.pass === 1 ? 'ok' : 'fail', {
        check: item.item <= 4 ? 'identity' : item.item === 8 ? 'focus' : item.item === 9 ? 'alert_kind' : 'input',
        counts: { expected: item.expected ?? 1, observed: item.actual ?? item.pass, step: item.item },
      });
      await log({ ...item, run });
    }
    const failed = items.find(i => i.pass !== 1);
    if (failed) throw new Error(`BLOG_POST_DELETE_CHECK_${failed.item}`);
  };
  const safeRead = async <T>(item: number, action: () => Promise<T>) => {
    try { return await action(); } catch { trace('sites.naver-blog.delete.preparePostDelete', 'fail', { reason: 'CAUGHT_FAILURE' });  await check([{ item, pass: 0 }]); throw new Error(`BLOG_POST_DELETE_CHECK_${item}`); }
  };
  const identity = async () => check(deleteIdentity(await safeRead(1, () => read<DeletePage[]>(surface, deletePageSource)), target));
  const focus = async () => check([{ item: 8, pass: Number(await safeRead(8, async () => await surface.readAppFocus?.() !== false && await read<boolean>(surface, deleteFocusSource))) }]);
  const noDialog = async () => check([{ item: 9, pass: Number(!await safeRead(9, async () => surface.readDialog?.())) }]);
  await noDialog(); await identity(); await focus();
  let at = await point(surface, deleteSelector, '삭제');
  for (let i = 0; !at && i < 100; i++) {
    await noDialog(); await identity(); await focus();
    const rects = await safeRead(5, () => read<Rect[]>(surface, geometrySource));
    await check([{ item: 5, pass: Number(rects.length === 1), actual: rects.length, expected: 1 }]);
    const scrollPoint = await safeRead(7, () => findDeleteScrollPoint(surface, run, i + 1));
    await check([{ item: 7, pass: Number(!!scrollPoint), ...(scrollPoint ?? {}) }]);
    await surface.pressKey({ key: rects[0]!.y < 0 ? 'PageUp' : 'PageDown' }); await sleep(300);
    at = await point(surface, deleteSelector, '삭제');
  }
  // Lazy images can move the link after scrolling. Require identical full rects,
  // 300 ms apart, before hit testing. All samples stay numeric.
  let previous: Rect | undefined, stable: Rect | undefined, previousAt = 0, stableAt = 0, stableInterval = 0;
  for (let i = 0; i < 30; i++) {
    const rects = await safeRead(5, () => read<Rect[]>(surface, geometrySource));
    await check([{ item: 5, pass: Number(rects.length === 1), actual: rects.length, expected: 1 }]);
    const now = rects[0]!;
    const nowAt = Date.now(), elapsedMs = previous ? nowAt - previousAt : 0;
    await log({ item: 60, pass: 1, actual: Number(same(previous, now)), ...now, elapsedMs, run });
    if (same(previous, now)) { stable = now; stableAt = nowAt; stableInterval = elapsedMs; break; }
    previous = now; previousAt = nowAt; await sleep(300);
  }
  await check([{ item: 6, pass: Number(!!stable), elapsedMs: stableInterval }]);
  if (!stable) throw new Error('BLOG_POST_DELETE_CHECK_6');
  const beforePress = async () => {
    await noDialog(); await identity();
    const now = (await safeRead(6, () => read<Rect[]>(surface, geometrySource)))[0];
    await check([{ item: 6, pass: Number(same(stable, now)), ...(now ?? {}), elapsedMs: Date.now() - stableAt }]);
    const visiblePoint = await point(surface, deleteSelector, '삭제');
    let hit = false;
    try { hit = !!visiblePoint && !!await surface.readClickTarget?.(stable.x, stable.y, deleteSelector); } catch { trace('sites.naver-blog.delete.preparePostDelete', 'fail', { reason: 'CAUGHT_FAILURE' });  /* numeric refusal below */ }
    await check([{ item: 7, pass: Number(hit), x: stable.x, y: stable.y }]);
    await focus(); await noDialog();
  };
  await beforePress();
  return { point: stable, beforePress };

    });
  }
export const deleteOpenOptions = (url: string) => ({ url, session: 'naver' as const, width: 1280, height: 900,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
// A missing-post URL may show a native alert before its load event. Inspect it
// through Surface while navigation is pending; never accept an unknown dialog.
export async function openPostDeletionRead(surface: Surface, url: string): Promise<boolean> {
    return traceStep('sites.naver-blog.delete.openPostDeletionRead', async () => {
  const expected = postIdentity(url);
  if (!expected) throw new Error('BLOG_POST_DELETE_IDENTITY_UNCONFIRMED');
  if (await surface.readDialog?.()) throw new Error('BLOG_POST_DELETE_EXISTING_DIALOG');
  let finished = false, failure: unknown;
  const navigation = surface.open(deleteOpenOptions(url)).then(() => { finished = true; }, error => { finished = true; failure = error; });
  while (!finished) {
    const dialog = await surface.readDialog?.();
    if (dialog) {
      // Exact fixed messages only. Unknown alerts stay unanswered.
      const missing = ['게시물이 삭제되었거나 다른 페이지로 변경되었습니다.'];
      if (dialog.kind !== 'alert' || postIdentity(dialog.url ?? '')?.url !== expected.url || !missing.includes(dialog.message.trimStart().trimEnd().replace(/\s+/g, ' '))) throw new Error('BLOG_POST_DELETE_READ_ALERT_UNCONFIRMED');
      if (!surface.respondDialog || await surface.readAppFocus?.() === false) throw new Error('BLOG_POST_DELETE_READ_ALERT_UNCONFIRMED');
      // Reject the read-only missing-post alert; only the deletion confirm is accepted.
      await surface.respondDialog(dialog.id, false);
      await navigation;
      return true;
    }
    await sleep(100);
  }
  if (failure) throw failure;
  return false;

    });
  }
export async function verifyPostAbsentFromList(surface: Surface, url: string, title: string, timeoutMs = 90000) {
    return traceStep('sites.naver-blog.delete.verifyPostAbsentFromList', async () => {
  const receipt = postIdentity(url);
  if (!receipt) throw new Error('BLOG_POST_DELETE_IDENTITY_UNCONFIRMED');
  const blog = new URL(receipt.url).pathname.split('/')[1]!;
  await surface.open(deleteOpenOptions(`https://blog.naver.com/PostList.naver?blogId=${encodeURIComponent(blog)}&from=postList&categoryNo=0`));
  const settled = await settledReadback({ timeoutMs,
    check() {},
    read: async () => {
      if (await surface.readAppFocus?.() === false) throw Error('BLOG_POST_DELETE_CHECK_8');
      if (await surface.readDialog?.()) throw Error('BLOG_POST_DELETE_READ_ALERT_UNCONFIRMED');
      const snapshot = await read<{ready:boolean;empty:boolean;links:string[];titlePresent:boolean;login:boolean}>(surface, `
        const roots=docs.map(({d})=>d).filter(d=>d.querySelector('.blog2_post_function,.post-list,.list_post,.blog2_list,[data-post-list]'));
        return {ready:roots.length>0&&roots.every(d=>d.readyState==='complete'),
          empty:roots.some(d=>Array.from(d.querySelectorAll('.no_post,.noPost,.no_result,[data-post-list-empty]')).some(e=>visible(e)&&/등록된 (?:글|게시글)이 없|게시글이 없|작성한 글이 없/.test(e.textContent||''))),
          links:roots.flatMap(d=>Array.from(d.querySelectorAll('a[href]')).map(e=>e.href)),
          titlePresent:${JSON.stringify(!!title)}&&docs.some(({d})=>(d.body?.innerText||'').includes(${JSON.stringify(title)})),
          login:docs.some(({d})=>!!d.querySelector('input[type="password"]'))};`);
      if(snapshot.login)throw Error('LOGIN_OR_EDITOR_LOST');
      const postUrls = [...new Set(snapshot.links.map(postIdentity).filter((p):p is PublishedPost=>!!p&&new URL(p.url).pathname.split('/')[1]===blog).map(p=>p.url))].sort();
      return {ready:snapshot.ready,empty:snapshot.empty,postUrls,titlePresent:snapshot.titlePresent,targetPresent:postUrls.includes(receipt.url)};
    },
    classes: value => [
      {check:'feed_location',reason:'READBACK_POST_LIST',expected:1,observed:value?.ready?1:0,present:!!value?.ready},
      {check:'links',reason:'READBACK_POST_LIST_LINKS',expected:1,observed:value?.postUrls.length??0,present:!!value?.empty||(value?.postUrls.length??0)>0},
      {check:'same_post',reason:'READBACK_POST_LIST_ABSENCE',expected:0,observed:value?.targetPresent||value?.titlePresent?1:0,present:!!value&&!value.targetPresent&&!value.titlePresent},
    ],
  });
  if (!settled.stable || settled.classes.some(item => !item.present)) {
    for (const item of settled.classes) if (!item.present) trace('verification', 'fail', {
      check: item.check, reason: item.reason, counts: { expected: item.expected, observed: item.observed },
    });
    throw Error('BLOG_POST_DELETE_LIST_UNCONFIRMED');
  }

    });
  }
export async function verifyPostGone(surface: Surface, target: DeleteTarget) {
    return traceStep('sites.naver-blog.delete.verifyPostGone', async () => {
  const missingAlert = await openPostDeletionRead(surface, target.url);
  if (!missingAlert) await waitFor(() => read<boolean>(surface, `return !docs.some(({d})=>d.querySelector('.se-documentTitle'))&&docs.some(({d})=>Array.from(d.querySelectorAll('.error_content,.error_wrap,[data-post-deleted]')).some(e=>visible(e)&&/삭제된|존재하지 않는|찾을 수 없/.test(e.textContent||'')));`), 10000, { surface, control: "BLOG_POST_ABSENT" });
  await verifyPostAbsentFromList(surface, target.url, target.verifyListTitle === false ? '' : target.title);

    });
  }
/** Three complete dry runs on this page precede the single destructive input. */
export async function deleteBlogPost(surface: Surface, target: DeleteTarget, log: DeleteLog = noop) {
    return traceStep('sites.naver-blog.delete.deleteBlogPost', async () => {
  const receipt = postIdentity(target.url);
  if (!receipt) throw new Error('BLOG_POST_DELETE_IDENTITY_UNCONFIRMED');
  for (let run = 1; run <= 3; run++) {
    await preparePostDelete(surface, target, log, run);
    await log({ item: 14, pass: 1, run });
  }
  const prepared = await preparePostDelete(surface, target, log, 4);
  let pressed = false;
  await surface.click(prepared.point.x, prepared.point.y, async () => { await prepared.beforePress(); pressed = true; await log({ item: 15, pass: 1 }); }).catch(async error => { if (!pressed || !await surface.readDialog?.()) throw error; });
  await sleep(500);
  const dialog = await surface.readDialog?.();
  requireDeleteConfirmation(dialog, receipt);
  if (!pressed || !dialog || !surface.respondDialog || await surface.readAppFocus?.() === false) throw new Error('BLOG_POST_DELETE_CONFIRM_UNCONFIRMED');
  await log({ item: 16, pass: 1 });
  trace('job.checkpoint', 'ok', { checkpoint: 'before_submit' });
  await surface.respondDialog(dialog.id, true); await sleep(800);
  await verifyPostGone(surface, target);
  await log({ item: 17, pass: 1 });

    });
  }
