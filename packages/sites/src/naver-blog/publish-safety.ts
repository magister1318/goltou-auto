import type { GuardedRequest, Surface } from '@goltou/surface';
import { point, read, sleep } from '../dom';

export type BlogVisibility = 'public' | 'private';
export const experimentPrefix = '[골투오토 실험]';
export const finalPublishSelector = 'button[data-click-area="tpb*i.publish"]';
export interface VisibilityProof {
  selected: BlogVisibility | null;
  /** A wire mapping exists only when the real, labelled radios expose it. */
  wire: { name: 'openType'; privateValue: string; publicValue: string } | null;
  target: { x: number; y: number; selector: string } | null;
}

export function readVisibility(surface: Surface, desired: BlogVisibility): Promise<VisibilityProof> {
  return read(surface, `
    const labels={public:'전체공개',private:'비공개'};
    const entries=[];
    for(const {d,x,y} of docs) for(const e of d.querySelectorAll('input[type="radio"],[role="radio"]')) {
      const texts=[e.getAttribute('aria-label'),...(Array.from(e.labels||[]).filter(visible).map(l=>(l.textContent||'').trim()))];
      const mode=Object.keys(labels).find(k=>texts.includes(labels[k]));
      const label=Array.from(e.labels||[]).find(visible);
      if(mode&&(visible(e)||label)) entries.push({e,label,mode,x,y});
    }
    const pub=entries.filter(v=>v.mode==='public'),priv=entries.filter(v=>v.mode==='private');
    if(pub.length!==1||priv.length!==1||pub[0].e.ownerDocument!==priv[0].e.ownerDocument||pub[0].e.name!==priv[0].e.name)
      return {selected:null,wire:null,target:null};
    const selected=entries.filter(v=>v.e.checked===true||v.e.getAttribute('aria-checked')==='true');
    const a=pub[0].e,b=priv[0].e;
    const group=Array.from(a.ownerDocument.querySelectorAll('input[type="radio"]')).filter(e=>e.name===a.name&&(visible(e)||Array.from(e.labels||[]).some(visible)));
    if(new Set(group.map(e=>e.value)).size!==group.length||group.filter(e=>e.checked).length!==1) return {selected:null,wire:null,target:null};
    const wire=a.name==='openType'&&a.value!==b.value&&/^[0-9]+$/.test(a.value)&&/^[0-9]+$/.test(b.value)
      ?{name:'openType',privateValue:b.value,publicValue:a.value}:null;
    const entry=entries.find(v=>v.mode===${JSON.stringify(desired)}),e=entry.label||entry.e,r=e.getBoundingClientRect();
    const id=entry.e.id;
    const selector=id&&/^[a-zA-Z0-9_-]+$/.test(id)?'input[id="'+id+'"],label[for="'+id+'"]':null;
    return {selected:selected.length===1?selected[0].mode:null,wire,
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

/** No inferred numeric constants. The labelled real radios must provide the mapping,
 * and the actual request must expose that same unambiguous field. Unknown encodings
 * fail closed, including missing/truncated bodies, duplicates, and conflicting copies. */
export function inspectPrivateRequest(request: GuardedRequest, proof: VisibilityProof): boolean {
  if (proof.selected !== 'private' || !proof.wire || request.method !== 'POST' || !request.postData) return false;
  const values: string[] = [];
  const parse = (raw: string): unknown => {
    if ((raw.match(/"openType"\s*:/g) ?? []).length > 1) throw new Error('DUPLICATE_VISIBILITY');
    return JSON.parse(raw);
  };
  const visit = (value: unknown, depth: number): void => {
    if (depth > 5 || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const object = value as Record<string, unknown>;
    for (const [key, raw] of Object.entries(object)) {
      if (key === proof.wire!.name) values.push(String(raw));
      else if (['configuration', 'populationParams'].includes(key)) {
        try { visit(typeof raw === 'string' ? parse(raw) : raw, depth + 1); } catch { values.push('INVALID'); }
      }
    }
  };
  try {
    if (request.postData.trim().startsWith('{')) visit(parse(request.postData), 0);
    else {
      const form = new URLSearchParams(request.postData);
      for (const [key, raw] of form) {
        if (key === proof.wire.name) values.push(raw);
        else if (['configuration', 'populationParams'].includes(key)) visit(parse(raw), 1);
      }
    }
  } catch { return false; }
  return values.length === 1 && values[0] === proof.wire.privateValue && values[0] !== proof.wire.publicValue;
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
