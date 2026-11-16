import { readFile, writeFile } from 'node:fs/promises';
import type { ApiClient, Post } from '../../../packages/api-client/src/index';
import type { SurfaceHost } from '../../../packages/surface/src/index';
import { makePreview } from '../../../packages/core/src/preparation';
import { bandText, compact, bandPostIdentity, bandPhotoPath, readRecordedBandPost } from '../../../packages/sites/src/index';

export interface BandPublishRecovery {
  postNo: number; productNo: number; startedAt: string; title: string; url: string;
  contentHash: string; submittedAt: number; uploadedPhotos: string[];
}
/** Debug-only receipt recovery. It cannot compose, submit, edit or delete a Band post. */
export async function verifyInterruptedBandPublish(context: BandPublishRecovery, api: ApiClient, token: string, host: SurfaceHost, ready: () => Promise<void>) {
  const refuse = () => { throw Error('BAND_PUBLISH_RECOVERY_REFUSED'); };
  const id = bandPostIdentity(context.url);
  if (!id || !context.title?.trim() || !context.contentHash || !Number.isFinite(context.submittedAt) ||
    !Array.isArray(context.uploadedPhotos) || !context.uploadedPhotos.length || context.uploadedPhotos.some(x => typeof x !== 'string' || !bandPhotoPath(x))) refuse();
  const matching = (items: Post[]) => items.filter(p => p.postNo === context.postNo && p.productNo === context.productNo &&
    p.startedAt === context.startedAt && p.productTitle === context.title && p.channel === 'band' && p.mode === 'publish' &&
    !p.productChanged && p.status === 'failed' && p.failReason === 'BAND_POST_UNCONFIRMED' && !p.postUrl);
  const before = matching((await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token)).items);
  if (before.length !== 1) refuse();
  const product = await api.request('/auto/products/get', { productNo: context.productNo }, token);
  const me = await api.request('/auto/me', {}, token);
  if (product.title !== context.title || product.contentHash !== context.contentHash) refuse();
  const preview = makePreview(product, { closing: false, linkCard: false, hashtags: me.settings.defaultHashtags });
  const plannedPhotos = preview.band.steps.flatMap(s => s.kind === 'photos' ? s.urls : []);
  if (!preview.verification.band.matches || plannedPhotos.length !== context.uploadedPhotos.length) refuse();
  await ready();
  const actual = await readRecordedBandPost(host, { url: id!.url, title: context.title });
  if (!actual?.owned || actual.url !== id!.url || Math.abs(actual.createdAt - context.submittedAt) > 5000 ||
    compact(actual.body) !== compact(bandText(preview.band)) || !actual.photos.length ||
    actual.photos.length > context.uploadedPhotos.length || actual.photos.some((p, i) => p.path !== bandPhotoPath(context.uploadedPhotos[i]!))) refuse();
  await ready();
  if (matching((await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token)).items).length !== 1) refuse();
  // The feed serializes a photo prefix. Its count is not the full-detail count.
  const partial = actual!.photos.length < plannedPhotos.length;
  const failReason = partial ? 'BAND_PUBLISHED_FEED_PHOTOS_PARTIAL' : '';
  await api.request('/auto/posts/update', { postNo: context.postNo, status: 'published', step: 7, failReason, postUrl: id!.url }, token);
  const after = (await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token)).items;
  if (after.filter(p => p.postNo === context.postNo && p.productNo === context.productNo && p.startedAt === context.startedAt &&
    p.channel === 'band' && p.status === 'published' && p.postUrl === id!.url && p.failReason === failReason).length !== 1) throw Error('BAND_PUBLISH_RECOVERY_RECORD_UNCONFIRMED');
  return { verified: true, recorded: true, feedPhotos: actual!.photos.length, plannedPhotos: plannedPhotos.length, feedPhotosPartial: partial };
}
export async function recoverBandPublish(file: string, api: ApiClient, token: string, host: SurfaceHost, ready: () => Promise<void>) {
  const context = JSON.parse(await readFile(file, 'utf8')) as BandPublishRecovery;
  const result = await verifyInterruptedBandPublish(context, api, token, host, ready);
  await writeFile(file + '.result', JSON.stringify(result), { mode: 0o600 });
  await writeFile(file, '{}', { mode: 0o600 });
}
