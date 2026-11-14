/** Debug-only readback of the single interrupted private publish. Never publishes or deletes. */
import { readFile, writeFile } from 'node:fs/promises';
import type { ApiClient } from '../../../packages/api-client/src';
import type { SurfaceHost } from '../../../packages/surface/src';
import { BlogExecution, postIdentity, read, point, waitFor, deleteIdentity, deletePageSource, openPostDeletionRead, deleteOpenOptions, type DeletePage } from '../../../packages/sites/src';
import { makePreview } from '../../../packages/core/src/preparation';
import { blogObservation } from '../../../packages/core/src/blog';
import { compareDocuments, observePlan } from '../../../packages/core/src/verify';
import { protectCleanupInputs } from './test-post-recovery';

export interface PrivatePublishRecovery {
  postNo: number; productNo: number; startedAt: string; title: string; url: string; contentHash: string;
  files: { url: string; path: string }[];
}
export async function verifyInterruptedPrivatePublish(context: PrivatePublishRecovery, api: ApiClient, token: string, host: SurfaceHost, ready: () => Promise<void>) {
  const refuse = () => { throw new Error('BLOG_PUBLISH_RECOVERY_REFUSED'); };
  const receipt = postIdentity(context.url);
  if (!receipt || !context.title || context.title.startsWith('[골투오토 실험]') || context.files?.length !== 13) refuse();
  const records = await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token);
  const matching = records.items.filter(p => p.postNo === context.postNo && p.productNo === context.productNo && p.startedAt === context.startedAt && p.productTitle === context.title && p.channel === 'blog' && p.mode === 'publish' && !p.productChanged && (p.status === 'failed' && p.failReason === 'BLOG_PUBLISHED_PRIVATE_UNCONFIRMED' && !p.postUrl || p.status === 'published' && p.postUrl === receipt!.url));
  if (matching.length !== 1) refuse();
  const product = await api.request('/auto/products/get', { productNo: context.productNo }, token);
  const me = await api.request('/auto/me', {}, token);
  if (product.title !== context.title || product.contentHash !== context.contentHash) refuse();
  const preview = makePreview(product, { closing: false, linkCard: false, hashtags: me.settings.defaultHashtags });
  const expected = observePlan(preview.blog);
  if (!preview.verification.blog.matches || JSON.stringify(expected.photos) !== JSON.stringify(context.files.map(f => f.url))) refuse();
  // Ordinals come from the original download filenames, not the observed page order.
  if (context.files.some((f, i) => !new RegExp(`^goltou-[a-f0-9]{16}-${i + 1}\\.[a-z]+$`, 'i').test(f.path.split(/[\\/]/).pop() ?? ''))) refuse();
  await ready();
  const surface = await host.create('naver');
  try {
    protectCleanupInputs(surface, ready);
    if (!surface.blockRequests) refuse();
    await surface.blockRequests!(['/RabbitWrite.naver', '/RabbitUpdate.naver', '/RabbitTempPostWrite.naver', '/RabbitTempPostUpdate.naver'].map(pathname => ({ hostname: 'blog.naver.com', pathname })));
    await surface.open({ url: receipt!.url, session: 'naver', width: 1280, height: 900, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
    const pages = await waitFor(async () => { const value = await read<DeletePage[]>(surface, deletePageSource); return value.some(p => p.titles.length) ? value : false; }, 15000);
    if (deleteIdentity(pages, { url: receipt!.url, title: context.title }).some(i => i.pass !== 1)) refuse();
    const execution = new BlogExecution(preview.blog, context.files, { host, mode: 'publish', visibility: 'private', beforeSave: refuse, check() {}, progress() {}, verify(actual) {
      if (!compareDocuments(expected, blogObservation(preview.blog, context.files, actual)).matches) throw new Error('BLOG_PUBLISH_RECOVERY_READBACK_MISMATCH');
    } });
    execution.surface = surface; execution.publishedPost = receipt!;
    await execution.verifyPublished();
    // Recheck the owned record after readback. No transition is written on a guard failure.
    const latest = await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token);
    const original = matching[0]!;
    const current = latest.items.filter(p => p.postNo === original.postNo && p.productNo === original.productNo && p.startedAt === original.startedAt && p.productTitle === original.productTitle && p.status === original.status && p.postUrl === original.postUrl && p.failReason === original.failReason && !p.productChanged);
    if (current.length !== 1) refuse();
    if (original.status !== 'published') await api.request('/auto/posts/update', { postNo: context.postNo, status: 'published', step: 7, failReason: '', postUrl: receipt!.url }, token);
    const after = await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token);
    if (after.items.filter(p => p.postNo === context.postNo && p.startedAt === context.startedAt && p.productNo === context.productNo && p.status === 'published' && p.postUrl === receipt!.url && !p.failReason).length !== 1) throw new Error('BLOG_PUBLISH_RECOVERY_RECORD_UNCONFIRMED');
    return { verified: true, private: true, photos: context.files.length, recorded: true, identitySources: ['result-url', 'title'], readbackTimings: execution.readbackTimings };
  } finally { await host.destroy(surface); }
}
export async function recoverPrivatePublish(file: string, api: ApiClient, token: string, host: SurfaceHost, ready: () => Promise<void>) {
  const context = JSON.parse(await readFile(file, 'utf8')) as PrivatePublishRecovery;
  const result = await verifyInterruptedPrivatePublish(context, api, token, host, ready);
  await writeFile(file + '.result', JSON.stringify(result), { mode: 0o600 });
  await writeFile(file, '{}', { mode: 0o600 });
}
export async function inspectRecordedPost(file: string, api: ApiClient, token: string, host: SurfaceHost, ready: () => Promise<void>) {
  const context = JSON.parse(await readFile(file, 'utf8')) as Pick<PrivatePublishRecovery, 'postNo' | 'productNo' | 'startedAt' | 'title' | 'url'>;
  const receipt = postIdentity(context.url);
  if (!receipt) throw new Error('BLOG_POST_READ_REFUSED');
  const records = await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token);
  if (records.items.filter(p => p.postNo === context.postNo && p.productNo === context.productNo && p.startedAt === context.startedAt && p.productTitle === context.title && (p.status === 'published' && p.postUrl === receipt.url || p.status === 'stopped' && p.failReason === 'BLOG_POST_DELETED' && !p.postUrl)).length !== 1) throw new Error('BLOG_POST_READ_REFUSED');
  await ready(); const surface = await host.create('naver');
  try {
    protectCleanupInputs(surface, ready);
    await surface.blockRequests!(['/RabbitWrite.naver', '/RabbitUpdate.naver', '/RabbitTempPostWrite.naver', '/RabbitTempPostUpdate.naver'].map(pathname => ({ hostname: 'blog.naver.com', pathname })));
    const missingAlert = await openPostDeletionRead(surface, receipt.url);
    const pages = await read<DeletePage[]>(surface, deletePageSource);
    const present = pages.some(p => postIdentity(p.url)?.url === receipt.url && p.titles.length === 1 && p.titles[0] === context.title);
    const blog = new URL(receipt.url).pathname.split('/')[1]!;
    await surface.open(deleteOpenOptions(`https://blog.naver.com/PostList.naver?blogId=${encodeURIComponent(blog)}&from=postList&categoryNo=0`));
    await waitFor(() => read<boolean>(surface, `return docs.some(({d})=>d.querySelector('.blog2_post_function,.post-list,.list_post,.blog2_list,[data-post-list]'));`), 10000);
    const links = await read<string[]>(surface, `return docs.flatMap(({d})=>Array.from(d.querySelectorAll('a[href]')).map(e=>e.href));`);
    const titlePresent = await read<boolean>(surface, `return docs.some(({d})=>(d.body?.innerText||'').includes(${JSON.stringify(context.title)}));`);
    const result = { present, missingAlert, listPostMatches: links.filter(url => postIdentity(url)?.url === receipt.url).length, listTitlePresent: titlePresent, drafts: null as null | { count: number; sameTitle: number; savedTimes: string[] } };
    if (missingAlert && !titlePresent && !result.listPostMatches) {
      // Open only the list. Never select, edit or delete a saved draft.
      await surface.open(deleteOpenOptions('https://blog.naver.com/GoBlogWrite.naver'));
      const selector = 'button[data-click-area="tpb*s.count"]';
      const target = await waitFor(() => point(surface, selector), 15000);
      const safe = async () => { await ready(); if (!await surface.readClickTarget?.(target.x, target.y, selector) || await surface.readDialog?.()) throw new Error('BLOG_DRAFT_LIST_READ_REFUSED'); };
      await safe(); await surface.click(target.x, target.y, safe);
      result.drafts = await waitFor(() => read<{ count: number; sameTitle: number; savedTimes: string[] } | false>(surface, `const list=docs.flatMap(({d})=>Array.from(d.querySelectorAll('[aria-label="임시저장된 글"] > li')));if(!list.length)return false;return {count:list.length,sameTitle:list.filter(e=>(e.querySelector('strong')?.textContent||'').trim()===${JSON.stringify(context.title)}).length,savedTimes:list.map(e=>(e.textContent||'').match(/\\d{4}[.\\/-]\\s?\\d{1,2}[.\\/-]\\s?\\d{1,2}\\.?\\s+\\d{1,2}:\\d{2}(?::\\d{2})?/)?.[0]||'')};`), 10000);
    }
    await writeFile(file + '.result', JSON.stringify(result), { mode: 0o600 });
  } finally { await host.destroy(surface); }
}
