import type { SurfaceHost, GuardedRequest } from '@goltou/surface';
import { compact, waitFor } from '../dom';
import { bandMobileUA } from './plan';
import { bandPostIdentity } from './delete';

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
export function parseRecordedBandFeed(body: string, target: { url: string; title: string }): RecordedBandReadback | null {
  const id = bandPostIdentity(target.url);
  if (!id) throw Error('BAND_RECORD_READ_IDENTITY');
  const value = JSON.parse(body);
  if (value.result_code !== 1 || !Array.isArray(value.result_data?.items)) throw Error('BAND_RECORD_READ_RESPONSE');
  const matches = value.result_data.items.map((x: { post?: unknown }) => x.post).filter((p: { post_no?: unknown } | undefined) => p && String(p.post_no) === id.post);
  if (!matches.length) return null;
  if (matches.length !== 1) throw Error('BAND_RECORD_READ_AMBIGUOUS');
  const p = matches[0];
  if (String(p.band?.band_no) !== id.band || bandPostIdentity(p.web_url)?.url !== id.url ||
    typeof p.content !== 'string' || !Number.isFinite(p.created_at) || !Array.isArray(p.attachment?.photo) ||
    !Number.isInteger(p.photo_count) || p.photo_count !== p.attachment.photo.length) throw Error('BAND_RECORD_READ_IDENTITY');
  const text = bandStoredText(p.content);
  if (compact(text.split('\n')[0] ?? '') !== compact(target.title)) throw Error('BAND_RECORD_READ_TITLE');
  const photos = p.attachment.photo.map((photo: { photo_url: string; width: number; height: number }) => {
    const path = typeof photo.photo_url === 'string' ? bandPhotoPath(photo.photo_url) : '';
    if (!path || !(photo.width > 0 && photo.height > 0)) throw Error('BAND_RECORD_READ_PHOTO');
    return { path, width: photo.width, height: photo.height };
  });
  return { url: id.url, body: text, createdAt: p.created_at, owned: p.author?.me === true, photos };
}
export async function openRecordedBandFeed(host: SurfaceHost, target: { url: string; title: string },
  inspectWrite: (request: GuardedRequest) => boolean = () => false,
  onWrite: (status: number, body: string) => void = () => {}) {
  const id = bandPostIdentity(target.url);
  if (!id || !target.title.trim()) throw Error('BAND_RECORD_READ_IDENTITY');
  const s = await host.create('band');
  let revision = 0, actual: RecordedBandReadback | null = null, failure = false, reading = false;
  try {
    if (!s.guardRequests) throw Error('BAND_RECORD_READ_BARRIER');
    await s.guardRequests([{ hostname: '*', pathname: '/', prefix: true }], r => {
      const u = new URL(r.url);
      // Keep the owned initial card stable while keyboard focus crosses the
      // feed. Scrolling must not append an unbounded set of older posts.
      if (bandFeedResponse(r) && !reading) return false;
      if (['GET', 'HEAD', 'OPTIONS'].includes(r.method)) return bandRecordReadAllowed(r);
      return u.protocol === 'https:' && inspectWrite(r);
    }, r => {
      if (bandFeedResponse(r as { method: string; url: string })) {
        if (!reading) return;
        try { actual = parseRecordedBandFeed(r.body, target); reading = false; revision++; } catch { failure = true; }
      } else if (r.method === 'POST') onWrite(r.status, r.body);
    }, r => bandFeedResponse(r) || r.method === 'POST');
    const refresh = async () => {
      const before = revision;
      reading = true;
      await s.open({ url: `https://band.us/band/${id.band}/post`, session: 'band', width: 1280, height: 900, userAgent: bandMobileUA });
      await waitFor(async () => { if (failure) throw Error('BAND_RECORD_READ_RESPONSE'); return revision > before; }, 20000);
      return actual;
    };
    await refresh();
    return { surface: s, current: () => actual, refresh, close: () => host.destroy(s) };
  } catch (e) { await host.destroy(s).catch(() => {}); throw e; }
}
export async function readRecordedBandPost(host: SurfaceHost, target: { url: string; title: string }) {
  const session = await openRecordedBandFeed(host, target);
  try { return session.current(); } finally { await session.close(); }
}
