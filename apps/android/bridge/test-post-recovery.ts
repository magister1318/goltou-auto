/** Debug-only continuation of the interrupted WP14 cleanup, never a publish path. */
import { readFile, writeFile } from 'node:fs/promises';
import type { ApiClient } from '../../../packages/api-client/src';
import type { Surface, SurfaceHost } from '../../../packages/surface/src';
import { makePreview } from '../../../packages/core/src/preparation';
import { blogObservation } from '../../../packages/core/src/blog';
import { compareDocuments, observePlan } from '../../../packages/core/src/verify';
import { deleteTestPost, identifyTestPost, testPostPageSource, testPostFocusSource, type TestPostPage } from '../../../packages/core/src/test-post-delete';
import { BlogExecution, openPostDeletionRead, verifyPostAbsentFromList, read, readBlogDocument, waitFor, sleep } from '../../../packages/sites/src';

export async function recoverTestPostCleanup(file: string, api: ApiClient, token: string, host: SurfaceHost, ready: () => Promise<void>, checkOnly = false) {
  const context = JSON.parse(await readFile(file, 'utf8')) as { postNo: number; productNo: number; startedAt: string; title: string; url: string; contentHash: string; files: { url: string; path: string }[] };
  const refuse = () => { throw new Error('BLOG_TEST_DELETE_REFUSED'); };
  if (!context.title?.startsWith('[골투오토 실험] WP14 private-once ') || context.files?.length !== 13) refuse();
  const records = await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token);
  const matches = records.items.filter(r => r.postNo === context.postNo && r.productNo === context.productNo && r.startedAt === context.startedAt && r.channel === 'blog' && r.mode === 'publish' && (r.status === 'failed' && r.failReason === 'BLOG_PUBLISH_RESPONSE_UNCONFIRMED' || r.status === 'stopped' && r.failReason === 'BLOG_TEST_POST_DELETED'));
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
  const missing = await openPostDeletionRead(surface, context.url);
  if (missing) {
    await verifyPostAbsentFromList(surface, context.url, context.title);
    await writeFile(file + '.result', JSON.stringify({ deleted: true, verifiedGone: true, recorded: false, cleanup: [{ stage: 'verified-gone', diagnostic: { item: 17, pass: 1 } }] }), { mode: 0o600 });
    await api.request('/auto/posts/update', { postNo: context.postNo, status: 'stopped', step: matches[0]!.step, failReason: 'BLOG_TEST_POST_DELETED', postUrl: '' }, token);
    const after = await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 50 }, token);
    const saved = after.items.filter(r => r.postNo === context.postNo && r.productNo === context.productNo && r.startedAt === context.startedAt);
    if (saved.length !== 1 || saved[0]!.status !== 'stopped' || saved[0]!.failReason !== 'BLOG_TEST_POST_DELETED' || saved[0]!.postUrl) throw new Error('BLOG_TEST_DELETE_RECORD_UNCONFIRMED');
    await writeFile(file + '.result', JSON.stringify({ deleted: true, verifiedGone: true, recorded: true, cleanup: [{ stage: 'verified-gone', diagnostic: { item: 17, pass: 1 } }] }), { mode: 0o600 });
    await writeFile(file, '{}', { mode: 0o600 });
    return;
  }
  if (checkOnly) throw new Error('BLOG_TEST_POST_STILL_PRESENT');
  await surface.show();
  await waitFor(async () => (await read<TestPostPage[]>(surface, testPostPageSource)).some(p => p.titles.length) || false, 15000);
  const identity = identifyTestPost(await read<TestPostPage[]>(surface, testPostPageSource), context.title);
  const actual = await waitFor(async () => {
    const value = await readBlogDocument(surface);
    if (value.tokens.filter(t => t.kind === 'photo' && t.identity).length === 13) return value;
    const center = await read<{ x: number; y: number }>(surface, 'return {x:innerWidth/2,y:innerHeight/2};');
    if (!await read<boolean>(surface, testPostFocusSource) || !await surface.readClickTarget?.(center.x, center.y, 'body')) refuse();
    await surface.pressKey({ key: 'PageDown' }); await sleep(150);
    return false;
  }, 30000);
  const comparison = compareDocuments(observePlan(preview.blog), blogObservation(preview.blog, context.files, actual));
  type CleanupStep = Parameters<NonNullable<Parameters<typeof deleteTestPost>[1]>>[0];
  const evidence = {
    comparison: { matches: comparison.matches, fields: comparison.differences.map(d => d.field), photos: comparison.counts.photos },
    urlPattern: '/N/N', deleted: false, verifiedGone: false, recorded: false, cleanup: [] as CleanupStep[],
  };
  await writeFile(file + '.result', JSON.stringify(evidence), { mode: 0o600 });
  const execution = new BlogExecution(preview.blog, context.files, { host, beforeSave() { refuse(); }, check() {}, progress() {}, verify() { refuse(); } });
  execution.surface = surface;
  if (identity.url !== context.url) refuse();
  // Keep identity for a read-only diagnosis after an uncertain click. Only a
  // verified completion consumes it. Count at most three real attempts.
  const attemptFile = file + '.attempts';
  let attempts = 0;
  try { attempts = Number(await readFile(attemptFile, 'utf8')); } catch { /* first attempt */ }
  if (!Number.isInteger(attempts) || attempts < 0 || attempts >= 3) throw new Error('BLOG_TEST_DELETE_ATTEMPT_LIMIT');
  await deleteTestPost(execution, async value => { if (value.diagnostic?.item === 15) { attempts++; await writeFile(attemptFile, String(attempts), { mode: 0o600 }); } evidence.cleanup.push(value); await writeFile(file + '.result', JSON.stringify(evidence), { mode: 0o600 }); });
  evidence.deleted = true;
  evidence.verifiedGone = true;
  await writeFile(file + '.result', JSON.stringify(evidence), { mode: 0o600 });
  await api.request('/auto/posts/update', { postNo: context.postNo, status: 'stopped', step: matches[0]!.step, failReason: 'BLOG_TEST_POST_DELETED', postUrl: '' }, token);
  const after = await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token);
  const saved = after.items.filter(r => r.postNo === context.postNo && r.productNo === context.productNo && r.startedAt === context.startedAt);
  if (saved.length !== 1 || saved[0]!.status !== 'stopped' || saved[0]!.failReason !== 'BLOG_TEST_POST_DELETED' || saved[0]!.postUrl) throw new Error('BLOG_TEST_DELETE_RECORD_UNCONFIRMED');
  await writeFile(file, '{}', { mode: 0o600 });
  evidence.recorded = true;
  await writeFile(file + '.result', JSON.stringify(evidence), { mode: 0o600 });
}
export function protectCleanupInputs(surface: Surface, ready: () => Promise<void>) {
  const click = surface.click.bind(surface), pressKey = surface.pressKey.bind(surface), answer = surface.respondDialog?.bind(surface);
  surface.click = async (x, y, before) => { await ready(); await click(x, y, async () => { await ready(); await before?.(); }); };
  surface.pressKey = async key => { await ready(); await pressKey(key); };
  if (answer) surface.respondDialog = async (id, accept) => { await ready(); await answer(id, accept); };
}
