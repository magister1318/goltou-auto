/** Debug-only identity adapter over the regular blog deletion engine. */
import { postIdentity, read, deleteBlogPost, deletePageSource, deleteFocusSource, deleteSelector, requireDeleteConfirmation, verifyPostAbsentFromList, type BlogExecution, type PublishedPost, type DeleteDiagnostic, type DeletePage } from '@goltou/sites';
import type { SurfaceDialog } from '@goltou/surface';
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

export const testPostPageSource = deletePageSource;
export const testPostFocusSource = deleteFocusSource;
export const testPostDeleteSelector = deleteSelector;
export function requireTestDeleteConfirmation(dialog: SurfaceDialog | null | undefined, receipt: PublishedPost) {
  try { requireDeleteConfirmation(dialog, receipt); } catch { throw new Error('BLOG_TEST_DELETE_CONFIRM_UNCONFIRMED'); }
}
export function testDeleteExtra(p: DeletePage): DeleteDiagnostic[] {
  return [
    { item: 10, pass: Number(p.titles[0]?.startsWith('[골투오토 실험]')) },
    { item: 11, pass: Number(p.titles[0]?.includes('WP14 private-once')) },
    { item: 12, pass: Number(p.privateLabels === 1 && p.publicLabels === 0), actual: p.privateLabels, expected: 1 },
    { item: 13, pass: Number(p.photos === 13), actual: p.photos, expected: 13 },
  ];
}
export async function deleteTestPost(execution: BlogExecution, record: (value: { matches: boolean; fields: string[]; photos: number; stage: string; diagnostic?: DeleteDiagnostic }) => Promise<void> = async () => {}) {
  if (attempted.has(execution)) throw new Error('BLOG_TEST_DELETE_ALREADY_ATTEMPTED');
  const surface = execution.surface;
  const title = execution.plan.steps.find(s => s.kind === 'text' && s.role === 'title');
  if (!surface || title?.kind !== 'text') throw new Error('BLOG_TEST_DELETE_REFUSED');
  const receipt = identifyTestPost(await read<TestPostPage[]>(surface, testPostPageSource), title.text);
  if (execution.publishedPost && execution.publishedPost.url !== receipt.url) throw new Error('BLOG_TEST_DELETE_REFUSED');
  attempted.add(execution);
  await record({ matches: true, fields: [], photos: 13, stage: 'identified' });
  await deleteBlogPost(surface, { url: receipt.url, title: title.text, extraIdentity: testDeleteExtra }, async diagnostic => {
    await record({ matches: diagnostic.pass === 1, fields: [], photos: 13, stage: 'diagnostic', diagnostic });
  });
  await record({ matches: true, fields: [], photos: 13, stage: 'verified-gone' });
}
export async function verifyTestPostAbsentFromList(surface: NonNullable<BlogExecution['surface']>, url: string, title: string) {
  try { await verifyPostAbsentFromList(surface, url, title); } catch { throw new Error('BLOG_TEST_DELETE_LIST_UNCONFIRMED'); }
}
const attempted = new WeakSet<BlogExecution>();
