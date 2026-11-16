import type { Surface } from '@goltou/surface';
import { trace, traceStep } from '@goltou/surface/telemetry';
import { read } from '../dom';

export interface CreatedBandPost { url: string; body: string; createdAt: number; owned: boolean; photoCount: number; }
const storedText = (value: string) => value.replace(/<\/?band:hashtag>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]!);
/** Ephemeral evidence from the app's already-open posting WebView, never persisted. */
export function createdBandPosts(body: string, band: string): CreatedBandPost[] {
  const value = JSON.parse(body);
  if (value.result_code !== 1 || !Array.isArray(value.result_data?.items)) throw Error('BAND_RECORD_READ_RESPONSE');
  return value.result_data.items.flatMap((item: { post?: Record<string, unknown> }) => {
    const p = item.post;
    if (!p || typeof p.content !== 'string' || !Number.isFinite(p.created_at) || !Number.isInteger(p.photo_count)) return [];
    const u = typeof p.web_url === 'string' ? new URL(p.web_url) : undefined;
    if (!u || !['band.us', 'www.band.us'].includes(u.hostname) || u.protocol !== 'https:' || u.search || u.hash || u.pathname !== `/band/${band}/post/${p.post_no}`) return [];
    const author = p.author as { me?: unknown } | undefined, parent = p.band as { band_no?: unknown } | undefined;
    if (String(parent?.band_no) !== band) return [];
    return [{ url: `https://band.us${u.pathname}`, body: storedText(p.content), createdAt: p.created_at as number, owned: author?.me === true, photoCount: p.photo_count as number }];
  });
}
export interface FullBandPost { body: string; photos: string[]; lineBreaks: number; hashtags: number; links: number; }
/** innerText omits trailing spaces on each rendered line; preserve every line and all wording. */
export function normalizedBandBody(body: string) { return body.replace(/\r\n?/g, '\n').replace(/[\u200b-\u200d\ufeff]/g, '').split('\n').map(line => line.trimEnd()).join('\n').trimEnd(); }
export function photoPath(value: string) {
  try { return new URL(value.startsWith('//') ? `https:${value}` : value).pathname; } catch { return ''; }
}
export async function readFullBandPost(surface: Surface): Promise<FullBandPost | null> {
  return traceStep('sites.band.posted.readFullBandPost', async () => read(surface, `
    const roots=docs.flatMap(({d})=>Array.from(d.querySelectorAll('.postsDetailArea ._contentListRegion'))).filter(visible);
    if(roots.length!==1)return null;const root=roots[0];
    const texts=Array.from(root.querySelectorAll('p.txtBody,p.postText,.postTextView')).filter(visible);if(texts.length!==1)return null;
    const text=texts[0],body=text.innerText.replace(/\\r\\n?/g,'\\n').replace(/[\\u200b-\\u200d\\ufeff]/g,'').trimEnd();
    const images=Array.from(root.querySelectorAll('img')).filter(img=>img.closest('._photoRegion,._photoListRegion,.photo,.postPhoto,.photoView,.photoRegion')||img.classList.contains('mediaImg'));
    const all=images.length?images:Array.from(root.querySelectorAll('img')).filter(img=>!img.closest('.postWriterInfo,.postAuthor,.comment,.profile'));
    return {body,photos:all.map(img=>img.currentSrc||img.src||''),lineBreaks:(body.match(/\\n/g)||[]).length,hashtags:text.querySelectorAll('button.hashTag,a.hashTag').length,links:text.querySelectorAll('a[href^="http"]').length};
  `));
}
export function verifyFullBandPost(expected: string, uploaded: readonly string[], actual: FullBandPost) {
  const planned = normalizedBandBody(expected);
  const checks = [
    ['text', planned === normalizedBandBody(actual.body), Array.from(planned).length, Array.from(normalizedBandBody(actual.body)).length],
    ['line_breaks', (planned.match(/\n/g) ?? []).length === actual.lineBreaks, (planned.match(/\n/g) ?? []).length, actual.lineBreaks],
    ['photo_order', actual.photos.length === uploaded.length && actual.photos.every((url, i) => photoPath(url) === photoPath(uploaded[i] ?? '')), uploaded.length, actual.photos.length],
    ['hashtags', (planned.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length === actual.hashtags, (planned.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length, actual.hashtags],
    ['links', (planned.match(/https?:\/\/[^\s<>]+/g) ?? []).length === actual.links, (planned.match(/https?:\/\/[^\s<>]+/g) ?? []).length, actual.links],
  ] as const;
  for (const [check, matches, expectedCount, observedCount] of checks) trace('verification', matches ? 'ok' : 'fail', { check, counts: { expected: expectedCount, observed: observedCount }, ...(matches ? {} : { reason: 'VERIFICATION_MISMATCH' }) });
  if (checks.some(([, matches]) => !matches)) throw Error('BAND_PUBLISHED_READBACK_MISMATCH');
}
