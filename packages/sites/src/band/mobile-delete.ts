import type { SurfaceHost } from '@goltou/surface';
import { compact, read, sleep, waitFor } from '../dom';
import { requestFields } from '../naver-blog/request-fields';
import { bandPostIdentity, type BandDeleteResult } from './delete';
import { openRecordedBandFeed } from './record-read';
import { bandDeleteShape, type BandDeleteCode, type BandDeleteLog } from './delete-log';

/** Current service code uses this single-post form. Bulk/comment routes are excluded. */
export function bandDeleteRequestAllowed(r: import('@goltou/surface').GuardedRequest, id: { band: string; post: string }) {
  return bandDeleteRequestDecision(r, id) === 'REQUEST_ALLOWED';
}
export function bandDeleteRequestDecision(r: import('@goltou/surface').GuardedRequest, id: { band: string; post: string }): BandDeleteCode {
  try {
    const u = new URL(r.url);
    if (r.method !== 'POST') return 'METHOD_BLOCKED';
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || !['api.band.us', 'api-kr.band.us'].includes(u.hostname)) return 'ORIGIN_BLOCKED';
    if (u.pathname !== '/v1.5.0/delete_post') return 'ROUTE_BLOCKED';
    if (u.searchParams.getAll('version').length !== 1 || u.searchParams.get('version') !== '20140508' ||
      u.searchParams.getAll('token').length > 1 || u.searchParams.getAll('ts').length > 1 ||
      u.searchParams.has('ts') && !/^\d{13}$/.test(u.searchParams.get('ts')!) ||
      [...u.searchParams.keys()].some(k => !['version', 'token', 'ts'].includes(k))) return 'QUERY_BLOCKED';
    if (!r.postDataComplete) return 'BODY_INCOMPLETE';
    const parsed = requestFields(r);
    if (parsed.encoding !== 'form') return 'BODY_ENCODING';
    if (parsed.fields.length !== 2) return 'TARGET_FIELDS';
    const values = (key: string) => parsed.fields.filter(([k]) => k === key).map(([, v]) => v.value);
    return JSON.stringify(values('band_no')) === JSON.stringify([id.band]) && JSON.stringify(values('post_no')) === JSON.stringify([id.post]) ? 'REQUEST_ALLOWED' : 'TARGET_MISMATCH';
  } catch { return 'BODY_PARSE'; }
}

export interface BandDeleteTarget { url: string; title: string; matchesBody: (body: string) => boolean; createdAfter: number; createdBefore: number }
export type BandDeleteReview = (surface: import('@goltou/surface').Surface) => Promise<void>;

/** The stored URL, owned service receipt and the card's own permalink must agree. */
export async function deleteMobileRecordedBandPost(host: SurfaceHost, target: BandDeleteTarget, timeoutMs = 10000, log: BandDeleteLog = () => {}, review?: BandDeleteReview): Promise<BandDeleteResult> {
  log({ code: 'START' });
  const id = bandPostIdentity(target.url);
  if (!id || !target.title.trim() || typeof target.matchesBody !== 'function' || !Number.isFinite(target.createdAfter) || !Number.isFinite(target.createdBefore) || target.createdBefore < target.createdAfter) { log({ code: 'IDENTITY_REJECTED' }); return { status: 'not_started' }; }
  let armed = false, sent = false, attempted = false, success = false;
  let session: Awaited<ReturnType<typeof openRecordedBandFeed>> | undefined;
  try {
    log({ code: 'FEED_OPEN' });
    session = await openRecordedBandFeed(host, target, r => {
      const code = sent ? 'ALREADY_SENT' : !armed ? 'NOT_ARMED' : bandDeleteRequestDecision(r, id);
      log({ code, shape: bandDeleteShape(r) });
      if (code !== 'REQUEST_ALLOWED') return false;
      armed = false; sent = true; return true;
    }, (status, body) => { try { success = status >= 200 && status < 300 && JSON.parse(body).result_code === 1; } catch { success = false; }
      log({ code: success ? 'RESPONSE_OK' : 'RESPONSE_REJECTED' });
    }, log);
    log({ code: 'FEED_READ' });
    const { surface: s } = session;
    if (!s.readClickTarget || !s.readAppFocus) throw Error('BAND_DELETE_CONTROL');
    const original = session.current();
    if (!original) {
      if (await session.refresh() || !await session.verifyGone()) { log({ code: 'NOT_STARTED' }); return { status: 'not_started' }; }
      if (review) { if (await session.refresh()) throw Error('BAND_DELETE_IDENTITY'); session.reviewFeed(); await review(s); }
      log({ code: 'ALREADY_ABSENT' });
      return { status: 'deleted', alreadyAbsent: true };
    }
    if (!target.matchesBody(original.body) || original.createdAt < target.createdAfter || original.createdAt > target.createdBefore) throw Error('BAND_DELETE_IDENTITY');
    const root = `section.postCard:has(a.postCreatedAt[href=${JSON.stringify(id.url)}])`;
    const identity = async () => {
      const p = session!.current();
      const u = new URL((await s.readState()).url);
      if (!p?.owned || p.url !== id.url || !['band.us', 'www.band.us'].includes(u.hostname) ||
        p.createdAt !== original?.createdAt || compact(p.body) !== compact(original.body) ||
        u.pathname.replace(/\/$/, '') !== `/band/${id.band}/post` || !await s.readAppFocus!()) throw Error('BAND_DELETE_IDENTITY');
      if (!await read<boolean>(s, `const ps=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(root)}))).filter(visible);return ps.length===1&&(ps[0].querySelector('p.postText')?.innerText||'').trim().split('\\n')[0].trim()===${JSON.stringify(target.title)};`)) throw Error('BAND_DELETE_IDENTITY');
    };
    await identity();
    log({ code: 'IDENTITY_VERIFIED' });
    if (await s.readDialog?.()) throw Error('BAND_DELETE_CONFIRM');
    const press = async (selector: string, label: string, before = async () => {}) => {
      const focus = () => read<{ focused: boolean; backwards: boolean; count: number }>(s, `const es=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(selector)})).filter(e=>visible(e)&&!e.disabled&&(e.textContent||'').trim()===${JSON.stringify(label)}));
        if(es.length!==1)throw Error('BAND_DELETE_CONTROL');const all=docs.flatMap(({d})=>Array.from(d.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')).filter(e=>visible(e)&&!e.disabled&&e.tabIndex>=0));
        const t=all.indexOf(es[0]),a=all.findIndex(e=>e===e.ownerDocument.activeElement),n=all.length;
        return{focused:docs.some(({d})=>d.activeElement===es[0]),backwards:a>=0&&t>=0&&t<a,count:n};`);
      await identity();
      let found = false;
      for (let i = 0; i < 400; i++) {
        const state = await focus();
        if (state.focused) { found = true; break; }
        if (i > state.count + 2) break;
        await s.pressKey({ key: 'Tab', ...(state.backwards ? { modifiers: 8 } : {}) });
      }
      if (!found) throw Error('BAND_DELETE_CONTROL');
      await sleep(300);
      let checked = false;
      await s.pressKey({ key: 'Enter' }, async () => {
        await identity();
        if (!(await focus()).focused) throw Error('BAND_DELETE_CONTROL');
        await before(); checked = true;
      });
      // A host that ignores the callback cannot arm a destructive request.
      if (!checked) throw Error('BAND_DELETE_CONTROL');
    };
    await press(`${root} button._btnPostMore`, '글 옵션');
    log({ code: 'MENU_OPEN' });
    const menu = 'ul.modalMoreMenu._optionContainer';
    await waitFor(() => read<boolean>(s, `const ms=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(menu)}))).filter(visible);return ms.length===1&&Array.from(ms[0].querySelectorAll('button')).some(e=>(e.textContent||'').trim()==='글 수정');`), 5000);
    try { await press(`${menu} button._menuLink`, '삭제하기'); }
    catch (e) { if (!(await s.readDialog?.())) throw e; }
    const dialog = await s.readDialog?.();
    log({ code: 'DELETE_SELECTED' });
    const arm = async () => { log({ code: 'CONFIRM_VERIFIED' }); attempted = true; armed = true; log({ code: 'ARMED' }); };
    if (dialog) {
      if (dialog.kind !== 'confirm' || dialog.message.length > 300 || !dialog.message.includes('삭제') || !s.respondDialog || !await s.readAppFocus()) throw Error('BAND_DELETE_CONFIRM');
      if (dialog.url) { const u = new URL(dialog.url); if (!['band.us', 'www.band.us'].includes(u.hostname) || u.pathname.replace(/\/$/, '') !== `/band/${id.band}/post`) throw Error('BAND_DELETE_CONFIRM'); }
      await arm(); await s.respondDialog(dialog.id, true);
    } else {
      const selector = '[role="alertdialog"], [role="dialog"], .lyWrap, .modalLayerView';
      const confirmed = () => read<string | null>(s, `const message=n=>n.nodeType===3?n.textContent||'':n.nodeType!==1||['BUTTON','A','INPUT'].includes(n.tagName)?'':Array.from(n.childNodes).map(message).join('');
        const ds=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(selector)}))).filter(e=>visible(e)&&message(e).length<500&&message(e).includes('삭제'));
        const matching=ds.filter(e=>{const bs=Array.from(e.querySelectorAll('button')).filter(b=>visible(b)&&!b.disabled);return bs.some(b=>(b.textContent||'').trim()==='취소')&&bs.filter(b=>['삭제','삭제하기','확인'].includes((b.textContent||'').trim())).length===1;});
        const inner=matching.filter(e=>!matching.some(other=>other!==e&&e.contains(other)));if(inner.length!==1)return null;
        return Array.from(inner[0].querySelectorAll('button')).find(b=>visible(b)&&['삭제','삭제하기','확인'].includes((b.textContent||'').trim()))?.textContent.trim()||null;`);
      const label = await waitFor(confirmed, 5000);
      await press(`${selector.split(', ').map(x => `${x} button`).join(', ')}`, label, async () => { if (await confirmed() !== label) throw Error('BAND_DELETE_CONFIRM'); await arm(); });
    }
    await waitFor(async () => success, timeoutMs);
    if (!sent || await session.refresh()) { log({ code: 'UNCERTAIN' }); return { status: 'uncertain' }; }
    log({ code: 'FEED_ABSENT' });
    if (await session.refresh() || !await session.verifyGone()) { log({ code: 'UNCERTAIN' }); return { status: 'uncertain' }; }
    if (review) { if (await session.refresh()) throw Error('BAND_DELETE_IDENTITY'); session.reviewFeed(); await review(s); }
    log({ code: 'DELETED' });
    return { status: 'deleted' };
  } catch (e) {
    const error = e instanceof Error ? e.message : '';
    const code: BandDeleteCode = error === 'BAND_DELETE_IDENTITY' ? 'IDENTITY_REJECTED' : error === 'BAND_DELETE_CONTROL' ? 'CONTROL_REJECTED' : error === 'BAND_DELETE_CONFIRM' ? 'CONFIRM_REJECTED' : error === 'OBSERVATION_TIMEOUT' ? 'TIMEOUT' : /^BAND_RECORD_READ_/.test(error) ? 'READ_FAILED' : 'UNEXPECTED_FAILURE';
    log({ code }); log({ code: attempted ? 'UNCERTAIN' : 'NOT_STARTED' });
    return { status: attempted ? 'uncertain' : 'not_started' };
  }
  finally { armed = false; log({ code: 'DISARMED' }); await session?.close().catch(() => {}); }
}
