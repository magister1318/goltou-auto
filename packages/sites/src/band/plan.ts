// Reference: ../refs/golfliat/programs/golfliat-workbench/electron/renderer.js, fillBandComposerInWebview (readback and file input selectors only).
import type { Surface, SurfaceDialog, SurfaceHost } from '@goltou/surface';
import { click, compact, point, read, waitFor } from '../dom';
import { closeComposer, confirmBandPhotos, listBands } from './index';
import { PhotoOrder, type PhotoProof, type PhotoSize, type PhotoSlot } from './photos';

export const bandMobileUA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
export const bandEditor = 'textarea._postTextArea, .cke_editable[contenteditable="true"], [contenteditable="true"][role="textbox"]';
export interface BandPlan {
  channel: 'blog' | 'band';
  steps: ({ kind: 'text'; role: string; text: string } | { kind: 'break' } | { kind: 'photos'; urls: string[] } | { kind: 'table'; role: string; rows: string[][] })[];
}
export interface BandReadback { body: string; photos: string[]; slots: PhotoSlot[]; uploading: boolean; photoProof?: PhotoProof; composer: boolean; postUrl: string | null; photoLimit: number | null; textLimit: number | null }
export interface BandChoice { key: string; name: string; photoLimit: number | null; observedAt: string | null }
export interface BandProgress { characters: number; totalCharacters: number; photos: number; totalPhotos: number }
export function bandText(plan: BandPlan) {
  return plan.steps.flatMap(s => s.kind === 'text' ? [s.text] : s.kind === 'table' ? s.rows.map(r => r.join(' | ')) : []).join('\n\n');
}
export async function readBandDocument(surface: Surface): Promise<BandReadback> {
  return read(surface, `
    const editors=docs.flatMap(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(bandEditor)}))).filter(visible);
    if(editors.length>1)throw Error('BAND_EDITOR_AMBIGUOUS');
    const e=editors[0];
    const published=docs.flatMap(({d})=>Array.from(d.querySelectorAll('.postView .postTextView, .postView .postBody, .cPost .postMain .postTextView'))).filter(visible);
    const text=n=>{if(n.nodeType===3)return n.textContent||'';if(n.nodeType!==1||n.tagName.toLowerCase()==='band:attachment'||/(^|\\s)(?:_?placeholder)(?:\\s|$)/.test(n.className||''))return '';return Array.from(n.childNodes).map(text).join('')+(n.tagName==='P'||n.tagName==='DIV'||n.tagName==='BR'?'\\n':'');};
    const root=e||published[0];
    const body=e?.tagName==='TEXTAREA'?e.value:root?text(root):'';
    const items=e?docs.flatMap(({d})=>Array.from(d.querySelectorAll('.postAttachItem ._mediaListWrap img.mediaImg, .cke_editable band\\\\:attachment, .cke_editable img, [class*="photoPreview"] img'))):docs.flatMap(({d})=>Array.from(d.querySelectorAll('.postView img.mediaImg, .cPost .postMain img.mediaImg')));
    const unique=items.filter(n=>!(n.tagName==='IMG'&&n.parentElement?.tagName.toLowerCase()==='band:attachment'));
    const slots=unique.map(n=>{const img=n.tagName==='IMG'?n:n.querySelector('img');
      const src=img?.currentSrc||img?.getAttribute('src')||'';
      const width=img?.naturalWidth||0,height=img?.naturalHeight||0;
      return {signature:src?JSON.stringify([src,width,height]):'',width,height,loaded:!!img?.complete&&width>0&&height>0&&!src.startsWith('data:image/svg')};});
    const uploading=docs.some(({d})=>Array.from(d.querySelectorAll('._uploading,.uploading,.uploadProgress,[aria-busy="true"],[role="progressbar"]')).some(visible));
    const photos=unique.map(n=>{
      const img=n.tagName==='IMG'?n:n.querySelector('img');
      const metadata=[n,n.parentElement,n.parentElement?.parentElement,n.parentElement?.parentElement?.parentElement].find(e=>e?.hasAttribute('data-file'))?.getAttribute('data-file')||'';
      const candidates=[n.getAttribute('data-file-name'),n.getAttribute('title'),n.getAttribute('alt'),img?.getAttribute('src'),img?.getAttribute('data-file-name'),img?.getAttribute('alt'),metadata];
      try{candidates.push(decodeURIComponent(metadata));}catch{}
      if(metadata.length%4===0&&new RegExp('^[A-Za-z0-9+/]*={0,2}$').test(metadata)){
        const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        const decoded=Array.from({length:Math.floor(metadata.replace(/=+$/,'').length*6/8)},(_,i)=>{
          const bit=i*8,k=Math.floor(bit/6),value=(alphabet.indexOf(metadata[k])<<12)|(alphabet.indexOf(metadata[k+1])<<6)|Math.max(0,alphabet.indexOf(metadata[k+2]));
          return String.fromCharCode((value>>(10-bit%6))&255);
        }).join('');
        candidates.push(decoded);
      }
      const raw=candidates.join(' ');
      return /goltou-[a-f0-9]{16}-[0-9]+\\.[a-z]+/i.exec(raw)?.[0]||'';
    });
    const file=docs.flatMap(({d})=>Array.from(d.querySelectorAll('input[type="file"]'))).find(n=>/image/.test(n.getAttribute('accept')||''));
    const declared=file?.getAttribute('data-max-count')||file?.getAttribute('max');
    const limitLabels=docs.flatMap(({d})=>Array.from(d.querySelectorAll('.photoCount, .photoLimit, ._photoCount'))).filter(visible).map(n=>n.textContent||'').join(' ');
    const limit=declared&&/^[0-9]+$/.test(declared)?Number(declared):Number(/최대\\s*([0-9]+)\\s*장/.exec(limitLabels)?.[1]||/\\d+\\s*[/]\\s*(\\d+)/.exec(limitLabels)?.[1])||null;
    return {body,photos,slots,uploading,composer:!!e,postUrl:!e&&/[/]band[/][0-9]+[/]post[/][0-9]+[/]?(?:[?#].*)?$/.test(location.pathname)?location.href:null,
      photoLimit:limit&&limit>0?limit:null,textLimit:e?.hasAttribute('maxlength')&&Number(e.getAttribute('maxlength'))>=0?Number(e.getAttribute('maxlength')):null};`);
}
/** A single Band surface is reused for listing, composing and recovery. No new tab on resume. */
export class BandDirectory {
  surface: Surface | undefined;
  choices: BandChoice[] = [];
  private opens = 0;
  constructor(private readonly host: SurfaceHost, readonly baseUrl = 'https://band.us', readonly localPublish = false) {
    const url = new URL(baseUrl);
    if (localPublish && (url.hostname !== '127.0.0.1' || url.protocol !== 'http:')) throw new Error('LOCAL_BAND_REQUIRED');
    if (!localPublish && url.origin !== 'https://band.us') throw new Error('BAND_ORIGIN_REQUIRED');
  }
  async getSurface() { return this.surface ??= await this.host.create('band'); }
  sameOrigin(url: URL) {
    return url.origin === new URL(this.baseUrl).origin || (!this.localPublish && url.origin === 'https://www.band.us');
  }
  async list(): Promise<BandChoice[]> {
    const s = await this.getSurface();
    if ((await readBandDocument(s)).composer) throw new Error('BAND_COMPOSER_ACTIVE');
    await s.open({ url: `${this.baseUrl}/`, session: 'band', width: 1280, height: 900, userAgent: bandMobileUA });
    await this.guard(false);
    const previous = this.choices;
    this.choices = (await listBands(s)).map(b => ({ ...b, photoLimit: previous.find(p => p.key === b.key)?.photoLimit ?? null, observedAt: previous.find(p => p.key === b.key)?.observedAt ?? null }));
    return structuredClone(this.choices);
  }
  async guard(requireComposer: boolean) {
    const s = await this.getSurface();
    if (await s.readDialog?.()) throw new Error('USER_DIALOG_REQUIRED');
    const state = await s.readState();
    const url = new URL(state.url);
    const login = await read<boolean>(s, `return docs.some(({d})=>d.querySelector('input[type="password"]'))||docs.some(({d})=>Array.from(d.querySelectorAll('a,button')).some(n=>visible(n)&&/^(로그인|Log in|Sign in)$/i.test((n.textContent||'').trim())));`);
    if (url.hostname === 'auth.band.us' || login) throw new Error('BAND_LOGIN_LOST');
    if (!this.sameOrigin(url)) throw new Error('BAND_LOCATION_UNCONFIRMED');
    if (requireComposer && !(await readBandDocument(s)).composer) throw new Error('BAND_COMPOSER_LOST');
    if (!requireComposer) {
      try { await waitFor(() => read<boolean>(s, `return docs.some(({d})=>d.querySelector('._myBandListWrap, .globalMyBandWrap, .myBandGroupList, ._btnPostWrite, ._btnOpenWriteLayer, ${bandEditor}'))||docs.some(({d})=>Array.from(d.querySelectorAll('a,button')).some(n=>/로그아웃|log\\s*out/i.test(n.textContent||'')));`)); }
      catch { throw new Error('BAND_LOGIN_UNCONFIRMED'); }
    }
  }
  beforeOpen(key: string) {
    if (!this.choices.some(b => b.key === key)) throw new Error('BAND_NOT_OWNED');
    if (!this.localPublish && this.choices[0]?.key !== key) throw new Error('BAND_FIRST_ONLY');
    // Count attempts before dispatch, including ambiguous responses. Lifetime-wide for this runner.
    if (!this.localPublish && ++this.opens > 3) throw new Error('BAND_COMPOSER_LIMIT');
  }
  observeLimit(key: string, limit: number | null) {
    const choice = this.choices.find(b => b.key === key);
    if (choice) { choice.photoLimit = limit; choice.observedAt = new Date().toISOString(); }
  }
}
export interface BandEnvironment {
  directory: BandDirectory; key: string; check(): void; verify(actual: BandReadback): void; progress(value: BandProgress): void;
  sourceDimensions(file: { url: string; path: string }): Promise<PhotoSize>;
  photoTimeoutMs?: number;
}
const same = (a: BandReadback, b: BandReadback) => compact(a.body) === compact(b.body) && JSON.stringify(a.slots) === JSON.stringify(b.slots);
export class BandExecution {
  private offset = 0;
  private photoAttempted = false;
  private checkpoint: BandReadback | undefined;
  private owned = false;
  private postAttempted = false;
  private discardAttempted = false;
  private restartAllowed = false;
  private verified = false;
  private photoOrder: PhotoOrder | undefined;
  constructor(readonly plan: BandPlan, public files: readonly { url: string; path: string }[], readonly env: BandEnvironment) {
    if (plan.channel !== 'band') throw new Error('BAND_PLAN_REQUIRED');
  }
  get surface() { return this.env.directory.surface; }
  private async guard() {
    this.env.check(); await this.env.directory.guard(true);
    if (!new RegExp(`^/band/${this.env.key}/post/?$`).test(new URL((await this.surface!.readState()).url).pathname)) throw new Error('BAND_TARGET_CHANGED');
  }
  async ensureReady() {
    const s = await this.env.directory.getSurface();
    this.env.check();
    const current = await readBandDocument(s);
    if (this.owned && current.composer) { await this.guard(); return; }
    if (current.composer) throw new Error('BAND_EXISTING_COMPOSER');
    await s.open({ url: `${this.env.directory.baseUrl}/band/${this.env.key}/post`, session: 'band', width: 1280, height: 900, userAgent: bandMobileUA });
    await this.env.directory.guard(false);
    const already = await readBandDocument(s);
    if (already.composer) throw new Error('BAND_EXISTING_COMPOSER');
    this.env.check();
    const mobile = await waitFor(async () => await point(s, 'button.uFloatingButton._btnPostWrite[aria-label="글쓰기"]') ? true : await point(s, 'button._btnPostWrite, button._btnOpenWriteLayer', '글쓰기') ? 'desktop' : null);
    this.env.directory.beforeOpen(this.env.key);
    this.owned = true;
    if (mobile === true) await click(s, 'BAND_WRITE_MOBILE', 'button.uFloatingButton._btnPostWrite[aria-label="글쓰기"]');
    else await click(s, 'BAND_WRITE_DESKTOP', 'button._btnPostWrite, button._btnOpenWriteLayer', '글쓰기');
    await waitFor(async () => (await readBandDocument(s)).composer);
    const empty = await readBandDocument(s);
    if (compact(empty.body) || empty.photos.length) throw new Error('BAND_COMPOSER_NOT_EMPTY');
    this.checkpoint = empty;
    this.offset = 0; this.photoAttempted = false; this.verified = false; this.photoOrder = undefined;
    this.limits(empty);
  }
  private limits(actual: BandReadback) {
    this.env.directory.observeLimit(this.env.key, actual.photoLimit);
    if (actual.photoLimit !== null && this.photoUrls().length > actual.photoLimit) throw new Error('BAND_PHOTO_LIMIT');
    if (actual.textLimit !== null && bandText(this.plan).length > actual.textLimit) throw new Error('BAND_TEXT_LIMIT');
  }
  private photoUrls() { return this.plan.steps.flatMap(s => s.kind === 'photos' ? s.urls : []); }
  allowRestart() { this.restartAllowed = true; }
  resetDiscard() { this.discardAttempted = false; this.restartAllowed = false; }
  async write() {
    this.env.check();
    if (!this.owned || !(await readBandDocument(await this.env.directory.getSurface())).composer) await this.ensureReady();
    await this.guard();
    const s = this.surface!;
    let current = await readBandDocument(s);
    this.limits(current);
    if (this.photoAttempted && this.offset === Array.from(bandText(this.plan)).length) {
      // An ambiguous/failed attachment is never retried or accepted as a count-only prefix.
      current = await this.observe();
      try { this.env.verify(current); this.checkpoint = current; } catch { /* Text edits still require restart consent below. */ }
    }
    if (this.checkpoint && !same(current, this.checkpoint)) {
      if (!this.restartAllowed) throw new Error('BAND_RESTART_REQUIRED');
      await this.discard(); this.restartAllowed = false; this.discardAttempted = false; this.owned = false;
      await this.ensureReady(); current = await readBandDocument(s);
    }
    const text = Array.from(bandText(this.plan));
    await click(s, 'BAND_BODY', bandEditor); await s.pressKey({ key: 'End', modifiers: 2 });
    for (; this.offset < text.length;) {
      await this.guard();
      let end = this.offset;
      while (end < Math.min(this.offset + 32, text.length) && text[end] !== '\n') end++;
      if (end > this.offset) await s.typeText(text.slice(this.offset, end).join(''));
      if (text[end] === '\n') { await s.pressKey({ key: 'Enter' }); end++; }
      // Update only after readback confirms the entire prefix, even when login drops after input.
      current = await readBandDocument(s);
      if (!current.composer || compact(current.body) !== compact(text.slice(0, end).join(''))) { await this.guard(); throw new Error('BAND_INPUT_MISMATCH'); }
      this.offset = end; this.checkpoint = current; this.report(current);
    }
    const urls = this.photoUrls();
    const files = urls.map(url => { const f = this.files.find(f => f.url === url); if (!f) throw new Error('PREPARED_PHOTOS_MISSING'); return f; });
    await this.guard();
    if (files.length && !this.photoAttempted) {
      const sizes = await Promise.all(files.map(file => this.env.sourceDimensions(file)));
      this.photoOrder = new PhotoOrder(urls, sizes);
      if ((await readBandDocument(s)).slots.length) this.photoOrder.fail();
      if (!await read<boolean>(s, `return docs.some(({d})=>d.querySelector('input[type="file"]'));`)) await click(s, 'BAND_PHOTO_BUTTON', 'button,label,a', '사진');
      this.photoAttempted = true;
      for (const [index, file] of files.entries()) {
        await this.guard();
        this.photoOrder.check((await readBandDocument(s)).slots);
        // Record the attempt before dispatch. A lost reply must never attach the file twice.
        await s.attachFiles('input[type="file"][accept*="image"], input[type="file"]', [file.path]);
        await this.settlePhoto(index + 1);
      }
    }
    await this.guard(); current = await this.observe();
    this.checkpoint = current; this.env.verify(current); this.verified = true; this.report(current);
  }
  private async settlePhoto(count: number) {
    const s = this.surface!, order = this.photoOrder!;
    const check = async () => { await this.guard(); order.check((await readBandDocument(s)).slots, true); };
    try {
      // Desktop Band has a separate upload dialog; each invocation contains ONE new file.
      await confirmBandPhotos(s, count, check, 1, this.env.photoTimeoutMs);
      let previous = '', stableSince = Date.now();
      const slots = await waitFor(async () => {
        await check(); const actual = await readBandDocument(s);
        order.check(actual.slots, true);
        const signature = JSON.stringify(actual.slots);
        if (signature !== previous || actual.uploading || actual.slots.some(p => !p.loaded)) { previous = signature; stableSince = Date.now(); }
        return actual.slots.length === count && !actual.uploading && actual.slots.every(p => p.loaded) && Date.now() - stableSince >= 500 ? actual.slots : null;
      }, this.env.photoTimeoutMs ?? 60000);
      order.commit(slots);
      this.checkpoint = await readBandDocument(s); this.report(this.checkpoint);
    } catch (error) {
      if (error instanceof Error && error.message === 'OBSERVATION_TIMEOUT') order.fail();
      throw error;
    }
  }
  /** Only this execution can add the plan URLs after its per-attachment ledger is proven. */
  async observe(): Promise<BandReadback> {
    const actual = await readBandDocument(this.surface!);
    if (actual.composer && this.photoUrls().length) {
      if (!this.photoOrder || actual.uploading || actual.slots.some(s => !s.loaded)) throw new Error('BAND_READBACK_MISMATCH:photos');
      actual.photoProof = this.photoOrder.prove(actual.slots);
    }
    return actual;
  }
  private report(actual: BandReadback) {
    this.env.progress({ characters: this.offset, totalCharacters: Array.from(bandText(this.plan)).length, photos: actual.photos.length, totalPhotos: this.photoUrls().length });
  }
  async stopBeforePost() { await this.guard(); this.env.verify(await this.observe()); if (!this.verified) throw new Error('BAND_NOT_VERIFIED'); await this.show(); }
  async detectPublished() {
    this.env.check();
    if (!this.verified) return null;
    if (await this.dialog()) throw new Error('USER_DIALOG_REQUIRED');
    const actual = await readBandDocument(this.surface!);
    // A closed composer alone is never evidence of publication; require the same band's new post URL and readback.
    if (actual.composer || !actual.postUrl) return null;
    const url = new URL(actual.postUrl);
    if (!this.env.directory.sameOrigin(url) || !new RegExp(`^/band/${this.env.key}/post/[0-9]+/?$`).test(url.pathname)) return null;
    if (!this.verified) throw new Error('BAND_NOT_VERIFIED');
    this.env.verify(actual); return actual.postUrl;
  }
  async publish() {
    const state = await this.surface!.readState();
    if (!this.env.directory.localPublish || new URL(state.url).origin !== new URL(this.env.directory.baseUrl).origin || new URL(state.url).hostname !== '127.0.0.1') throw new Error('REAL_BAND_PUBLISH_DISABLED');
    if (this.postAttempted) { const url = await this.detectPublished(); if (url) return url; throw new Error('BAND_POST_UNCONFIRMED'); }
    await this.guard(); this.env.verify(await this.observe());
    if (!this.verified) throw new Error('BAND_NOT_VERIFIED');
    const control = await point(this.surface!, 'button._btnPostSubmit, button._btnSubmitPost', '완료') ?? await point(this.surface!, 'button._btnPostSubmit, button._btnSubmitPost', '게시');
    if (!control) throw new Error('BAND_POST_CONTROL_MISSING');
    this.postAttempted = true;
    await this.surface!.click(control.x, control.y);
    return waitFor(() => this.detectPublished(), 15000);
  }
  async discard() {
    this.env.check();
    if (!this.owned) throw new Error('BAND_NOT_OWNED_COMPOSER');
    if ((await readBandDocument(this.surface!)).composer && !this.discardAttempted) {
      await this.guard(); this.discardAttempted = true;
      await closeComposer(this.surface!);
    }
    if (await this.dialog()) throw new Error('USER_DIALOG_REQUIRED');
    const after = await readBandDocument(this.surface!);
    if (after.composer || compact(after.body) || after.photos.length || after.postUrl) throw new Error('BAND_DISCARD_UNCONFIRMED');
    this.owned = false; this.verified = false;
  }
  async dialog(): Promise<SurfaceDialog | null> { return await this.surface?.readDialog?.() ?? null; }
  async answerDialog(id: string, accept: boolean) { if (!this.surface?.respondDialog) throw new Error('DIALOG_UNAVAILABLE'); await this.surface.respondDialog(id, accept); }
  async show() { await this.surface?.show(); }
  async hide() { await this.surface?.hide(); }
}
