import type { Surface } from '@goltou/surface';
import { trace, traceStep } from '@goltou/surface/telemetry';
import { read } from '../dom';
import { containsServiceLink, ReadbackMismatch, tokenText, type ReadbackIssue, type ServiceLink, type ServiceTextToken } from '../readback-checks';

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
export interface FullBandPost { body: string; photos: string[]; lineBreaks: number; hashtags: number; links: number; tagTexts: string[]; linkUrls: string[]; tagTokens: ServiceTextToken[]; linkTokens: ServiceLink[]; }
/** innerText omits trailing spaces on each rendered line; preserve every line and all wording. */
export function normalizedBandBody(body: string) { return body.replace(/\r\n?/g, '\n').replace(/[\u200b-\u200d\ufeff]/g, '').split('\n').map(line => line.trimEnd()).join('\n').trimEnd(); }
export function photoPath(value: string) {
  try { return new URL(value.startsWith('//') ? `https:${value}` : value).pathname; } catch { return ''; }
}
export async function readFullBandPost(surface: Surface): Promise<FullBandPost | null> {
  return traceStep('sites.band.posted.readFullBandPost', async () => read<FullBandPost | null>(surface, `
    const roots=docs.flatMap(({d})=>Array.from(d.querySelectorAll('.postsDetailArea ._contentListRegion,.postWrap.-postDetailPage .cContentsCard .postBody'))).filter(visible);
    if(roots.length!==1)return null;const root=roots[0];
    const texts=Array.from(root.querySelectorAll('p.txtBody,p.postText,.postTextView,.dPostTextView > .postText,.postTextBox > .postText._postTxt')).filter(visible);if(texts.length!==1)return null;
    const text=texts[0],body=text.innerText.replace(/\\r\\n?/g,'\\n').replace(/[\\u200b-\\u200d\\ufeff]/g,'').trimEnd();
    // Element.closest is rejected by Chromium's throwOnSideEffect reader.
    // Scoped selectors and parentElement reads keep this genuinely read-only.
    const images=Array.from(root.querySelectorAll('._photoRegion img,._photoListRegion img,.photo img,.postPhoto img,.photoView img,.photoRegion img,img.mediaImg'));
    const all=images.length?images:Array.from(root.querySelectorAll('img')).filter(img=>{
      for(let n=img.parentElement;n&&n!==root;n=n.parentElement)if(/(^|\\s)(postWriterInfo|postAuthor|comment|profile)(\\s|$)/.test(n.getAttribute('class')||''))return false;return true;
    });
    const tagNodes=Array.from(text.querySelectorAll('button.hashTag,a.hashTag')),linkNodes=Array.from(text.querySelectorAll('a[href^="http"]')).filter(n=>!tagNodes.includes(n));
    const tagTexts=tagNodes.map(n=>(n.textContent||'').trim());
    const linkUrls=linkNodes.map(n=>n.href);
    const tagTokens=[],linkTokens=[];let offset=0;
    const walk=n=>{if(n.nodeType===3){offset+=(n.nodeValue||'').replace(/[\\s\\u200b-\\u200d\\ufeff]+/g,'').length;return;}
      const label=n.textContent||'';
      if(tagNodes.includes(n))tagTokens.push({text:label.trim(),start:offset});
      if(linkNodes.includes(n))linkTokens.push({text:label,start:offset,href:n.href});
      for(const child of n.childNodes)walk(child);
    };walk(text);
    return {tagTokens,linkTokens,body,photos:all.map(img=>img.currentSrc||img.src||''),lineBreaks:(body.match(/\\n/g)||[]).length,hashtags:tagTexts.length,links:linkUrls.length,tagTexts,linkUrls};
  `).then(value => { if (!value) trace('selector', 'wait', { selector: 'body', reason: 'CONTROL_NOT_FOUND', counts: { expected: 1, observed: 0 } }); return value; }));
}
export function verifyFullBandPost(expected: string, uploaded: readonly string[], actual: FullBandPost) {
  const planned = normalizedBandBody(expected);
  const links = actual.linkTokens, tags = actual.tagTokens;
  const issues: ReadbackIssue[] = [];
  if (planned !== normalizedBandBody(actual.body)) issues.push({field:'text'});
  if ((planned.match(/\n/g) ?? []).length !== actual.lineBreaks) issues.push({field:'line_breaks'});
  if (actual.photos.length !== uploaded.length || actual.photos.some((url,i) => !photoPath(url) || photoPath(url) !== photoPath(uploaded[i] ?? ''))) issues.push({field:'photos'});
  if (actual.hashtags !== actual.tagTexts.length || tags.length !== actual.tagTexts.length) issues.push({field:'hashtags'});
  tags.forEach((tag,i) => { if (!tag.text.startsWith('#') || tag.start < 0 || tokenText(planned).slice(tag.start,tag.start + tokenText(tag.text).length) !== tokenText(tag.text) || tag.text !== actual.tagTexts[i] || i > 0 && tag.start <= tags[i-1]!.start) issues.push({field:'hashtags',index:i+1}); });
  if (actual.links !== actual.linkUrls.length || links.length !== actual.linkUrls.length) issues.push({field:'links'});
  links.forEach((link,i) => { if (link.href !== actual.linkUrls[i] || !containsServiceLink(planned,link) || i > 0 && link.start <= links[i-1]!.start) issues.push({field:'links',index:i+1}); });
  for (const [check,field,expectedCount,observedCount] of [
    ['text','text',Array.from(planned).length,Array.from(normalizedBandBody(actual.body)).length],
    ['line_breaks','line_breaks',(planned.match(/\n/g) ?? []).length,actual.lineBreaks],
    ['photo_order','photos',uploaded.length,actual.photos.length],
    ['hashtags','hashtags',tags.length,actual.hashtags],
    ['links','links',links.length,actual.links],
  ] as const) trace('verification', issues.some(i=>i.field===field)?'fail':'ok', {check,counts:{expected:expectedCount,observed:observedCount},...(issues.some(i=>i.field===field)?{reason:'VERIFICATION_MISMATCH' as const}:{})});
  if (issues.length) throw new ReadbackMismatch('BAND_PUBLISHED_READBACK_MISMATCH',issues);
}
