/** Debug-only continuation of the interrupted WP14 cleanup, never a publish path. */
import { readFile, writeFile } from 'node:fs/promises';
import type { ApiClient } from '../../../packages/api-client/src';
import type { Surface, SurfaceHost } from '../../../packages/surface/src';
import { makePreview } from '../../../packages/core/src/preparation';
import { blogObservation } from '../../../packages/core/src/blog';
import { compareDocuments, observePlan } from '../../../packages/core/src/verify';
import { deleteTestPost, identifyTestPost, testPostPageSource, testPostFocusSource, type TestPostPage } from '../../../packages/core/src/test-post-delete';
import { BlogExecution, read, readBlogDocument, waitFor, sleep } from '../../../packages/sites/src';

export async function recoverTestPostCleanup(file: string, api: ApiClient, token: string, host: SurfaceHost, ready: () => Promise<void>) {
  const context = JSON.parse(await readFile(file, 'utf8')) as { postNo: number; productNo: number; startedAt: string; title: string; url: string; contentHash: string; files: { url: string; path: string }[] };
  const refuse = () => { throw new Error('BLOG_TEST_DELETE_REFUSED'); };
  if (!context.title?.startsWith('[골투오토 실험] WP14 private-once ') || context.files?.length !== 13) refuse();
  const records = await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token);
  const matches = records.items.filter(r => r.postNo === context.postNo && r.productNo === context.productNo && r.startedAt === context.startedAt && r.channel === 'blog' && r.mode === 'publish' && r.status === 'failed' && r.failReason === 'BLOG_PUBLISH_RESPONSE_UNCONFIRMED');
  if (matches.length !== 1) refuse();
  const product = await api.request('/auto/products/get', { productNo: context.productNo }, token);
  const me = await api.request('/auto/me', {}, token);
  if (product.contentHash !== context.contentHash || context.title !== `[골투오토 실험] WP14 private-once ${product.title}`) refuse();
  const preview = makePreview({ ...product, title: context.title }, { closing: false, linkCard: false, hashtags: me.settings.defaultHashtags });
  if (!preview.verification.blog.matches || product.images.length !== 13 || JSON.stringify(observePlan(preview.blog).photos) !== JSON.stringify(context.files.map(f => f.url))) refuse();
  const surface = await host.create('naver');
  protectCleanupInputs(surface, ready);
  // A restored cleanup can never write or update any post, even accidentally.
  await surface.blockRequests!(['/RabbitWrite.naver', '/RabbitUpdate.naver'].map(pathname => ({ hostname: 'blog.naver.com', pathname })));
  await surface.open({ url: context.url, session: 'naver', width: 1280, height: 900, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
  await surface.show();
  await waitFor(async () => (await read<TestPostPage[]>(surface, testPostPageSource)).some(p => p.titles.length) || false, 15000);
  const identity = identifyTestPost(await read<TestPostPage[]>(surface, testPostPageSource), context.title);
  const actual = await waitFor(async () => {
    const value = await readBlogDocument(surface);
    if (value.tokens.filter(t => t.kind === 'photo' && t.identity).length === 13) return value;
    if (!await read<boolean>(surface, testPostFocusSource) || !await surface.readClickTarget?.(600, 450, 'body')) refuse();
    await surface.pressKey({ key: 'PageDown' }); await sleep(150);
    return false;
  }, 30000);
  const comparison = compareDocuments(observePlan(preview.blog), blogObservation(preview.blog, context.files, actual));
  const evidence = { comparison: { matches: comparison.matches, fields: comparison.differences.map(d => d.field), photos: comparison.counts.photos }, urlPattern: '/N/N', deleted: false, recorded: false };
  await writeFile(file + '.result', JSON.stringify(evidence), { mode: 0o600 });
  const execution = new BlogExecution(preview.blog, context.files, { host, beforeSave() { refuse(); }, check() {}, progress() {}, verify() { refuse(); } });
  execution.surface = surface;
  if (identity.url !== context.url) refuse();
  // Persist the one-shot latch before touching delete; a restart cannot retry it.
  await writeFile(file, '{}', { mode: 0o600 });
  await deleteTestPost(execution, async value => { await writeFile(file + '.result', JSON.stringify({ ...evidence, cleanup: value }), { mode: 0o600 }); });
  evidence.deleted = true;
  await writeFile(file + '.result', JSON.stringify(evidence), { mode: 0o600 });
  await api.request('/auto/posts/update', { postNo: context.postNo, status: 'stopped', step: matches[0]!.step, failReason: 'BLOG_TEST_POST_DELETED', postUrl: '' }, token);
  evidence.recorded = true;
  await writeFile(file + '.result', JSON.stringify(evidence), { mode: 0o600 });
}
export function protectCleanupInputs(surface: Surface, ready: () => Promise<void>) {
  const click = surface.click.bind(surface), pressKey = surface.pressKey.bind(surface), answer = surface.respondDialog?.bind(surface);
  surface.click = async (x, y, before) => { await ready(); await click(x, y, async () => { await ready(); await before?.(); }); };
  surface.pressKey = async key => { await ready(); await pressKey(key); };
  if (answer) surface.respondDialog = async (id, accept) => { await ready(); await answer(id, accept); };
}
