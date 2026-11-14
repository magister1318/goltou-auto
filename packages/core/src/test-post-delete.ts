/** Imported only by the debug Android entry. No deletion API or arbitrary id input. */
import { postIdentity, point, read, readBlogDocument, sleep, waitFor, type BlogExecution, type PublishedPost } from '@goltou/sites';
import type { SurfaceDialog } from '@goltou/surface';
import { blogObservation } from './blog';
import { compareDocuments, observePlan } from './verify';

export interface TestPostPage { url: string; titles: string[]; privateLabels: number; publicLabels: number; photos: number }
export function identifyTestPost(pages: TestPostPage[], expectedTitle: string) {
  const posts = pages.filter(p => p.titles.length > 0);
  if (posts.length !== 1) throw new Error('BLOG_TEST_DELETE_REFUSED');
  const p = posts[0]!, title = p.titles[0];
  const identity = postIdentity(p.url);
  if (!identity || p.titles.length !== 1 || title !== expectedTitle || !title.startsWith('[골투오토 실험]') ||
      !title.includes('WP14 private-once') || p.privateLabels !== 1 || p.publicLabels !== 0 || p.photos !== 13) throw new Error('BLOG_TEST_DELETE_REFUSED');
  return identity;
}
export const testPostPageSource = `return docs.map(({d})=>({url:d.location.href,
  titles:Array.from(d.querySelectorAll('.se-documentTitle .se-text-paragraph')).map(e=>(e.textContent||'').trim()),
  privateLabels:Array.from(d.querySelectorAll('span,div,p')).filter(e=>!e.children.length&&visible(e)&&(e.textContent||'').trim()==='비공개').length,
  publicLabels:Array.from(d.querySelectorAll('span,div,p')).filter(e=>!e.children.length&&visible(e)&&(e.textContent||'').trim()==='전체공개').length,
  photos:d.querySelectorAll('.se-component.se-image .se-image-resource').length}));`;
// Read the actual focused element; the debug shell separately checks native window focus.
export const testPostFocusSource = `let a=document.activeElement;while(a?.tagName==='IFRAME'&&a.contentDocument)a=a.contentDocument.activeElement;return !!a&&!a.isContentEditable&&!['INPUT','TEXTAREA'].includes(a.tagName);`;
export function requireTestDeleteConfirmation(dialog: SurfaceDialog | null | undefined, receipt: PublishedPost) {
  if (!dialog || dialog.kind !== 'confirm' || postIdentity(dialog.url ?? '')?.url !== receipt.url || !/^(정말 삭제하시겠습니까\?|삭제하시겠습니까\?|이 글을 삭제하시겠습니까\?)$/.test(dialog.message.trim())) throw new Error('BLOG_TEST_DELETE_CONFIRM_UNCONFIRMED');
}

export async function deleteTestPost(execution: BlogExecution, record: (value: { matches: boolean; fields: string[]; photos: number; stage: string }) => Promise<void> = async () => {}) {
  if (attempted.has(execution)) throw new Error('BLOG_TEST_DELETE_ALREADY_ATTEMPTED');
  const surface = execution.surface;
  const title = execution.plan.steps.find(s => s.kind === 'text' && s.role === 'title');
  if (!surface || title?.kind !== 'text') throw new Error('BLOG_TEST_DELETE_REFUSED');
  const receipt = identifyTestPost(await read<TestPostPage[]>(surface, testPostPageSource), title.text);
  if (execution.publishedPost && execution.publishedPost.url !== receipt.url) throw new Error('BLOG_TEST_DELETE_REFUSED');
  const current = async () => {
    const candidate = identifyTestPost(await read<TestPostPage[]>(surface, testPostPageSource), title.text);
    if (candidate.url !== receipt.url) throw new Error('BLOG_TEST_DELETE_REFUSED');
  };
  await current();
  const comparison = compareDocuments(observePlan(execution.plan as import('./convert').InputPlan), blogObservation(execution.plan as import('./convert').InputPlan, execution.files, await readBlogDocument(surface)));
  const evidence = { matches: comparison.matches, fields: comparison.differences.map(d => d.field), photos: comparison.counts.photos };
  await record({ ...evidence, stage: 'identified' });
  const controls = await read<number>(surface, `return docs.reduce((n,{d})=>n+Array.from(d.querySelectorAll('a,button')).filter(e=>visible(e)&&(e.textContent||'').trim()==='삭제').length,0);`);
  if (controls !== 1) throw new Error('BLOG_TEST_DELETE_CONTROL_UNCONFIRMED');
  // Covers preparatory input too. A failed cleanup cannot be retried by this execution.
  attempted.add(execution);
  await surface.show();
  let target = await point(surface, 'a,button', '삭제');
  for (let i = 0; !target && i < 30; i++) {
    if (!await read<boolean>(surface, testPostFocusSource) ||
        !await surface.readClickTarget?.(600, 450, 'body')) throw new Error('BLOG_TEST_DELETE_FOCUS_UNCONFIRMED');
    await surface.pressKey({ key: 'PageDown' }); await sleep(150);
    target = await point(surface, 'a,button', '삭제');
  }
  if (!target || !await surface.readClickTarget?.(target.x, target.y, 'a,button')) throw new Error('BLOG_TEST_DELETE_CONTROL_UNCONFIRMED');
  // Latch before the one destructive interaction. Never retry another route.
  await current();
  const beforePress = async () => {
    await current();
    const now = await point(surface, 'a,button', '삭제');
    if (!now || now.x !== target!.x || now.y !== target!.y || !await surface.readClickTarget?.(now.x, now.y, 'a,button') ||
        !await read<boolean>(surface, testPostFocusSource)) throw new Error('BLOG_TEST_DELETE_CONTROL_UNCONFIRMED');
  };
  await record({ ...evidence, stage: 'before-delete' });
  await surface.click(target.x, target.y, beforePress).catch(async error => { if (!await surface.readDialog?.()) throw error; });
  await sleep(500);
  const dialog = await surface.readDialog?.();
  requireTestDeleteConfirmation(dialog, receipt);
  if (!dialog || !surface.respondDialog) throw new Error('BLOG_TEST_DELETE_CONFIRM_UNCONFIRMED');
  await record({ ...evidence, stage: 'before-confirm' });
  await surface.respondDialog(dialog.id, true);
  await sleep(800);
  // Reopen exactly the receipt URL. A redirect alone is not deletion proof.
  await surface.open({ url: receipt.url, session: 'naver', width: 1280, height: 900,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
  await waitFor(() => read<boolean>(surface, `return !docs.some(({d})=>d.querySelector('.se-documentTitle'))&&docs.some(({d})=>Array.from(d.querySelectorAll('.error_content,.error_wrap,[data-post-deleted]')).some(e=>visible(e)&&/삭제된|존재하지 않는|찾을 수 없/.test(e.textContent||'')));`), 10000);
  await verifyTestPostAbsentFromList(surface, receipt.url, title.text);
  await record({ ...evidence, stage: 'verified-gone' });
}
export async function verifyTestPostAbsentFromList(surface: NonNullable<BlogExecution['surface']>, url: string, title: string) {
  const receipt = postIdentity(url);
  if (!receipt) throw new Error('BLOG_TEST_DELETE_REFUSED');
  const blog = new URL(receipt.url).pathname.split('/')[1]!;
  await surface.open({ url: `https://blog.naver.com/PostList.naver?blogId=${encodeURIComponent(blog)}&from=postList&categoryNo=0`, session: 'naver', width: 1280, height: 900,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
  await waitFor(() => read<boolean>(surface, `return docs.some(({d})=>d.querySelector('.blog2_post_function,.post-list,.list_post,.blog2_list,[data-post-list]'));`), 10000);
  // URL construction inside throwOnSideEffect evaluation is not supported by
  // Chromium. Read hrefs only and parse them in Node, without changing the page.
  const links = await read<string[]>(surface, `return docs.flatMap(({d})=>Array.from(d.querySelectorAll('a[href]')).map(e=>e.href));`);
  const titlePresent = await read<boolean>(surface, `return docs.some(({d})=>(d.body?.innerText||'').includes(${JSON.stringify(title)}));`);
  // An empty skeleton or an unrecognized list is not evidence of absence.
  const absent = links.some(url => postIdentity(url)) && !titlePresent && !links.some(url => postIdentity(url)?.url === receipt.url);
  if (!absent) throw new Error('BLOG_TEST_DELETE_LIST_UNCONFIRMED');
}
const attempted = new WeakSet<BlogExecution>();
