import { readFile, unlink } from 'node:fs/promises';
import type { ApiClient, Post } from '../../../packages/api-client/src/index';
import type { SurfaceHost } from '../../../packages/surface/src/index';
import { trace, traceJob } from '../../../packages/surface/src/telemetry';
import type { JobLogStore } from '../../../packages/core/src/job-logs';
import { makePreview } from '../../../packages/core/src/preparation';
import { bandPostIdentity, bandText, compact, readRecordedBandPost } from '../../../packages/sites/src/index';

export interface UncertainBandCleanupContext { postNo: number; productNo: number; startedAt: string; contentHash: string; url: string }
/** Debug receipt repair for deletion only. Never marks publication verified, submits, or deletes. */
export async function linkUncertainBandForDeletion(context: UncertainBandCleanupContext, api: ApiClient, token: string, host: SurfaceHost, logs: JobLogStore, ready: () => Promise<void>) {
  return traceJob('band_post', 'band', async () => {
    trace('verification', 'retry', { reason: 'READ_ONLY_RECHECK' });
    const refuse = () => { throw Error('BAND_CLEANUP_RECEIPT_REFUSED'); };
    const id = bandPostIdentity(context.url), proof = logs.creationProof(String(context.postNo));
    if (!id || !proof || !Number.isSafeInteger(context.postNo) || !Number.isSafeInteger(context.productNo)) refuse();
    const matching = (items: Post[]) => items.filter(post => post.postNo === context.postNo && post.productNo === context.productNo && post.startedAt === context.startedAt &&
      post.channel === 'band' && post.mode === 'publish' && post.status === 'failed' && post.failReason === 'BAND_POST_UNCONFIRMED' && (!post.postUrl || post.postUrl === id!.url) && !post.productChanged);
    const before = matching((await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token)).items);
    if (before.length !== 1) refuse();
    const record = before[0]!;
    const product = await api.request('/auto/products/get', { productNo: context.productNo }, token);
    const me = await api.request('/auto/me', {}, token);
    if (product.contentHash !== context.contentHash || product.title !== record.productTitle) refuse();
    const preview = makePreview(product, { closing: false, linkCard: false, hashtags: me.settings.defaultHashtags });
    if (!preview.verification.band.matches) refuse();
    await ready();
    const actual = await readRecordedBandPost(host, { url: id!.url, title: product.title });
    if (!actual?.owned || actual.url !== id!.url || compact(actual.body) !== compact(bandText(preview.band)) ||
      !Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.finishedAt)) ||
      actual.createdAt < Date.parse(record.startedAt) || actual.createdAt > Date.parse(record.finishedAt) ||
      Math.abs(actual.createdAt - proof!.acknowledgedAt) > 5000) refuse();
    trace('verification', 'ok', { check: 'identity', counts: { expected: 1, observed: 1 } });
    logs.associate(String(record.postNo)); await ready();
    if (matching((await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token)).items).length !== 1) refuse();
    if (!record.postUrl) await api.request('/auto/posts/update', { postNo: record.postNo, status: 'failed', step: record.step, failReason: 'BAND_POST_UNCONFIRMED', postUrl: id!.url }, token);
    const after = matching((await api.request('/auto/posts/list', { scope: 'mine', page: 1, pageSize: 100 }, token)).items);
    if (after.length !== 1 || after[0]!.postUrl !== id!.url) refuse();
    trace('runner.record', 'ok', { reason: 'RECORD_SAVED' });
    trace('sites.band.plan.BandExecution.detectPublished', 'fail', { reason: 'BAND_POST_UNCONFIRMED' });
    return { identityVerified: true, recorded: true, publicationVerified: false, cleanupAvailable: true };
  }, () => ({ result: 'uncertain', reason: 'BAND_POST_UNCONFIRMED' }));
}
export async function recoverUncertainBandForDeletion(file: string, api: ApiClient, token: string, host: SurfaceHost, logs: JobLogStore, ready: () => Promise<void>) {
  const context = JSON.parse(await readFile(file, 'utf8')) as UncertainBandCleanupContext;
  const result = await linkUncertainBandForDeletion(context, api, token, host, logs, ready);
  await unlink(file); return result;
}
