import type { Surface } from '@goltou/surface';
import { trace, traceStep, type ReasonCode, type TraceCounts } from '@goltou/surface/telemetry';
import { read } from '../dom';
import { settledReadback } from '../settled-readback';
import { blogHashtagPattern } from '../naver-blog/tag-patterns';
import { containsServiceLink, compareReadbackText, traceReadbackText, numberFacts, sameReadbackNumbers, sameReadbackIdentityText, ReadbackMismatch, tokenText, type ReadbackIssue, type ServiceLink, type ServiceTextToken } from '../readback-checks';
import { bandPhotoEvidence, type BandPhotoEvidence } from './photo-path';
import { readApiPhotos, type PhotoReadFailure } from './photo-read';

export interface CreatedBandPost { url: string; body: string; createdAt: number; owned: boolean; photoCount: number; apiPhotos?: BandPhotoEvidence[]; }
const storedText = (value: string) => value.replace(/<\/?band:hashtag>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]!);
/** Ephemeral evidence from the app's already-open posting WebView, never persisted. */
export function createdBandPosts(body: string, band: string, onPhotoFailure?: (url: string, failure: PhotoReadFailure) => void): CreatedBandPost[] {
  const value = JSON.parse(body);
  if (value.result_code !== 1 || !Array.isArray(value.result_data?.items)) throw Error('BAND_RECORD_READ_RESPONSE');
  return value.result_data.items.flatMap((item: { post?: Record<string, unknown> }) => {
    const p = item.post;
    if (!p || typeof p.content !== 'string' || !Number.isFinite(p.created_at) || !Number.isInteger(p.photo_count)) return [];
    const u = typeof p.web_url === 'string' ? new URL(p.web_url) : undefined;
    if (!u || !['band.us', 'www.band.us'].includes(u.hostname) || u.protocol !== 'https:' || u.search || u.hash || u.pathname !== `/band/${band}/post/${p.post_no}`) return [];
    const author = p.author as { me?: unknown } | undefined, parent = p.band as { band_no?: unknown } | undefined;
    if (String(parent?.band_no) !== band) return [];
    const photoRead = readApiPhotos(p);
    const apiPhotos = 'photos' in photoRead ? photoRead.photos : undefined;
    if ('reason' in photoRead) onPhotoFailure?.(`https://band.us${u.pathname}`, photoRead);
    return [{ url: `https://band.us${u.pathname}`, body: storedText(p.content), createdAt: p.created_at as number, owned: author?.me === true, photoCount: p.photo_count as number, ...(apiPhotos ? { apiPhotos } : {}) }];
  });
}
export interface FullBandPost { body: string; photos: string[]; declaredPhotos?: number | null; collage?: boolean; apiPhotos?: BandPhotoEvidence[]; lineBreaks: number; hashtags: number; links: number; tagTexts: string[]; linkUrls: string[]; tagTokens: ServiceTextToken[]; linkTokens: ServiceLink[]; }
/** innerText omits trailing spaces on each rendered line; preserve every line and all wording. */
export function normalizedBandBody(body: string) { return body.replace(/\r\n?/g, '\n').replace(/[\u200b-\u200d\ufeff]/g, '').split('\n').map(line => line.trimEnd()).join('\n').trimEnd(); }
export async function readFullBandPost(surface: Surface, onIncomplete?: (failure: PhotoReadFailure) => void): Promise<FullBandPost | null> {
  return traceStep('sites.band.posted.readFullBandPost', async () => {
    const result = await read<FullBandPost | PhotoReadFailure | null>(surface, `
    const roots=docs.flatMap(({d})=>Array.from(d.querySelectorAll('.postsDetailArea ._contentListRegion,.postWrap.-postDetailPage .cContentsCard .postBody,.postView,section.postCard,.postContent')).filter(node=>!node.classList.contains('postContent')||node.querySelector('p.postText._postTxt'))).filter(visible);
    const outer=roots.filter(node=>!roots.some(other=>other!==node&&other.contains(node)));
    if(outer.length!==1)return {reason:'BAND_DETAIL_ROOT_COUNT',counts:{expected:1,observed:outer.length}};const root=outer[0];
    const texts=Array.from(root.querySelectorAll('p.txtBody,p.postText,.postTextView,.dPostTextView > .postText,.postTextBox > .postText._postTxt')).filter(visible);
    const leaves=texts.filter(node=>!texts.some(other=>other!==node&&node.contains(other)));
    if(leaves.length!==1)return {reason:'BAND_DETAIL_BODY_COUNT',counts:{expected:1,observed:leaves.length}};
    const text=leaves[0],body=text.innerText.replace(/\\r\\n?/g,'\\n').replace(/[\\u200b-\\u200d\\ufeff]/g,'').trimEnd();
    const areas='._photoRegion,._photoListRegion,.photo,.postPhoto,.photoView,.photoRegion';
    const collageSelector='div.uWidget.-expanded > ul.uCollage';
    const collageImages=new Set(root.querySelectorAll(collageSelector+' > li.collageItem > div.collageImage > img'));
    const nodes=Array.from(root.querySelectorAll('img,[data-photo-url],[data-lazy-src],[data-original],[data-src],.photoPlaceholder,[data-photo-key]'));
    const photoAreas=Array.from(root.querySelectorAll(areas));
    const media=nodes.filter(n=>{
      for(let p=n;p&&p!==root;p=p.parentElement){
        const c=p.getAttribute('class')||'';
        if(/(^|\\s)(postWriterInfo|postAuthor|comment|profile|linkPreview)(\\s|$)/.test(c))return false;
      }
      return collageImages.has(n)||n.tagName==='IMG'&&n.classList.contains('mediaImg')||photoAreas.some(area=>area.contains(n));
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
    return {tagTokens,linkTokens,body,photos:slots.map(imageUrl),collage:!!root.querySelector(collageSelector),declaredPhotos:declared&&/^\\d+$/.test(declared)?Number(declared):null,lineBreaks:(body.match(/\\n/g)||[]).length,hashtags:tagTexts.length,links:linkUrls.length,tagTexts,linkUrls};
  `);
    if (result && 'body' in result) return result;
    if (result) onIncomplete?.(result);
    return null;
  });
}
export function bandDomPhotos(actual: FullBandPost, expected: number) {
  const evidence = actual.photos.map(bandPhotoEvidence);
  const readable = evidence.filter(Boolean).length;
  const reason: ReasonCode | undefined = expected > 0 && readable === 0 ? 'PHOTO_SOURCE_MISSING'
    : actual.photos.length !== expected ? 'PHOTO_COUNT_MISMATCH'
    : readable !== expected ? 'PHOTO_PATH_UNREADABLE' : undefined;
  return { evidence, readable, reason };
}
export function bandBodyIssues(expected: string, actual: string, log = true): ReadbackIssue[] {
  const result = compareReadbackText(expected.split('\n'), actual.split('\n'));
  if (log) traceReadbackText(result);
  const issues: ReadbackIssue[] = result.missing.map(paragraph => ({ field: 'text', paragraph }));
  if (!sameReadbackNumbers(expected, actual)) {
    if (log) {
      const planned = numberFacts(expected), observed = numberFacts(actual);
      const differences = Math.max(planned.length, observed.length) - planned.filter((fact, i) => fact === observed[i]).length;
      trace('verification', 'fail', { check: 'number', reason: 'READBACK_NUMBER', counts: { expected: planned.length, observed: observed.length, differences } });
    }
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
      bandPhotoPresence(value, uploaded.length),
      {check:'hashtags',reason:'READBACK_TAGS',expected:expectedTags,observed:value?.hashtags??0,present:(value?.hashtags??0)>=expectedTags},
      {check:'links',reason:'READBACK_LINKS',expected:expectedLinks,observed:value?.links??0,present:(value?.links??0)>=expectedLinks},
    ],
  });
  const incomplete = result.classes.filter(c => !c.present);
  const fields = incomplete.map(c=>({
    field: (c.check === 'links' ? 'href' : c.check === 'photos' ? 'photo' : c.check) as ReadbackIssue['field'],
    expected:c.expected, observed:c.observed,
  }));
  if (!result.value || !result.stable) {
    trace('verification', 'fail', { check: 'stability', reason: 'READBACK_STABILITY', counts: { expected: 2, observed: result.value ? 1 : 0 } });
    for (const item of incomplete) trace('verification', 'fail', {
      check: item.check, reason: item.reason, counts: { expected: item.expected, observed: item.observed },
    });
    throw new ReadbackMismatch('BAND_PUBLISHED_READBACK_UNAVAILABLE', [{ field:'stability' }, ...fields]);
  }
  const actual = result.value;
  const sameTitle = sameReadbackIdentityText(planned.split('\n')[0] ?? '', actual.body.split('\n')[0] ?? '');
  const issues: ReadbackIssue[] = [];
  try { verifyFullBandPost(expected,uploaded,actual,requiredLinks); } catch(error) {
    if (!(error instanceof ReadbackMismatch)) throw error;
    for (const issue of error.issues) {
      issues.push(sameTitle && ['number','text','href'].includes(issue.field) ? { ...issue, missing:true } : issue);
    }
  }
  for (const [i, item] of incomplete.entries()) {
    const issue = fields[i]!;
    if (issues.some(existing => existing.field === issue.field)) continue;
    trace('verification', 'fail', { check: item.check, reason: item.reason, counts: { expected: item.expected, observed: item.observed } });
    issues.push(issue);
  }
  if(issues.length)throw new ReadbackMismatch('BAND_PUBLISHED_READBACK_MISMATCH:' + [...new Set(issues.map(issue=>issue.field))].join(','),issues);
  return result.value;
}
function bandPhotoPresence(value: FullBandPost | null, expected: number) {
  const readable = value?.collage && value.apiPhotos === undefined ? bandDomPhotos(value, expected).readable : value?.photos.length ?? 0;
  const observed = value?.apiPhotos?.length ?? readable;
  const present = !!value && (value.apiPhotos !== undefined || readable >= expected ||
    !value.collage && value.declaredPhotos === readable);
  return { check: 'photos' as const, reason: present ? 'READBACK_PHOTOS' as const : observed ? 'PHOTO_COUNT_MISMATCH' as const : 'PHOTO_SOURCE_MISSING' as const,
    expected, observed, present };
}
function firstPhotoOrderMismatch(uploaded: readonly string[], dom: readonly (BandPhotoEvidence | undefined)[], api?: readonly BandPhotoEvidence[]) {
  const photos = api ?? dom;
  for (const [i, value] of uploaded.entries()) {
    const expected = bandPhotoEvidence(value), observed = photos[i];
    if (!expected || !observed || expected.path !== observed.path) {
      return { reason: 'UPLOAD_PATH_MISMATCH' as const, index: i + 1, expected: expected?.shape ?? null, observed: observed?.shape ?? null };
    }
  }
  if (!api) return;
  const apiPaths = api.map(photo => photo.path);
  let next = 0;
  for (const [i, photo] of dom.entries()) {
    if (!photo) continue; // The API has the whole list, including any not-yet-loaded DOM slots.
    const match = apiPaths.indexOf(photo.path, next);
    if (match === -1) {
      const boundary = api[next] ?? api[next - 1];
      return { reason: 'DOM_ORDER_MISMATCH' as const, index: i + 1, expected: boundary?.shape ?? null, observed: photo.shape };
    }
    next = match + 1;
  }
}
export function verifyFullBandPost(expected: string, uploaded: readonly string[], actual: FullBandPost, requiredLinks: readonly string[] = []) {
  const planned = normalizedBandBody(expected);
  const links = actual.linkTokens, tags = actual.tagTokens;
  const issues = bandBodyIssues(expected, actual.body);
  const dom = bandDomPhotos(actual, uploaded.length);
  const observedPhotos = actual.apiPhotos?.length ?? (actual.collage ? dom.readable : actual.photos.length);
  const photoReason = actual.apiPhotos === undefined && actual.collage ? dom.reason
    : observedPhotos === uploaded.length ? undefined
    : actual.apiPhotos === undefined && observedPhotos === 0 ? 'PHOTO_SOURCE_MISSING' : 'PHOTO_COUNT_MISMATCH';
  const orderMismatch = photoReason === undefined ? firstPhotoOrderMismatch(uploaded, dom.evidence, actual.apiPhotos) : undefined;
  const photoCounts = { expected: uploaded.length, observed: observedPhotos };
  if (photoReason) {
    const missing = observedPhotos < uploaded.length && (actual.apiPhotos !== undefined || !actual.collage && actual.declaredPhotos === observedPhotos);
    issues.push({field:'photo', ...photoCounts, ...(missing ? {missing:true} : {})});
    trace('verification', 'fail', { check: 'photo_order', reason: photoReason, counts: {
      ...photoCounts, ...(actual.apiPhotos === undefined && actual.photos.length !== observedPhotos ? { photoSlots: actual.photos.length } : {}),
    } });
  } else if (orderMismatch) {
    issues.push({field:'order',index:orderMismatch.index,...photoCounts});
    const { reason, ...photoOrder } = orderMismatch;
    trace('verification', 'fail', { check: 'photo_order', reason, counts: photoCounts, photoOrder });
  } else trace('verification', 'ok', { check: 'photo_order', counts: photoCounts });

  const failToken = (field: 'hashtags' | 'href', reason: ReasonCode, counts: TraceCounts, index?: number) => {
    issues.push({ field, ...(index !== undefined ? { index } : {}) });
    trace('verification', 'fail', { check: field === 'href' ? 'links' : field, reason, counts: { ...counts, ...(index !== undefined ? { step: index } : {}) } });
  };
  const compactBody = tokenText(actual.body), compactPlan = tokenText(planned);
  const mismatchedTags = [actual.hashtags, tags.length].find(count => count !== actual.tagTexts.length);
  if (mismatchedTags !== undefined) {
    failToken('hashtags', 'BAND_TAG_COUNT_MISMATCH', { expected: actual.tagTexts.length, observed: mismatchedTags });
  }
  tags.forEach((tag, i) => {
    const label = tokenText(tag.text), slice = compactBody.slice(tag.start, tag.start + label.length);
    if (!tag.text.startsWith('#') || tag.start < 0 || slice !== label || tag.text !== actual.tagTexts[i]) {
      failToken('hashtags', 'BAND_TAG_TOKEN_MISMATCH', { expected: label.length, observed: slice.length, differences: 1 }, i + 1);
    } else if (i > 0 && tag.start <= tags[i - 1]!.start) {
      failToken('hashtags', 'BAND_TAG_ORDER_MISMATCH', { expected: tags[i - 1]!.start + 1, observed: tag.start }, i + 1);
    }
  });
  const matchedLinks = requiredLinks.filter(value => {
    try { return actual.linkUrls.includes(new URL(value).href); } catch { return false; }
  }).length;
  if (matchedLinks !== requiredLinks.length) failToken('href', 'BAND_LINK_REQUIRED_MISSING', { expected: requiredLinks.length, observed: matchedLinks });
  const mismatchedLinks = [actual.links, links.length].find(count => count !== actual.linkUrls.length);
  if (mismatchedLinks !== undefined) {
    failToken('href', 'BAND_LINK_COUNT_MISMATCH', { expected: actual.linkUrls.length, observed: mismatchedLinks });
  }
  links.forEach((link, i) => {
    const destination = actual.linkUrls[i];
    if (link.href !== destination) {
      failToken('href', 'BAND_LINK_DESTINATION_MISMATCH', { expected: destination?.length ?? 0, observed: link.href.length, differences: 1 }, i + 1);
    } else if (!containsServiceLink(actual.body, link) || !compactPlan.includes(tokenText(link.text))) {
      failToken('href', 'BAND_LINK_TOKEN_MISMATCH', { expected: 1, observed: 0 }, i + 1);
    } else if (i > 0 && link.start <= links[i - 1]!.start) {
      failToken('href', 'BAND_LINK_ORDER_MISMATCH', { expected: links[i - 1]!.start + 1, observed: link.start }, i + 1);
    }
  });
  if (!issues.some(issue => issue.field === 'hashtags')) trace('verification', 'ok', { check: 'hashtags', counts: { expected: tags.length, observed: actual.hashtags } });
  if (!issues.some(issue => issue.field === 'href')) trace('verification', 'ok', { check: 'links', counts: { expected: links.length, observed: actual.links } });
  const lineBreaks = (planned.match(/\n/g) ?? []).length;
  trace('verification', issues.some(issue => issue.field === 'text') && lineBreaks !== actual.lineBreaks ? 'fail' : 'ok', {
    check: 'line_breaks', counts: { expected: lineBreaks, observed: actual.lineBreaks },
    reason: lineBreaks === actual.lineBreaks ? 'READBACK_PARAGRAPHS'
      : issues.some(issue => issue.field === 'text') ? 'READBACK_TEXT' : 'READBACK_TOLERATED',
  });
  if (!issues.some(issue => issue.field === 'text')) trace('verification', 'ok', { check: 'text',
    counts: { expected: Array.from(planned).length, observed: Array.from(normalizedBandBody(actual.body)).length } });
  if (issues.length) throw new ReadbackMismatch('BAND_PUBLISHED_READBACK_MISMATCH:' + [...new Set(issues.map(issue=>issue.field))].join(','),issues);
}
