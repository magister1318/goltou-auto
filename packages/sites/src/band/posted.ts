import type { Surface } from '@goltou/surface';
import { trace, traceStep } from '@goltou/surface/telemetry';
import { read } from '../dom';
import { settledReadback } from '../settled-readback';
import { blogHashtagPattern } from '../naver-blog/tag-patterns';
import { containsServiceLink, compareReadbackText, traceReadbackText, numberFacts, sameReadbackNumbers, sameReadbackIdentityText, ReadbackMismatch, tokenText, type ReadbackIssue, type ServiceLink, type ServiceTextToken } from '../readback-checks';

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
export interface FullBandPost { body: string; photos: string[]; declaredPhotos?: number | null; lineBreaks: number; hashtags: number; links: number; tagTexts: string[]; linkUrls: string[]; tagTokens: ServiceTextToken[]; linkTokens: ServiceLink[]; }
/** innerText omits trailing spaces on each rendered line; preserve every line and all wording. */
export function normalizedBandBody(body: string) { return body.replace(/\r\n?/g, '\n').replace(/[\u200b-\u200d\ufeff]/g, '').split('\n').map(line => line.trimEnd()).join('\n').trimEnd(); }
export function photoPath(value: string) {
  try { return new URL(value.startsWith('//') ? `https:${value}` : value).pathname; } catch { return ''; }
}
export async function readFullBandPost(surface: Surface): Promise<FullBandPost | null> {
  return traceStep('sites.band.posted.readFullBandPost', async () => read<FullBandPost | null>(surface, `
    const roots=docs.flatMap(({d})=>Array.from(d.querySelectorAll('.postsDetailArea ._contentListRegion,.postWrap.-postDetailPage .cContentsCard .postBody,.postView,section.postCard'))).filter(visible);
    const outer=roots.filter(node=>!roots.some(other=>other!==node&&other.contains(node)));
    if(outer.length!==1)return null;const root=outer[0];
    const texts=Array.from(root.querySelectorAll('p.txtBody,p.postText,.postTextView,.dPostTextView > .postText,.postTextBox > .postText._postTxt')).filter(visible);
    const leaves=texts.filter(node=>!texts.some(other=>other!==node&&node.contains(other)));
    if(leaves.length!==1)return null;
    const text=leaves[0],body=text.innerText.replace(/\\r\\n?/g,'\\n').replace(/[\\u200b-\\u200d\\ufeff]/g,'').trimEnd();
    const areas='._photoRegion,._photoListRegion,.photo,.postPhoto,.photoView,.photoRegion';
    const nodes=Array.from(root.querySelectorAll('img,[data-photo-url],[data-lazy-src],[data-original],[data-src],.photoPlaceholder,[data-photo-key]'));
    const photoAreas=Array.from(root.querySelectorAll(areas));
    const media=nodes.filter(n=>{
      for(let p=n;p&&p!==root;p=p.parentElement){
        const c=p.getAttribute('class')||'';
        if(/(^|\\s)(postWriterInfo|postAuthor|comment|profile|linkPreview)(\\s|$)/.test(c))return false;
      }
      return n.tagName==='IMG'&&n.classList.contains('mediaImg')||photoAreas.some(area=>area.contains(n));
    });
    const slots=media.filter(node=>!media.some(other=>other!==node&&node.contains(other)));
    const imageUrl=node=>{
      for(let e=node;e&&e!==root;e=e.parentElement){
        for(const key of ['data-lazy-src','data-original','data-src','data-photo-url','src']){
          const url=e.getAttribute(key);
          if(url&&/^(https?:)?[/][/]|^[/](?![/])/.test(url)&&!/(?:placeholder|no[_-]?image|blank\\.|transparent\\.)/i.test(url))
            return url.startsWith('/')&&!url.startsWith('//')?e.ownerDocument.location.origin+url:url;
        }
      }
      return '';
    };
    const declared=root.getAttribute('data-photo-count')||root.querySelector('[data-photo-count]')?.getAttribute('data-photo-count');
    const tagNodes=Array.from(text.querySelectorAll('button.hashTag,a.hashTag')),linkNodes=Array.from(text.querySelectorAll('a[href^="http"]')).filter(n=>!tagNodes.includes(n));
    const tagTexts=tagNodes.map(n=>(n.textContent||'').trimStart().trimEnd());
    const linkUrls=linkNodes.map(n=>n.href);
    const tagTokens=[],linkTokens=[];let offset=0;
    const walk=n=>{if(n.nodeType===3){offset+=(n.nodeValue||'').replace(/[\\s\\u200b-\\u200d\\ufeff]+/g,'').length;return;}
      const label=n.textContent||'';
      if(tagNodes.includes(n))tagTokens.push({text:label.trimStart().trimEnd(),start:offset});
      if(linkNodes.includes(n))linkTokens.push({text:label,start:offset,href:n.href});
      for(const child of n.childNodes)walk(child);
    };walk(text);
    return {tagTokens,linkTokens,body,photos:slots.map(imageUrl),declaredPhotos:declared&&/^\\d+$/.test(declared)?Number(declared):null,lineBreaks:(body.match(/\\n/g)||[]).length,hashtags:tagTexts.length,links:linkUrls.length,tagTexts,linkUrls};
  `));
}
export function bandBodyIssues(expected: string, actual: string, log = true): ReadbackIssue[] {
  const result = compareReadbackText(expected.split('\n'), actual.split('\n'));
  if (log) traceReadbackText(result);
  const issues: ReadbackIssue[] = result.missing.map(paragraph => ({ field: 'text', paragraph }));
  if (!sameReadbackNumbers(expected, actual)) {
    if (log) trace('verification', 'fail', { check: 'number', reason: 'READBACK_NUMBER', counts: { expected: numberFacts(expected).length, observed: numberFacts(actual).length } });
    issues.push({ field: 'number' });
  }
  return issues;
}
export async function settleFullBandPost(surface: Surface, expected: string, uploaded: readonly string[], check: () => void, timeoutMs = 90000, readCurrent = () => readFullBandPost(surface), requiredLinks: readonly string[] = []) {
  const planned = normalizedBandBody(expected);
  // The embedded runtime has no ICU property escapes. Reuse the existing
  // explicit keyword ranges for presence counts; Band's exact token positions
  // and wording are still verified independently below.
  const expectedTags = (planned.match(blogHashtagPattern) ?? []).length;
  const expectedLinks = (planned.match(/https?:\/\/[^\s]+/g) ?? []).length;
  const result = await settledReadback({ read: readCurrent, check, timeoutMs,
    classes: value => [
      {check:'title',reason:'READBACK_TITLE',expected:1,observed:value?.body.split('\n')[0]?1:0,present:!!value?.body.split('\n')[0]},
      {check:'text',reason:'READBACK_TEXT',expected:planned.length,observed:value?.body.length??0,present:!!value?.body},
      {check:'line_breaks',reason:'READBACK_PARAGRAPHS',expected:(planned.match(/\n/g)??[]).length,observed:value?.lineBreaks??0,present:!!value},
      {check:'photos',reason:'READBACK_PHOTOS',expected:uploaded.length,observed:value?.photos.length??0,present:!!value&&(value.photos.length>=uploaded.length||value.declaredPhotos===value.photos.length)},
      {check:'hashtags',reason:'READBACK_TAGS',expected:expectedTags,observed:value?.hashtags??0,present:(value?.hashtags??0)>=expectedTags},
      {check:'links',reason:'READBACK_LINKS',expected:expectedLinks,observed:value?.links??0,present:(value?.links??0)>=expectedLinks},
    ],
  });
  const fields = result.classes.filter(c=>!c.present).map(c=>({
    field: (c.check === 'links' ? 'href' : c.check === 'photos' ? 'photo' : c.check) as ReadbackIssue['field'],
    expected:c.expected, observed:c.observed,
  }));
  if (!result.value || !result.stable) throw new ReadbackMismatch('BAND_PUBLISHED_READBACK_UNAVAILABLE', [{ field:'stability' }, ...fields]);
  const actual = result.value;
  const sameTitle = sameReadbackIdentityText(planned.split('\n')[0] ?? '', actual.body.split('\n')[0] ?? '');
  const issues: ReadbackIssue[] = [];
  try { verifyFullBandPost(expected,uploaded,actual,requiredLinks); } catch(error) {
    if (!(error instanceof ReadbackMismatch)) throw error;
    for (const issue of error.issues) {
      if (issue.field === 'photo') issues.push({
        ...issue, expected:uploaded.length, observed:actual.photos.length,
        ...(actual.declaredPhotos === actual.photos.length && actual.photos.length < uploaded.length ? { missing:true } : {}),
      });
      else issues.push(sameTitle && ['number','text','href'].includes(issue.field) ? { ...issue, missing:true } : issue);
    }
  }
  for (const issue of fields) if (!issues.some(item=>item.field===issue.field)) issues.push(issue);
  if(issues.length)throw new ReadbackMismatch('BAND_PUBLISHED_READBACK_MISMATCH:' + [...new Set(issues.map(issue=>issue.field))].join(','),issues);
  return result.value;
}
export function verifyFullBandPost(expected: string, uploaded: readonly string[], actual: FullBandPost, requiredLinks: readonly string[] = []) {
  const planned = normalizedBandBody(expected);
  const links = actual.linkTokens, tags = actual.tagTokens;
  const issues = bandBodyIssues(expected, actual.body);
  if (actual.photos.length !== uploaded.length || actual.photos.some((url,i) => !photoPath(url) || photoPath(url) !== photoPath(uploaded[i] ?? ''))) issues.push({field:'photo'});
  if (actual.hashtags !== actual.tagTexts.length || tags.length !== actual.tagTexts.length) issues.push({field:'hashtags'});
  tags.forEach((tag,i) => { if (!tag.text.startsWith('#') || tag.start < 0 || tokenText(actual.body).slice(tag.start,tag.start + tokenText(tag.text).length) !== tokenText(tag.text) || tag.text !== actual.tagTexts[i] || i > 0 && tag.start <= tags[i-1]!.start) issues.push({field:'hashtags',index:i+1}); });
  if (requiredLinks.some(value => {
    try { return !actual.linkUrls.includes(new URL(value).href); } catch { return true; }
  })) issues.push({ field: 'href' });
  if (actual.links !== actual.linkUrls.length || links.length !== actual.linkUrls.length) issues.push({field:'href'});
  links.forEach((link,i) => { if (link.href !== actual.linkUrls[i] || (!containsServiceLink(actual.body,link) || !tokenText(planned).includes(tokenText(link.text))) || i > 0 && link.start <= links[i-1]!.start) issues.push({field:'href',index:i+1}); });
  for (const [check,field,expectedCount,observedCount] of [
    ['text','text',Array.from(planned).length,Array.from(normalizedBandBody(actual.body)).length],
    ['line_breaks','line_breaks',(planned.match(/\n/g) ?? []).length,actual.lineBreaks],
    ['photo_order','photo',uploaded.length,actual.photos.length],
    ['hashtags','hashtags',tags.length,actual.hashtags],
    ['links','href',links.length,actual.links],
  ] as const) trace('verification', issues.some(i=>i.field===field)?'fail':'ok', {check,counts:{expected:expectedCount,observed:observedCount},...(issues.some(i=>i.field===field)?{reason:'VERIFICATION_MISMATCH' as const}:{})});
  if (issues.length) throw new ReadbackMismatch('BAND_PUBLISHED_READBACK_MISMATCH:' + [...new Set(issues.map(issue=>issue.field))].join(','),issues);
}
