import { traceStep, trace, reasonCode } from '@goltou/surface/telemetry';
import type { SurfaceHost, GuardedRequest } from '@goltou/surface';
import { compact, read, sleep, waitFor } from '../dom';
import { bandMobileUA } from './plan';
import { bandPostIdentity } from './delete';
import type { BandDeleteCode, BandDeleteLog } from './delete-log';
import { bandReadBatchTarget } from './read-batch';
import { matchesBandCreation, type BandCreationMatch } from './publish-confirmation';
import { bandAppPromptFailure, dismissBandAppPrompt } from './app-prompt';

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
export function bandPhotoPath(value: string) {
  try { const u = new URL(value.startsWith('//') ? `https:${value}` : value); return ['http:', 'https:'].includes(u.protocol) ? u.pathname : ''; } catch { return ''; }
}
export interface RecordedBandReadback {
  url: string; body: string; createdAt: number; owned: boolean;
  photos: { path: string; width: number; height: number }[];
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
    const path = typeof photo.photo_url === 'string' ? bandPhotoPath(photo.photo_url) : '';
    if (!path || !(photo.width > 0 && photo.height > 0)) throw Error('BAND_RECORD_READ_PHOTO');
    return { path, width: photo.width, height: photo.height };
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
            for (const item of value.result_data.items) {
              const candidate = item?.post;
              if (candidate?.author?.me !== true || !Number.isFinite(candidate.created_at) ||
                candidate.created_at < target.after || candidate.created_at > target.before) continue;
              const url = candidate.web_url;
              if (bandPostIdentity(url)?.band !== id.band || typeof candidate.content !== 'string') continue;
              const title = bandStoredText(item.post.content).split('\n')[0] ?? '';
              if (!compact(title)) continue;
              const post = parseRecordedBandFeed(JSON.stringify({ result_code: 1, result_data: { items: [item] } }), { url, title });
              if (post && matchesBandCreation(post, target)) candidates.push(post);
            }
            trace('band.confirm.feed', candidates.length === 1 ? 'ok' : 'wait', { counts: { observed: candidates.length, expected: 1 } });
            if (candidates.length > 1) throw Error('BAND_POST_IDENTITY_AMBIGUOUS');
            actual = candidates[0] ?? null;
          }
          reading = false; revision++;
        } catch (error) { failure = error instanceof Error && error.message === 'BAND_POST_IDENTITY_AMBIGUOUS' ? error.message : 'BAND_RECORD_READ_RESPONSE'; trace('sites.band.record-read.openRecordedBandFeed', 'fail', { reason: reasonCode(failure) }); }
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
    }, r => bandFeedResponse(r) || r.method === 'POST' && ['/v1.5.0/delete_post', ...(checkingUrl ? ['/v2.0.0/batch'] : [])].includes(new URL(r.url).pathname), () => log({ code: 'SURFACE_BLOCKED' }));
    const refresh = async () => {
      const before = revision;
      checkingUrl = false; reading = true;
      const url = `https://band.us/band/${id.band}/post`;
      await s.open({ url, session: 'band', width: 1280, height: 900, userAgent: bandMobileUA });
      await waitFor(async () => { if (failure) throw Error(failure); return revision > before; }, readTimeoutMs, { surface: s, control: "BAND_FEED" });
      await dismissBandAppPrompt(s, url);
      return actual;
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
