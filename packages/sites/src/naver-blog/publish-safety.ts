import type { GuardedRequest, Surface } from '@goltou/surface';
import { point, read, sleep } from '../dom';
import { jsonNode, requestFields, walkFields } from './request-fields';

export type BlogVisibility = 'public' | 'private';
export const experimentPrefix = '[골투오토 실험]';
export const finalPublishSelector = 'button[data-click-area="tpb*i.publish"]';
/** Observed on 2026-11-14 in TWO unconditionally blocked device probes of the
 * same product: labelled private vs public. This is not an inferred enum. */
export const OBSERVED_BLOG_VISIBILITY_2026_11_14 = {
  radio: { name: 'open_type', privateValue: '0', publicValue: '2' },
  request: { contentType: 'application/x-www-form-urlencoded', path: ['populationParams', 'configuration', 'openType'], privateValue: 0, publicValue: 2,
    fields: ['blogId', 'documentModel', 'mediaResources', 'populationParams', 'productApiVersion', 'tokenId'],
    jsonFields: ['documentModel', 'mediaResources', 'populationParams'] },
} as const;
export interface VisibilityProof {
  selected: BlogVisibility | null;
  /** A wire mapping exists only when the real, labelled radios expose it. */
  wire: { name: 'open_type'; privateValue: string; publicValue: string } | null;
  target: { x: number; y: number; selector: string } | null;
  radios?: { mode: BlogVisibility; tag: string; type: string; name: string; id: string; value: string; checked: boolean }[];
}

export function readVisibility(surface: Surface, desired: BlogVisibility): Promise<VisibilityProof> {
  return read(surface, `
    const labels={public:'전체공개',private:'비공개'};
    const observed=${JSON.stringify(OBSERVED_BLOG_VISIBILITY_2026_11_14.radio)};
    const entries=[];
    for(const {d,x,y} of docs) for(const e of d.querySelectorAll('input[type="radio"],[role="radio"]')) {
      const texts=[e.getAttribute('aria-label'),...(Array.from(e.labels||[]).filter(visible).map(l=>(l.textContent||'').trim()))];
      const mode=Object.keys(labels).find(k=>texts.includes(labels[k]));
      const label=Array.from(e.labels||[]).find(visible);
      if(mode&&(visible(e)||label)) entries.push({e,label,mode,x,y});
    }
    const radios=entries.map(({e,mode})=>({mode,tag:e.tagName,type:e.type||'',name:e.name||'',id:e.id||'',value:e.value||'',checked:e.checked===true||e.getAttribute('aria-checked')==='true'}));
    const pub=entries.filter(v=>v.mode==='public'),priv=entries.filter(v=>v.mode==='private');
    if(pub.length!==1||priv.length!==1||pub[0].e.ownerDocument!==priv[0].e.ownerDocument||pub[0].e.name!==priv[0].e.name)
      return {selected:null,wire:null,target:null,radios};
    const selected=entries.filter(v=>v.e.checked===true||v.e.getAttribute('aria-checked')==='true');
    const a=pub[0].e,b=priv[0].e;
    const group=Array.from(a.ownerDocument.querySelectorAll('input[type="radio"]')).filter(e=>e.name===a.name&&(visible(e)||Array.from(e.labels||[]).some(visible)));
    if(new Set(group.map(e=>e.value)).size!==group.length||group.filter(e=>e.checked).length!==1) return {selected:null,wire:null,target:null,radios};
    const wire=a.name===observed.name&&a.value===observed.publicValue&&b.value===observed.privateValue
      ?{name:observed.name,privateValue:b.value,publicValue:a.value}:null;
    const entry=entries.find(v=>v.mode===${JSON.stringify(desired)}),e=entry.label||entry.e,r=e.getBoundingClientRect();
    const id=entry.e.id;
    const selector=id&&/^[a-zA-Z0-9_-]+$/.test(id)?'input[id="'+id+'"],label[for="'+id+'"]':null;
    return {selected:selected.length===1?selected[0].mode:null,wire,radios,
      target:selector&&!entry.e.disabled?{x:entry.x+r.left+r.width/2,y:entry.y+r.top+r.height/2,selector}:null};`);
}
export function requireVisibility(proof: VisibilityProof, expected: BlogVisibility) {
  if (proof.selected !== expected) throw new Error(expected === 'private' ? 'BLOG_VISIBILITY_NOT_PRIVATE' : 'BLOG_VISIBILITY_NOT_PUBLIC');
}
export async function selectVisibility(surface: Surface, desired: BlogVisibility) {
  const proof = await readVisibility(surface, desired);
  if (!proof.target || !await surface.readClickTarget?.(proof.target.x, proof.target.y, proof.target.selector)) throw new Error('BLOG_VISIBILITY_CONTROL_UNCONFIRMED');
  await surface.click(proof.target.x, proof.target.y);
  await sleep(350);
  requireVisibility(await readVisibility(surface, desired), desired);
}

/** Only the observed private shape passes, with independent labelled UI proof.
 * Walk every field (including JSON-valued form fields), preserving duplicates. */
export function inspectPrivateRequest(request: GuardedRequest, proof: VisibilityProof): boolean {
  const observed = OBSERVED_BLOG_VISIBILITY_2026_11_14;
  if (proof.selected !== 'private' || !proof.wire || proof.wire.name !== observed.radio.name || proof.wire.privateValue !== observed.radio.privateValue || proof.wire.publicValue !== observed.radio.publicValue || request.method !== 'POST' || request.postDataComplete !== true || request.contentType?.split(';')[0]?.trim().toLowerCase() !== observed.request.contentType) return false;
  try {
    const { fields } = requestFields(request);
    if (JSON.stringify(fields.map(([key]) => key).sort()) !== JSON.stringify([...observed.request.fields].sort())) return false;
    for (const key of observed.request.jsonFields) if (!jsonNode(String(fields.find(([name]) => name === key)![1].value)).entries) return false;
    const paths = new Set<string>(); let matches = 0, conflict = false;
    walkFields(fields, ({ path, key, node }) => {
      const identity = JSON.stringify(path);
      if (paths.has(identity)) throw new Error('DUPLICATE_REQUEST_FIELD');
      paths.add(identity);
      if (!/open|visib|public|private|secret|scope/i.test(key)) return;
      if (identity !== JSON.stringify(observed.request.path) || node.value !== observed.request.privateValue) conflict = true;
      else matches++;
    });
    return matches === 1 && !conflict;
  } catch { return false; }
}

export interface PublishedPost { postId: string; url: string }
export function postIdentity(url: string): PublishedPost | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !['blog.naver.com', 'm.blog.naver.com'].includes(u.hostname) || u.username || u.password || u.port) return null;
    const path = /^\/([A-Za-z0-9_-]+)\/([0-9]+)$/.exec(u.pathname);
    const id = path?.[2] ?? (u.pathname === '/PostView.naver' ? u.searchParams.get('logNo') : null);
    const blog = path?.[1] ?? u.searchParams.get('blogId');
    if (!id || !/^[0-9]+$/.test(id) || !blog || !/^[A-Za-z0-9_-]+$/.test(blog)) return null;
    return { postId: id, url: `https://blog.naver.com/${blog}/${id}` };
  } catch { return null; }
}
export function requireTestPost(receipt: PublishedPost | undefined, candidate: PublishedPost | null, title: string) {
  if (!receipt || !candidate || receipt.postId !== candidate.postId || receipt.url !== candidate.url || !title.startsWith(experimentPrefix)) throw new Error('BLOG_TEST_DELETE_REFUSED');
}
export async function guardedPublishClick(surface: Surface, visibility: BlogVisibility, check: () => void, acceptProof: (proof: VisibilityProof) => void) {
  const target = await point(surface, finalPublishSelector);
  if (!target || !await surface.readClickTarget?.(target.x, target.y, finalPublishSelector)) throw new Error('BLOG_PUBLISH_CONTROL_UNCONFIRMED');
  check();
  requireVisibility(await readVisibility(surface, visibility), visibility);
  await surface.click(target.x, target.y, async () => {
    check();
    if (!await surface.readClickTarget?.(target.x, target.y, finalPublishSelector)) throw new Error('BLOG_PUBLISH_CONTROL_UNCONFIRMED');
    const proof = await readVisibility(surface, visibility);
    requireVisibility(proof, visibility); acceptProof(proof);
  });
}
