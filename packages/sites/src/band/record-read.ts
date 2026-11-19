import { traceStep, trace, reasonCode } from '@goltou/surface/telemetry';
import type { SurfaceHost, GuardedRequest } from '@goltou/surface';
import { compact, read, sleep, waitFor } from '../dom';
import { bandMobileUA } from './plan';
import { bandPostIdentity } from './delete';
import type { BandDeleteCode, BandDeleteLog } from './delete-log';
import { bandReadBatchTarget } from './read-batch';
import { bandCreationMismatch, type BandCreationMatch } from './publish-confirmation';
import { bandAppPromptFailure, dismissBandAppPrompt } from './app-prompt';
import { bandPhotoEvidence, type BandPhotoEvidence } from './photo-path';
import { readApiPhotos, tracePhotoSource, type ApiPhotoRead, type PhotoReadFailure } from './photo-read';
export { bandPhotoPath } from './photo-path';

export const bandFeedResponse = (r: Pick<GuardedRequest, 'method' | 'url'>) => {
  const u = new URL(r.url);
  return r.method === 'GET' && u.origin === 'https://api-kr.band.us' && u.pathname === '/v2.0.0/get_posts_and_announcements';
};
export function bandRecordReadAllowed(r: Pick<GuardedRequest, 'method' | 'url'>) {
  const u = new URL(r.url);
  if (u.protocol !== 'https:') return false;
  // Existing authenticated mobile pages bootstrap through this read API. It is
  // not a login document; no response body is observed or retained here.
  if (u.hostname === 'auth.band.us') return r.method === 'GET' && u.pathname === '/s/login/getKey';
  if (/^login[.]/.test(u.hostname) || /^\/(?:login|account)(?:\/|$)/.test(u.pathname)) return false;
  if (r.method !== 'OPTIONS' && /^\/v[\d.]+\/(?:create|update|delete|remove|write|publish|submit)_/.test(u.pathname)) return false;
  return ['GET', 'HEAD', 'OPTIONS'].includes(r.method);
}
export function bandStoredText(value: string) {
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  return value.replace(/<\/?band:hashtag>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, entity => entities[entity]!);
}
/** Read only successful post results from the detail page's guarded batch. */
export function parseBandDetailPhotos(body: string, url: string): BandPhotoEvidence[] | undefined {
  const result = inspectBandDetailPhotos(body, url);
  return 'photos' in result ? result.photos : undefined;
}
export function inspectBandDetailPhotos(body: string, url: string): ApiPhotoRead {
  const id = bandPostIdentity(url);
  if (!id) return { reason: 'BAND_RECORD_READ_IDENTITY', counts: { expected: 1, observed: 0 } };
  const matches: ApiPhotoRead[] = [];
  let success = false;
  const visit = (value: unknown, depth: number, successful = false) => {
    if (!value || typeof value !== 'object' || depth === 0) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth - 1);
      return;
    }
    const entry = value as Record<string, unknown>;
    if (entry.result_code !== undefined) {
      if (entry.result_code === 1) { success = true; visit(entry.result_data, depth - 1, true); }
      return;
    }
    if (successful) {
      const post = (entry.post ?? entry) as Record<string, unknown>;
      if (String(post.post_no) === id.post && String((post.band as { band_no?: unknown } | undefined)?.band_no ?? post.band_no) === id.band &&
        (post.web_url === undefined || typeof post.web_url === 'string' && bandPostIdentity(post.web_url)?.url === id.url)) {
        matches.push(readApiPhotos(post));
        return;
      }
    }
    for (const key of ['responses', 'results', 'items', 'response', 'body']) visit(entry[key], depth - 1);
  };
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object') return { reason: 'PHOTO_PARSE_FAILED' };
    visit(value, 8);
  } catch { return { reason: 'PHOTO_PARSE_FAILED' }; }
  return matches.length === 1 ? matches[0]!
    : { reason: !success ? 'PHOTO_RESPONSE_REJECTED' : matches.length ? 'BAND_POST_IDENTITY_AMBIGUOUS' : 'IDENTITY_NOT_FOUND',
      counts: { expected: 1, observed: matches.length } };
}
export interface RecordedBandReadback {
  url: string; body: string; createdAt: number; owned: boolean;
  photos: (BandPhotoEvidence & { width: number; height: number })[];
}
/** Parse only the exact recorded post. No account fields or authentication data escape. */
export function parseRecordedBandFeed(body: string, target: { url: string; title?: string }): RecordedBandReadback | null {
  const id = bandPostIdentity(target.url);
  if (!id) throw Error('BAND_RECORD_READ_IDENTITY');
  const value = JSON.parse(body);
  if (value.result_code !== 1 || !Array.isArray(value.result_data?.items)) throw Error('BAND_RECORD_READ_RESPONSE');
  const matches = value.result_data.items.map((x: { post?: unknown }) => x.post).filter((p: { post_no?: unknown } | undefined) => p && String(p.post_no) === id.post);
  if (!matches.length) return null;
  if (matches.length !== 1) throw Error('BAND_RECORD_READ_AMBIGUOUS');
  const p = matches[0];
  if (String(p.band?.band_no) !== id.band || bandPostIdentity(p.web_url)?.url !== id.url ||
    !Number.isFinite(p.created_at) || target.title && (typeof p.content !== 'string' || !Array.isArray(p.attachment?.photo) ||
    !Number.isInteger(p.photo_count) || p.photo_count !== p.attachment.photo.length)) throw Error('BAND_RECORD_READ_IDENTITY');
  const text = typeof p.content === 'string' ? bandStoredText(p.content) : '';
  if (target.title && compact(text.split('\n')[0] ?? '') !== compact(target.title)) throw Error('BAND_RECORD_READ_TITLE');
  const photos = (!target.title ? [] : p.attachment.photo).map((photo: { photo_url: string; width: number; height: number }) => {
    const evidence = typeof photo.photo_url === 'string' ? bandPhotoEvidence(photo.photo_url) : undefined;
    if (!evidence || !(photo.width > 0 && photo.height > 0)) throw Error('BAND_RECORD_READ_PHOTO');
    return { ...evidence, width: photo.width, height: photo.height };
  });
  return { url: id.url, body: text, createdAt: p.created_at, owned: p.author?.me === true, photos };
}
type FeedTarget = { url: string; title?: string } | BandCreationMatch;
export async function openRecordedBandFeed(host: SurfaceHost, target: FeedTarget,
  inspectWrite: (request: GuardedRequest) => boolean = () => false,
  onWrite: (status: number, body: string) => void = () => {}, log: BandDeleteLog = () => {}, readTimeoutMs = 20000) {
    return traceStep('sites.band.record-read.openRecordedBandFeed', async () => {
  const id = 'url' in target ? bandPostIdentity(target.url) : /^\d{1,30}$/.test(target.band) ? { band: target.band, post: '', url: '' } : null;
  if (!id || !('url' in target) && !target.title.trim()) throw Error('BAND_RECORD_READ_IDENTITY');
  const s = await host.create('band');
  let revision = 0, actual: RecordedBandReadback | null = null, failure = '', reading = false, checkingUrl = false, missingRead = false, reviewingFeed = false;
  const recovery = 'url' in target ? undefined : { expected: target.uploaded.length, source: 'band.photo.recovery_feed' as const };
  let photoFailure: PhotoReadFailure | undefined;
  let photoAttempt = 0;
  try {
    if (!s.guardRequests) throw Error('BAND_RECORD_READ_BARRIER');
    await s.guardRequests([{ hostname: '*', pathname: '/', prefix: true }], r => {
      const u = new URL(r.url);
      // A mutation endpoint never passes through the generic GET read policy.
      if (u.pathname === '/v1.5.0/delete_post' && r.method !== 'OPTIONS') return inspectWrite(r);
      // Keep the owned initial card stable while keyboard focus crosses the
      // feed. Scrolling must not append an unbounded set of older posts.
      if (bandFeedResponse(r) && !reading && (!reviewingFeed || u.searchParams.get('band_no') !== id.band)) return false;
      if (['GET', 'HEAD', 'OPTIONS'].includes(r.method)) {
        if (checkingUrl && r.method === 'OPTIONS') log({ code: 'PREFLIGHT_ALLOWED' });
        if (recovery && reading && bandFeedResponse(r) && u.searchParams.get('band_no') === id.band) {
          photoFailure = { reason: 'PHOTO_RESPONSE_UNOBSERVED' };
        }
        return bandRecordReadAllowed(r);
      }
      if (checkingUrl) {
        const batch = bandReadBatchTarget(r);
        if (batch?.band === id.band && batch.post === id.post) { log({ code: 'READ_BATCH_ALLOWED' }); return true; }
        if (u.hostname === 'bapi-kr.band.us') log({ code: 'READ_BATCH_BLOCKED' });
      }
      return u.protocol === 'https:' && inspectWrite(r);
    }, r => {
      if (bandFeedResponse(r as { method: string; url: string })) {
        if (!reading) return;
        // Existing recorded-post recovery binds identity from the returned
        // post itself; only unknown-identity discovery requires the feed query.
        if (!('url' in target) && new URL(r.url!).searchParams.get('band_no') !== id.band) return;
        try {
          if ('url' in target) actual = parseRecordedBandFeed(r.body, target);
          else {
            const value = JSON.parse(r.body);
            if (value.result_code !== 1 || !Array.isArray(value.result_data?.items)) throw Error('BAND_RECORD_READ_RESPONSE');
            const candidates: RecordedBandReadback[] = [];
            const rejected = new Map<string, PhotoReadFailure>();
            const reject = (reason: PhotoReadFailure) => { if (!rejected.has(reason.reason)) rejected.set(reason.reason, reason); };
            for (const item of value.result_data.items) {
              const candidate = item?.post;
              if (candidate?.author?.me !== true) {
                reject({ reason: 'BAND_FEED_OWNER_MISMATCH', counts: { expected: 1, observed: 0 } });
                continue;
              }
              if (!Number.isFinite(candidate.created_at) || candidate.created_at < target.after || candidate.created_at > target.before) {
                reject({ reason: 'BAND_FEED_TIME_MISMATCH', counts: { expected: 1, observed: 0 } });
                continue;
              }
              const url = candidate.web_url;
              if (bandPostIdentity(url)?.band !== id.band || typeof candidate.content !== 'string') {
                reject({ reason: 'BAND_RECORD_READ_IDENTITY', counts: { expected: 1, observed: 0 } });
                continue;
              }
              const title = bandStoredText(item.post.content).split('\n')[0] ?? '';
              if (!compact(title)) {
                reject({ reason: 'READBACK_TITLE', counts: { expected: 1, observed: 0 } });
                continue;
              }
              const photos = readApiPhotos(candidate);
              // A zero-photo row still needs the existing creation-feed parser's attachment proof.
              if ('reason' in photos) photoFailure = photos;
              const post = parseRecordedBandFeed(JSON.stringify({ result_code: 1, result_data: { items: [item] } }), { url, title });
              if (post) {
                const mismatch = bandCreationMismatch(post, target);
                if (mismatch) reject(mismatch);
                else candidates.push(post);
              }
            }
            for (const detail of rejected.values()) trace('band.confirm.feed', 'wait', { check: 'identity', ...detail });
            photoFailure = candidates.length > 1
              ? { reason: 'BAND_POST_IDENTITY_AMBIGUOUS', counts: { expected: 1, observed: candidates.length } }
              : candidates.length === 0 ? { reason: 'IDENTITY_NOT_FOUND', counts: { expected: 1, observed: 0 } } : undefined;
            trace('band.confirm.feed', candidates.length === 1 ? 'ok' : candidates.length ? 'fail' : 'wait', {
              check: 'identity', ...(photoFailure ? { reason: photoFailure.reason } : {}), counts: { observed: candidates.length, expected: 1 },
            });
            if (candidates.length > 1) throw Error('BAND_POST_IDENTITY_AMBIGUOUS');
            actual = candidates[0] ?? null;
          }
          reading = false; revision++;
        } catch (error) {
          failure = error instanceof Error && error.message === 'BAND_POST_IDENTITY_AMBIGUOUS' ? error.message : 'BAND_RECORD_READ_RESPONSE';
          if (recovery && (!photoFailure || photoFailure.reason === 'PHOTO_RESPONSE_UNOBSERVED' || photoFailure.reason === 'PHOTO_REQUEST_UNOBSERVED')) {
            const reason = r.status < 200 || r.status >= 300 ? 'PHOTO_RESPONSE_REJECTED'
              : error instanceof Error && error.message === 'BAND_RECORD_READ_PHOTO' ? 'PHOTO_PATH_UNREADABLE' : 'PHOTO_PARSE_FAILED';
            photoFailure = { reason, counts: { status: r.status } };
          }
          trace('sites.band.record-read.openRecordedBandFeed', 'fail', { reason: reasonCode(failure) });
        }
      } else if (r.method === 'POST' && r.url && new URL(r.url).pathname === '/v1.5.0/delete_post') onWrite(r.status, r.body);
      else if (checkingUrl && r.method === 'POST' && r.url && new URL(r.url).pathname === '/v2.0.0/batch') {
        const codes: number[] = [];
        const visit = (value: unknown, depth = 0) => {
          if (!value || typeof value !== 'object' || depth > 8) return;
          for (const [key, item] of Object.entries(value)) {
            if (key === 'result_code' && typeof item === 'number') codes.push(item);
            else if (item && typeof item === 'object') visit(item, depth + 1);
          }
        };
        try { visit(JSON.parse(r.body)); } catch { trace('sites.band.record-read.openRecordedBandFeed', 'fail', { reason: 'CAUGHT_FAILURE' });  /* Fixed result only; never retain response text. */ }
        missingRead = codes[0] === 1 && codes.includes(1000);
        log({ code: 'URL_RESULT', resultCodes: codes });
      }
    }, r => bandFeedResponse(r) || r.method === 'POST' && ['/v1.5.0/delete_post', ...(checkingUrl ? ['/v2.0.0/batch'] : [])].includes(new URL(r.url).pathname), (request, reason) => {
      log({ code: 'SURFACE_BLOCKED' });
      if (recovery && reading && request && bandFeedResponse(request) && new URL(request.url).searchParams.get('band_no') === id.band) {
        photoFailure = { reason };
      }
    });
    const refresh = async () => {
      const before = revision;
      checkingUrl = false; reading = true;
      const url = `https://band.us/band/${id.band}/post`;
      if (recovery) {
        photoFailure = { reason: 'PHOTO_REQUEST_UNOBSERVED' };
        trace(recovery.source, 'start', { counts: { expected: recovery.expected, attempt: ++photoAttempt } });
      }
      try {
        await s.open({ url, session: 'band', width: 1280, height: 900, userAgent: bandMobileUA });
        await waitFor(async () => { if (failure) throw Error(failure); return revision > before; }, readTimeoutMs, { surface: s, control: "BAND_FEED" });
        await dismissBandAppPrompt(s, url);
        return actual;
      } finally {
        if (recovery) {
          const count = revision > before ? actual?.photos.length ?? 0 : 0;
          tracePhotoSource(recovery.source, recovery.expected, count,
            photoFailure ?? (count === recovery.expected ? undefined : { reason: 'PHOTO_COUNT_MISMATCH' }), photoAttempt);
        }
      }
    };
    const openDetail = async (mobile: boolean) => {
      checkingUrl = true;
      await s.open({ url:id.url, session:'band', width:1280, height:900, userAgent:mobile ? bandMobileUA :
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
      await dismissBandAppPrompt(s, id.url);
    };
    const verifyGone = async () => {
      checkingUrl = true;
      missingRead = false;
      let reason: BandDeleteCode = 'URL_OPEN_FAILED';
      let loggedDialog = false;
      try {
        log({ code: 'URL_OPEN' });
        await s.open({ url: id.url, session: 'band', width: 1280, height: 900, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
        await waitFor(async () => {
          // A held native alert pauses Runtime.evaluate. Read it before any DOM.
          const dialog = await s.readDialog?.();
          const absent = /(?:삭제(?:된|되었)|존재하지 않|찾을 수 없|not (?:found|exist))/i;
          if (dialog) {
            reason = 'URL_ALERT_OTHER';
            const u = new URL(dialog.url ?? 'https://invalid.invalid');
            const samePost = bandPostIdentity(dialog.url ?? '')?.url === id.url;
            const feed = u.protocol === 'https:' && ['band.us', 'www.band.us'].includes(u.hostname) && u.pathname.replace(/\/$/, '') === `/band/${id.band}/post` && !u.search && !u.hash;
            if (!loggedDialog) { loggedDialog = true; log({ code: 'URL_ALERT_READ', checks: { alert: dialog.kind === 'alert', missingMessage: absent.test(dialog.message), samePost, feed, missingRead, length: dialog.message.length } }); }
            const gone = dialog.kind === 'alert' && dialog.message.length < 300 && absent.test(dialog.message) && samePost && missingRead;
            if (gone && s.respondDialog) { await s.respondDialog(dialog.id, true); log({ code: 'URL_ALERT_ACKNOWLEDGED' }); }
            return gone;
          }
          let state;
          try { state = await s.readState(); }
          catch { trace('sites.band.record-read.openRecordedBandFeed', 'fail', { reason: 'CAUGHT_FAILURE' });  return false; } // An alert can arrive between the native read and Runtime.
          if (bandPostIdentity(state.url)?.url !== id.url || state.loading) { reason = 'URL_WRONG_ROUTE'; return false; }
          await dismissBandAppPrompt(s, id.url);
          const result = await read<{ post: boolean; notice: boolean }>(s, `return {post:docs.some(({d})=>!!d.querySelector('.postView,.postsDetailArea p.txtBody,article.cContentsCard p.txtBody,section.postCard p.postText')),notice:docs.some(({d})=>/(?:삭제된 게시글|게시글이 삭제되었|삭제되었거나 존재하지 않는 게시글|존재하지 않는 게시글|게시글이 존재하지 않|게시글을 찾을 수 없)/.test(d.body?.innerText||''))};`);
          reason = result.post ? 'URL_POST_PRESENT' : 'URL_NO_DELETE_NOTICE';
          if (result.post) throw Error('BAND_URL_POST_PRESENT');
          return !result.post && result.notice;
        }, 30000, { surface: s, control: "BAND_POST_ABSENT" });
        log({ code: 'URL_ABSENT' });
        return true;
      } catch (error) {
        if (error instanceof Error && error.message === bandAppPromptFailure) throw error;
        trace('sites.band.record-read.openRecordedBandFeed', 'fail', { reason: 'CAUGHT_FAILURE' }); log({ code: reason }); return false;
      }
      finally { checkingUrl = false; }
    };
    await refresh();
    return { surface: s, current: () => actual, refresh, openDetail, verifyGone, reviewFeed: () => { reviewingFeed = true; }, close: () => host.destroy(s) };
  } catch (e) { trace('sites.band.record-read.openRecordedBandFeed', 'fail', { reason: reasonCode(e) });  await host.destroy(s).catch(() => {}); throw e; }

    });
  }
export async function readRecordedBandPost(host: SurfaceHost, target: { url: string; title?: string }) {
    return traceStep('sites.band.record-read.readRecordedBandPost', async () => {
  const session = await openRecordedBandFeed(host, target);
  try { return session.current(); } finally { await session.close(); }

    });
  }

/** Same authenticated feed/parser as recorded-post recovery, with no mutation permission. */
export async function readCreatedBandPost(host: SurfaceHost, target: BandCreationMatch, timeoutMs: number, check: () => void) {
  trace('band.confirm.feed', 'start');
  const deadline = Date.now() + timeoutMs;
  check();
  const session = await openRecordedBandFeed(host, target, undefined, undefined, undefined, timeoutMs);
  try {
    while (!session.current() && Date.now() < deadline) {
      check(); trace('band.confirm.feed', 'retry');
      await sleep(Math.min(1000, Math.max(1, deadline - Date.now())));
      if (Date.now() < deadline) await session.refresh();
    }
    return session.current();
  } finally { await session.close(); }
}
