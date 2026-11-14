/** Imported only by the debug Android entry. No deletion API or arbitrary id input. */
import { postIdentity, readBlogDocument, requireTestPost, point, read, sleep, waitFor, type BlogExecution } from '@goltou/sites';

export async function deleteTestPost(execution: BlogExecution) {
  const surface = execution.surface, receipt = execution.publishedPost;
  if (!surface || !receipt) throw new Error('BLOG_TEST_DELETE_REFUSED');
  const current = async () => {
    const urls = await read<string[]>(surface, 'return docs.map(({d})=>d.location.href);');
    const candidate = urls.map(postIdentity).find(value => value?.url === receipt.url) ?? null;
    requireTestPost(receipt, candidate, (await readBlogDocument(surface)).title);
  };
  await current();
  const controls = await read<number>(surface, `return docs.reduce((n,{d})=>n+Array.from(d.querySelectorAll('a,button')).filter(e=>visible(e)&&(e.textContent||'').trim()==='삭제').length,0);`);
  if (controls !== 1) throw new Error('BLOG_TEST_DELETE_CONTROL_UNCONFIRMED');
  const target = await point(surface, 'a,button', '삭제');
  if (!target || !await surface.readClickTarget?.(target.x, target.y, 'a,button')) throw new Error('BLOG_TEST_DELETE_CONTROL_UNCONFIRMED');
  // Latch before the one destructive interaction. Never retry another route.
  if (attempted.has(execution)) throw new Error('BLOG_TEST_DELETE_ALREADY_ATTEMPTED');
  attempted.add(execution);
  await current();
  await surface.click(target.x, target.y).catch(async error => { if (!await surface.readDialog?.()) throw error; });
  await sleep(500);
  const dialog = await surface.readDialog?.();
  if (!dialog || dialog.kind !== 'confirm' || !/^(정말 삭제하시겠습니까\?|삭제하시겠습니까\?|이 글을 삭제하시겠습니까\?)$/.test(dialog.message.trim()) || !surface.respondDialog) throw new Error('BLOG_TEST_DELETE_CONFIRM_UNCONFIRMED');
  await surface.respondDialog(dialog.id, true);
  await sleep(800);
  // Reopen exactly the receipt URL. A redirect alone is not deletion proof.
  await surface.open({ url: receipt.url, session: 'naver', width: 1280, height: 900,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
  await waitFor(() => read<boolean>(surface, `return !docs.some(({d})=>d.querySelector('.se-documentTitle'))&&docs.some(({d})=>Array.from(d.querySelectorAll('.error_content,.error_wrap,[data-post-deleted]')).some(e=>visible(e)&&/삭제된|존재하지 않는|찾을 수 없/.test(e.textContent||'')));`), 10000);
}
const attempted = new WeakSet<BlogExecution>();
