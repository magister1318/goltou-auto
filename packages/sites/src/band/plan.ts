// Reference: ../refs/golfliat/programs/golfliat-workbench/electron/renderer.js, fillBandComposerInWebview (readback and file input selectors only).
import { bandDomPhotos, createdBandPosts, readFullBandPost, settleFullBandPost, bandBodyIssues, type CreatedBandPost } from './posted';
import { bandPhotoPath, type BandPhotoEvidence } from './photo-path';
import { currentTrace, traceStep, trace, reasonCode, expectedTelemetryRequest, type ReasonCode, type TraceJob } from '@goltou/surface/telemetry';
import { bandListLocation, type BandListDiagnostic } from '../../../surface/src/band-list-diagnostics';
import type { GuardedRequest, Surface, SurfaceDialog, SurfaceHost } from '@goltou/surface';
import { click, compact, point, read, sleep, waitFor } from '../dom';
import { bandListMarkers, isBandListEndpoint, parseBandList, type BandListRow } from './directory-list';
import { closeComposer, confirmBandPhotos, listBands } from './index';
import { PhotoOrder, type PhotoProof, type PhotoSize, type PhotoSlot } from './photos';
import { requestFields } from '../naver-blog/request-fields';
import type { BandBarrierCode } from './barrier-codes';
import { bandReadBatchTarget } from './read-batch';
import { bandFeedResponse, readCreatedBandPost, inspectBandDetailPhotos, bandRecordReadAllowed } from './record-read';
import { tracePhotoSource, type ApiPhotoRead, type PhotoReadFailure } from './photo-read';
import { bandCreateIdentity } from './publish-confirmation';
import { ReadbackMismatch } from '../readback-checks';
import { bandWrite, waitForBandWrite } from './write-control';
import { bandAppPromptFailure, dismissBandAppPrompt } from './app-prompt';

export const bandMobileUA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
export const bandEditor = 'textarea._postTextArea, .postWriteSection textarea, .postWriteSection [contenteditable="true"], .cke_editable[contenteditable="true"], [contenteditable="true"][role="textbox"]';
const bandSubmit = 'button._btnPostSubmit, button._btnSubmitPost, .postWriteSection .topBarGnbActionButtons button._btnPostWrite';
export interface BandPlan {
  channel: 'blog' | 'band';
  steps: ({ kind: 'text'; role: string; text: string; runs?: { href?: string | null }[] } | { kind: 'break' } | { kind: 'photos'; urls: string[] } | { kind: 'table'; role: string; rows: string[][] })[];
}
export interface BandReadback { body: string; photos: string[]; slots: PhotoSlot[]; uploading: boolean; photoProof?: PhotoProof; composer: boolean; postUrl: string | null; photoLimit: number | null; textLimit: number | null }
export interface BandChoice { key: string; name: string; photoLimit: number | null; observedAt: string | null }
export interface BandProgress { characters: number; totalCharacters: number; photos: number; totalPhotos: number; photoUploadMilliseconds?: number; photoUploadSamples?: number; activity?: import('../progress').EngineActivity }
export function bandText(plan: BandPlan) {
  return plan.steps.flatMap(s => s.kind === 'text' ? [s.text] : s.kind === 'table' ? s.rows.map(r => r.join(' | ')) : []).join('\n\n');
}
export function bandPlanLinks(plan: BandPlan) {
  return plan.steps.flatMap(step => step.kind === 'text'
    ? step.role === 'linkCard' ? [step.text] : [...new Set(step.runs?.flatMap(run => run.href ? [run.href] : []) ?? [])] : []);
}
export function hasBandLink(body: string, href: string): boolean {
  return (body.match(/https?:\/\/[^\s]+/g) ?? []).some(text => text === href ||
    text.startsWith(href) && /^[)\]}>.,!?;'"]+$/.test(text.slice(href.length)));
}
export function photoUrls(plan: BandPlan) { return plan.steps.flatMap(s => s.kind === 'photos' ? s.urls : []); }
export async function readBandDocument(surface: Surface): Promise<BandReadback> {
    return traceStep('sites.band.plan.readBandDocument', async () => {
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

    });
  }
/** A single Band surface is reused for listing, composing and recovery. No new tab on resume. */
export class BandDirectory {
  surface: Surface | undefined;
  choices: BandChoice[] = [];
  seedChoices(rows: readonly { key: string; name: string }[]) {
    const previous = this.choices;
    this.choices = rows.map(({ key, name }) => ({ key, name,
      photoLimit: previous.find(p => p.key === key)?.photoLimit ?? null,
      observedAt: previous.find(p => p.key === key)?.observedAt ?? null }));
  }
  /** Only page/route evidence; no request, mutation or alternative target selection. */
  async guardTarget(key: string) {
    const s = await this.getSurface();
    const dialog = await s.readDialog?.();
    const noWrite = /(?:글쓰기|게시|쓰기) 권한이? 없|(?:글을|게시글을) (?:쓸 수 없|작성할 수 없|작성할 수 있는 권한이 없)|no (?:write|posting) permission/i;
    if (dialog) {
      if (noWrite.test(dialog.message)) throw Error('BAND_WRITE_NOT_ALLOWED');
      if (/가입하지|멤버가 아|존재하지|찾을 수 없|not a member|not found/i.test(dialog.message)) throw Error('BAND_TARGET_INVALID');
      throw Error('USER_DIALOG_REQUIRED');
    }
    const state = await s.readState(), url = new URL(state.url);
    if (url.hostname === 'auth.band.us') throw Error('BAND_LOGIN_LOST');
    if (!state.loading && (!this.sameOrigin(url) || url.pathname.replace(/\/$/, '') !== `/band/${key}/post`)) throw Error('BAND_TARGET_INVALID');
    const denied = await read<'permission' | 'membership' | null>(s, `
      const editor=docs.some(({d})=>Array.from(d.querySelectorAll(${JSON.stringify(bandEditor)})).some(visible));
      for(const {d} of docs){
        const buttons=Array.from(d.querySelectorAll(${JSON.stringify(bandWrite)})).filter(visible);
        if(!editor&&buttons.length>0&&buttons.every(b=>b.disabled||b.getAttribute('aria-disabled')==='true'))return 'permission';
        const roots=Array.from(d.querySelectorAll('.errorPage,.errorWrap,.accessDenied,[role="alert"],[role="alertdialog"]'));
        if(!editor)roots.push(...d.querySelectorAll('[role="dialog"],.lyWrap'));
        if(!editor&&!buttons.length&&!d.querySelector('section.postCard,.cPost,.postView'))roots.push(d.body);
        for(const root of roots){
          if(!root||!visible(root))continue;
          const message=root.textContent||'';
          if(new RegExp(${JSON.stringify(noWrite.source)},'i').test(message))return 'permission';
          if(/가입하지 않은 밴드|가입한 멤버만|멤버만 (?:글|이용)|밴드(?:의)? 멤버가 아|탈퇴한 밴드|존재하지 않는 밴드|밴드[가를]? (?:없|찾을 수 없)|삭제된 밴드|not a member|band not found/i.test(message))return 'membership';
        }
      }
      return null;`);
    if (denied === 'permission') throw Error('BAND_WRITE_NOT_ALLOWED');
    if (denied === 'membership') throw Error('BAND_TARGET_INVALID');
  }
  private opens = 0;
  private submit: { key: string; armed: boolean; sent: boolean; succeeded: boolean; received?: boolean; acknowledgedAt?: number; post?: string; onIdentity?: (url: string) => void; blocked?: BandBarrierCode; blockConfirmed: boolean; feedFailure?: PhotoReadFailure } | undefined;
  private codes: BandBarrierCode[] = [];
  private feedPosts: CreatedBandPost[] = [];
  private feedRevision = 0;
  private feedBand = '';
  private feedPhotoFailures = new Map<string, PhotoReadFailure>();
  private listPhase: { job?: TraceJob | undefined; api?: BandListRow[] } | undefined;
  listReason: ReasonCode | undefined;
  get revision() { return this.feedRevision; }
  freshFeed(key: string, before: number) { return this.feedBand === key && this.feedRevision > before; }
  constructor(private readonly host: SurfaceHost, readonly baseUrl = 'https://band.us', readonly localPublish = false, readonly publishEnabled = false, readonly publishAllowance?: { available(): Promise<boolean>; consume(): Promise<boolean> }, private readonly recordBarrierDecision?: (code: BandBarrierCode, expected?: boolean) => void) {
    const url = new URL(baseUrl);
    if (localPublish && (url.hostname !== '127.0.0.1' || url.protocol !== 'http:')) throw new Error('LOCAL_BAND_REQUIRED');
    if (!localPublish && url.origin !== 'https://band.us') throw new Error('BAND_ORIGIN_REQUIRED');
  }
  /** Release this failed attempt's WebView without submitting or editing the composer. */
  async releaseSurface() {
    const surface = this.surface;
    if (surface) await this.host.destroy(surface);
    this.surface = undefined;
    this.submit = undefined;
  }
  async getSurface() {
    return traceStep('sites.band.plan.BandDirectory.getSurface', async () => {
    if (this.surface) return this.surface;
    const surface = await this.host.create('band');
    if (!surface.guardRequests) { await surface.close(); throw new Error('BAND_BARRIER_UNAVAILABLE'); }
    await surface.guardRequests([{ hostname: '*', pathname: '/', prefix: true }], async request => {
      let rejection: BandBarrierCode = 'SURFACE_REQUEST_INVALID';
      const deny = (code: BandBarrierCode, endsApproval = false, expected = false) => {
        rejection = code; return this.reject(code, endsApproval, expected);
      };
      const inspect = async () => {
      const u = new URL(request.url);
      if (this.listPhase && this.isCreateCandidate(u)) return deny('NOT_ARMED', true);
      if (request.method === 'OPTIONS') { this.record('PREFLIGHT_ALLOWED'); return true; }
      if (['GET', 'HEAD'].includes(request.method) && !this.isCreate(u)) {
        if (this.submit && bandFeedResponse(request) && u.searchParams.get('band_no') === this.submit.key) {
          this.submit.feedFailure = { reason: 'PHOTO_RESPONSE_UNOBSERVED' };
        }
        return true;
      }
      const trusted = this.localPublish ? u.origin === new URL(this.baseUrl).origin : u.protocol === 'https:' && (u.hostname === 'band.us' || u.hostname.endsWith('.band.us'));
      if (!trusted) return deny('ORIGIN_BLOCKED', this.isCreateCandidate(u), expectedTelemetryRequest(request));
      if (request.method !== 'POST') return deny('METHOD_BLOCKED', this.isCreateCandidate(u));
      // This wider permission exists only during a membership read, never a composer/submit.
      if (this.listPhase && !this.submit?.armed && !this.isCreateCandidate(u) &&
          (isBandListEndpoint(u) || /^(?:get_|check_|is_|read_|sync_)|^batch$/.test(u.pathname.split('/').at(-1) ?? '')) &&
          !(await readBandDocument(surface)).composer) {
        this.record('LIST_READ_ALLOWED'); return true;
      }
      // Observed on-device: membership is read by this exact POST endpoint.
      // All other writes, including post/create, still fail closed.
      if (u.hostname === 'api-kr.band.us' && u.pathname === '/v2.3.0/get_band_list') { this.record('MEMBERSHIP_ALLOWED'); return true; }
      if (u.origin === 'https://bapi-kr.band.us' && u.pathname === '/v2.0.0/batch') {
        const target = bandReadBatchTarget(request);
        if (!target || !this.choices.some(b => b.key === target.band)) return deny('ROUTE_BLOCKED');
        const current = new URL((await surface.readState()).url);
        if (!this.sameOrigin(current) || !new RegExp(`^/band/${target.band}/post(?:/${target.post})?/?$`).test(current.pathname)) return deny('TARGET_MISMATCH');
        this.record('READ_BATCH_ALLOWED'); return true;
      }
      // Observed mobile photo upload; this host/path cannot create a post.
      if (u.hostname === 'up.band.us' && u.pathname === '/v3/upload_photo') { this.record('UPLOAD_ALLOWED'); return true; }
      // Uploads are allowed; every other mutation fails closed until the single submit.
      if (/\/(?:photo|file)\/upload(?:\/[a-z0-9_-]+)?$/i.test(u.pathname)) { this.record('UPLOAD_ALLOWED'); return true; }
      const isCreate = this.isCreate(u);
      const submit = this.submit;
      if (!isCreate) return deny('ROUTE_BLOCKED', this.isCreateCandidate(u), expectedTelemetryRequest(request));
      if (submit?.sent) return deny('ALREADY_SENT');
      if (!submit?.armed) return deny('NOT_ARMED');
      if (!request.postDataComplete) return deny(request.postDataFailure ? `BODY_${request.postDataFailure}` : 'BODY_INCOMPLETE', true);
      try {
        const parsed = requestFields(request);
        const targets = parsed.fields.filter(([key]) => key === 'band_key' || key === 'band_no');
        if (!targets.length) return deny('TARGET_MISSING', true);
        if (targets.length !== 1) return deny('TARGET_DUPLICATE', true);
        // Observed mobile create form uses band_no. Accept that alias only on
        // this exact route/encoding; both aliases together remain ambiguous.
        if (targets[0]![0] === 'band_no' && !(u.origin === 'https://api-kr.band.us' &&
          u.pathname === '/v2.0.2/create_post' && parsed.encoding === 'form')) return deny('TARGET_MISSING', true);
        const value = targets[0]![1].value;
        if (typeof value !== 'string' && typeof value !== 'number') return deny('TARGET_TYPE', true);
        if (String(value) !== submit.key) return deny('TARGET_MISMATCH', true);
      } catch (error) { trace('sites.band.plan.BandDirectory.getSurface', 'fail', { reason: reasonCode(error) });
        return deny(error instanceof Error && error.message === 'REQUEST_ENCODING_UNKNOWN' ? 'BODY_ENCODING' : 'BODY_PARSE', true);
      }
      submit.armed = false; submit.sent = true; this.record('CREATE_ALLOWED'); return true;
      };
      const allowed = await inspect();
      if (!allowed) this.listRejected(request, rejection);
      return allowed;
    }, response => {
      if (this.listPhase && ['GET', 'POST'].includes(response.method ?? '') && response.url && isBandListEndpoint(new URL(response.url))) {
        const rows = response.status >= 200 && response.status < 300 ? parseBandList(response.body ?? '') : undefined;
        if (rows) this.listPhase.api = rows;
        this.listPhase.job?.line('band.list.api', 'ok', { reason: rows ? 'BAND_LIST_API_CAPTURED' : 'BAND_LIST_API_INVALID', bandList: { apiCaptured: !!rows, apiRows: rows?.length ?? 0 } });
        return;
      }
      if (response.url && bandFeedResponse({ method: response.method ?? '', url: response.url })) {
        const band = new URL(response.url).searchParams.get('band_no');
        if (band) {
          const failures = new Map<string, PhotoReadFailure>();
          try {
            this.feedPosts = createdBandPosts(response.body, band, (url, failure) => failures.set(url, failure));
            this.feedPhotoFailures = failures;
            this.feedBand = band; this.feedRevision++;
            if (this.submit?.key === band) delete this.submit.feedFailure;
          } catch (error) {
            if (this.submit?.key === band) this.submit.feedFailure = {
              reason: response.status >= 200 && response.status < 300 ? 'PHOTO_PARSE_FAILED' : 'PHOTO_RESPONSE_REJECTED',
              counts: { status: response.status },
            };
            throw error;
          }
        }
        return;
      }
      if (!this.submit?.sent || response.method !== 'POST' || !response.url || !this.isCreate(new URL(response.url))) return;
      try {
        const value = bandCreateIdentity(response.body, this.submit.key, detail => {
          trace('band.confirm.response', 'wait', { check: 'identity', ...detail });
        });
        this.submit.received = true; this.submit.acknowledgedAt = Date.now();
        this.submit.succeeded = response.status >= 200 && response.status < 300 && value.succeeded;
        trace('barrier', this.submit.succeeded ? 'ok' : 'fail', { reason: this.submit.succeeded ? 'BAND_PUBLISH_RESPONSE_OK' : 'RESPONSE_REJECTED', counts: { status: response.status } });
        if (this.submit.succeeded && value.post) {
          this.submit.post = value.post;
          this.submit.onIdentity?.(`${this.baseUrl}/band/${this.submit.key}/post/${value.post}`);
        }
        trace('band.confirm.response', this.submit.post ? 'ok' : 'wait', { reason: this.submit.post ? 'BAND_RESPONSE_IDENTITY' : 'BAND_RESPONSE_NO_IDENTITY', counts: { expected: 1, observed: this.submit.post ? 1 : 0 } });
      } catch {
        trace('band.confirm.response', 'fail', { check: 'identity', reason: 'BODY_PARSE', counts: { expected: 1, observed: 0, status: response.status } });
        this.submit.succeeded = false;
      }
    }, request => !!this.listPhase && ['GET', 'POST'].includes(request.method) && isBandListEndpoint(new URL(request.url)) || request.method === 'POST' && this.isCreate(new URL(request.url)) || bandFeedResponse(request), (request, reason) => {
      if (this.submit && request && bandFeedResponse(request) && new URL(request.url).searchParams.get('band_no') === this.submit.key) {
        this.submit.feedFailure = { reason };
      }
      if (reason !== 'INSPECTOR_DENIED') {
        const code = reason === 'STATIC_BLOCK' ? 'SURFACE_STATIC_BLOCK' : reason === 'INSPECTOR_ERROR' ? 'SURFACE_INSPECTOR_ERROR' : 'SURFACE_REQUEST_INVALID';
        this.listRejected(request, code);
        if (request && ['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !this.isCreate(new URL(request.url))) return;
        this.reject(code, !request || this.isCreateCandidate(new URL(request.url)));
      }
      if (this.submit?.blocked && !this.submit.sent) { this.submit.blockConfirmed = true; this.record('BLOCK_CONFIRMED'); }
    });
    // Membership responses are optional read evidence; publication still requires proof.
    this.surface = surface; return surface;

    });
  }
  private isCreate(url: URL) {
    return this.localPublish ? url.origin === new URL(this.baseUrl).origin && url.pathname === '/band-post-create'
      : url.origin === 'https://api-kr.band.us' &&
        (url.pathname === '/v2.0.2/create_post' || /^\/v[0-9.]+\/band\/post\/create$/.test(url.pathname));
  }
  private isCreateCandidate(url: URL) {
    // Diagnosis/closure only; this never grants a route permission.
    return this.isCreate(url) || /\/(?:create_post|band\/post\/create)(?:\/|$)/.test(url.pathname) || url.pathname === '/band-post-create';
  }
  private record(code: BandBarrierCode, expected = false) {
    this.codes.push(code); if (this.codes.length > 128) this.codes.shift();
    try { this.recordBarrierDecision?.(code, expected); } catch { /* Diagnostics cannot authorize or retry a request. */ }
  }
  private listRejected(request: GuardedRequest | undefined, code: BandBarrierCode) {
    this.listPhase?.job?.line('band.list.request', 'ok', { reason: code, connection: bandListLocation(request?.url ?? ''),
      bandList: { method: (request?.method ?? 'other') as NonNullable<BandListDiagnostic['method']> } });
  }
  private reject(code: BandBarrierCode, endsApproval = false, expected = false): false {
    this.record(code, expected);
    // A rejected create ends this approval; unrelated denied writes do not spend it.
    if (endsApproval && this.submit?.armed && !this.submit.sent) { this.submit.armed = false; this.submit.blocked = code; }
    return false;
  }
  get decisionCodes(): BandBarrierCode[] { return [...this.codes]; }
  allowanceConsumed() { this.record('ALLOWANCE_CONSUMED'); }
  arm(key: string, onIdentity?: (url: string) => void) { this.submit = { key, armed: true, sent: false, succeeded: false, blockConfirmed: false, ...(onIdentity ? { onIdentity } : {}) }; this.record('ARMED'); }
  disarm() { if (this.submit) { this.submit.armed = false; delete this.submit.onIdentity; } this.record('DISARMED'); }
  blockedBeforeSend(key: string) { return this.submit?.key === key && !this.submit.sent && this.submit.blockConfirmed ? `BAND_POST_BLOCKED:${this.submit.blocked!}` : undefined; }
  submitted(key: string) { return this.submit?.key === key && this.submit.sent && this.submit.succeeded; }
  responseResult(key: string) { return this.submit?.key === key ? { received: !!this.submit.received, succeeded: this.submit.succeeded, at: this.submit.acknowledgedAt } : undefined; }
  readCreated(match: Parameters<typeof readCreatedBandPost>[1], timeoutMs: number, check: () => void) { return readCreatedBandPost(this.host, match, timeoutMs, check); }
  createdReceipt(key: string) { return this.submitted(key) && this.submit?.post ? `${this.baseUrl}/band/${key}/post/${this.submit.post}` : undefined; }
  existingTitle(title: string) { return this.feedPosts.some(post => post.body.split('\n')[0] === title); }
  createdPost(title: string, after: number): CreatedBandPost | undefined {
    const candidates = this.feedPosts.filter(post => post.owned && post.body.split('\n')[0] === title && post.createdAt >= after - 5000 && post.createdAt <= Date.now() + 5000);
    if (candidates.length !== 1 || !this.submit?.succeeded || this.submit.post && this.submit.post !== new URL(candidates[0]!.url).pathname.split('/').at(-1)) return;
    this.submit.post = new URL(candidates[0]!.url).pathname.split('/').at(-1)!; return candidates[0];
  }
  matchesPost(url: string) { return this.submit?.post === new URL(url).pathname.split('/').filter(Boolean).at(-1); }
  sameOrigin(url: URL) {
    return url.origin === new URL(this.baseUrl).origin || (!this.localPublish && url.origin === 'https://www.band.us');
  }
  async openPublishedView(url: string, mobile: boolean, expected: number, readPost: (view: Surface, detailPhotos: () => BandPhotoEvidence[] | undefined) => Promise<void>) {
    const identity = new URL(url);
    if (!this.sameOrigin(identity) || !/^\/band\/\d+\/post\/\d+$/.test(identity.pathname)) {
      trace('verification', 'fail', { check: 'identity', reason: 'BAND_LOCATION_UNCONFIRMED', counts: { expected: 1, observed: 0 } });
      throw Error('BAND_LOCATION_UNCONFIRMED');
    }
    const [, , band, , post] = identity.pathname.split('/');
    const view = await this.host.create('band');
    const detailBatch = (request: Pick<GuardedRequest, 'method' | 'url'>) => {
      const endpoint = new URL(request.url);
      return request.method === 'POST' && endpoint.origin === 'https://bapi-kr.band.us' && endpoint.pathname === '/v2.0.0/batch';
    };
    const source = 'band.photo.detail_api', attempt = mobile ? 2 : 1;
    let photos: BandPhotoEvidence[] | undefined;
    let failure: PhotoReadFailure | undefined = { reason: 'PHOTO_REQUEST_UNOBSERVED' };
    let denied: ReasonCode | undefined;
    const reportedBlocks = new Set<ReasonCode>();
    trace(source, 'start', { counts: { expected, attempt } });
    try {
      if (!view.guardRequests) throw Error('BAND_BARRIER_UNAVAILABLE');
      await view.guardRequests([{ hostname:'*', pathname:'/', prefix:true }], request => {
        if (bandRecordReadAllowed(request)) return true;
        if (!detailBatch(request)) return false;
        const batch = bandReadBatchTarget(request);
        if (batch?.band !== band || batch?.post !== post) {
          denied = batch ? 'TARGET_MISMATCH' : 'ROUTE_BLOCKED';
          return false;
        }
        if (failure?.reason === 'PHOTO_REQUEST_UNOBSERVED') {
          trace(source, 'wait', { reason: 'REQUEST_ALLOWED', counts: { expected, observed: 0, attempt } });
        }
        failure = { reason: 'PHOTO_RESPONSE_UNOBSERVED' };
        return true;
      }, response => {
        if (!response.url || !detailBatch({ url: response.url, method: response.method ?? '' })) return;
        if (response.status < 200 || response.status >= 300) {
          failure = { reason: 'PHOTO_RESPONSE_REJECTED', counts: { status: response.status } };
          return;
        }
        const result = inspectBandDetailPhotos(response.body, url);
        photos = 'photos' in result ? result.photos : undefined;
        failure = 'reason' in result ? { ...result, counts: { ...result.counts, status: response.status } } : undefined;
      }, detailBatch, (request, reason) => {
        if (!request || !detailBatch(request)) return;
        const code = reason === 'INSPECTOR_DENIED' ? denied ?? reason : reason;
        failure = { reason: code };
        if (!reportedBlocks.has(code)) tracePhotoSource(source, expected, 0, failure, attempt);
        reportedBlocks.add(code);
      });
      await view.open({ url, session:'band', width:1280, height:900, userAgent:mobile ? bandMobileUA :
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
      await dismissBandAppPrompt(view, url);
      await readPost(view, () => photos);
    } finally {
      try {
        const count = photos?.length ?? 0;
        tracePhotoSource(source, expected, count, photos ? (count === expected ? undefined : { reason: 'PHOTO_COUNT_MISMATCH' }) : failure, attempt);
      } finally { await this.host.destroy(view); }
    }
  }
  publishedFeedPhotos(url: string, expected: number, submittedAt: number): ApiPhotoRead {
    // The mobile feed may cap both fields at its preview size. It can confirm a
    // full match, while a short feed alone cannot prove an attachment missing.
    const candidates = this.feedPosts.filter(post => post.url === url);
    const owned = candidates.filter(post => post.owned);
    const matches = owned.filter(post => post.createdAt >= submittedAt - 5000);
    if (matches.length > 1) return { reason: 'BAND_POST_IDENTITY_AMBIGUOUS', counts: { expected: 1, observed: matches.length } };
    const post = matches[0];
    if (!post) return this.submit?.feedFailure ?? (candidates.length
      ? { reason: owned.length ? 'BAND_FEED_TIME_MISMATCH' : 'BAND_FEED_OWNER_MISMATCH', counts: { expected: 1, observed: 0 } }
      : { reason: this.feedBand === this.submit?.key ? 'IDENTITY_NOT_FOUND' : 'PHOTO_REQUEST_UNOBSERVED' });
    if (post.photoCount !== expected) return { reason: 'PHOTO_COUNT_MISMATCH', counts: { expected, observed: post.photoCount } };
    return post.apiPhotos ? { photos: post.apiPhotos } : this.feedPhotoFailures.get(url) ?? { reason: 'PHOTO_SOURCE_MISSING' };
  }
  async list(retryRead = true): Promise<BandChoice[]> {
    return traceStep('sites.band.plan.BandDirectory.list', async () => {
      if (this.listPhase) throw new Error('BAND_LIST_IN_PROGRESS');
      this.listReason = undefined;
      const phase: NonNullable<BandDirectory['listPhase']> = { job: currentTrace() };
      let s: Surface | undefined;
      let source: NonNullable<BandListDiagnostic['source']> = 'none';
      const diagnose = async (reason: ReasonCode) => {
        this.listReason = reason;
        const markers = s ? await bandListMarkers(s).catch(() => undefined) : undefined;
        const url = s ? await s.readState().then(v => v.url).catch(() => '') : '';
        phase.job?.line('band.list.result', 'ok', { reason, connection: bandListLocation(url), bandList: {
          legacy: markers?.legacy ?? false, home: markers?.home ?? false, my: markers?.my ?? false,
          loginForm: markers?.loginForm ?? false, tileCount: markers?.tileCount ?? 0,
          apiCaptured: phase.api !== undefined, apiRows: phase.api?.length ?? 0, source,
        } });
      };
      try {
        s = await this.getSurface();
        if (this.submit?.armed || (await readBandDocument(s)).composer) throw new Error('BAND_COMPOSER_ACTIVE');
        this.listPhase = phase;
        const homeUrl = `${this.baseUrl}/`;
        await s.open({ url: homeUrl, session: 'band', width: 1280, height: 900, userAgent: bandMobileUA });
        await this.guard(false);
        await dismissBandAppPrompt(s, homeUrl);
        const deadline = Date.now() + 15000;
        let rows: BandListRow[];
        try {
          rows = await listBands(s, Math.max(1, deadline - Date.now()));
          source = 'DOM';
        } catch (error) {
          if (reasonCode(error) !== 'OBSERVATION_TIMEOUT' && (!(error instanceof Error) || !/^(?:BAND_LIST_INCOMPLETE|CONTROL_NOT_FOUND(?::.*)?)$/.test(error.message))) throw error;
          // The response arrives in parallel with DOM observation. Share its deadline;
          // do not race an uncancelled DOM traversal against the fallback.
          while (phase.api === undefined && Date.now() < deadline) { await this.guard(false); await sleep(250); }
          await this.guard(false);
          if (phase.api !== undefined) { rows = phase.api.filter(row => row.writable !== false); source = 'API'; }
          else {
            const markers = await bandListMarkers(s);
            throw new Error(!markers.legacy && !markers.home && !markers.my ? 'BAND_HOME_UNRECOGNIZED'
              : !markers.tileCount ? 'BAND_LIST_EMPTY' : 'BAND_LIST_INCOMPLETE');
          }
        }
        await this.guard(false);
        const previous = this.choices;
        this.choices = rows.map(b => ({ key: b.key, name: b.name, photoLimit: previous.find(p => p.key === b.key)?.photoLimit ?? null, observedAt: previous.find(p => p.key === b.key)?.observedAt ?? null }));
        await diagnose(!rows.length ? 'BAND_LIST_EMPTY' : source === 'DOM' ? 'BAND_LIST_DOM' : 'BAND_LIST_API_ONLY');
        return structuredClone(this.choices);
      } catch (error) {
        await diagnose(reasonCode(error));
        trace('sites.band.plan.BandDirectory.list', 'fail', { reason: reasonCode(error) });
        // Preserve a composer and its surface; only damaged read surfaces can retry.
        if (s && !(error instanceof Error && error.message === 'BAND_COMPOSER_ACTIVE')) {
          this.surface = undefined; this.choices = [];
          this.listPhase = undefined;
          await this.host.destroy(s).catch(() => {});
          if (retryRead && error instanceof Error && /^(?:SURFACE_DRAFT_BARRIER_FAILED(?::[A-Z_]+)?|SURFACE_NAVIGATION_TIMEOUT)$/.test(error.message)) {
            trace('sites.band.plan.BandDirectory.list', 'retry', { counts: { attempt: 2 } }); return this.list(false);
          }
        }
        throw error;
      } finally { if (this.listPhase === phase) this.listPhase = undefined; }
    });
  }
  async guard(requireComposer: boolean) {
    return traceStep('sites.band.plan.BandDirectory.guard', async () => {
    const s = await this.getSurface();
    if (await s.readDialog?.()) throw new Error('USER_DIALOG_REQUIRED');
    const state = await s.readState();
    const url = new URL(state.url);
    const login = await read<boolean>(s, `return docs.some(({d})=>d.querySelector('input[type="password"]'))||docs.some(({d})=>Array.from(d.querySelectorAll('a,button')).some(n=>visible(n)&&/^(로그인|Log in|Sign in)$/i.test((n.textContent||'').trim())));`);
    if (url.hostname === 'auth.band.us' || login) throw new Error('BAND_LOGIN_LOST');
    if (!this.sameOrigin(url)) throw new Error('BAND_LOCATION_UNCONFIRMED');
    if (requireComposer && !(await readBandDocument(s)).composer) throw new Error('BAND_COMPOSER_LOST');
    if (!requireComposer && !this.listPhase) {
      try { await waitFor(() => read<boolean>(s, `return docs.some(({d})=>d.querySelector('._myBandListWrap, .globalMyBandWrap, .myBandGroupList, ._btnPostWrite, ._btnOpenWriteLayer, ${bandEditor}'))||docs.some(({d})=>Array.from(d.querySelectorAll('a,button')).some(n=>/로그아웃|log\\s*out/i.test(n.textContent||'')));`), undefined, { surface: s, control: "BAND_SESSION" }); }
      catch { trace('sites.band.plan.BandDirectory.guard', 'fail', { reason: 'CAUGHT_FAILURE' });  throw new Error('BAND_LOGIN_UNCONFIRMED'); }
    }

    });
  }
  beforeOpen(key: string) {
    if (!this.choices.some(b => b.key === key)) throw new Error('BAND_NOT_OWNED');
    if (!this.localPublish && !this.publishEnabled && !this.publishAllowance && this.choices[0]?.key !== key) throw new Error('BAND_FIRST_ONLY');
    // Count attempts before dispatch, including ambiguous responses. Lifetime-wide for this runner.
    if (!this.localPublish && !this.publishEnabled && !this.publishAllowance && ++this.opens > 3) throw new Error('BAND_COMPOSER_LIMIT');
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
  submitTimeoutMs?: number;
  onIdentity?(url: string): Promise<void>;
}
const same = (a: BandReadback, b: BandReadback) => compact(a.body) === compact(b.body) && JSON.stringify(a.slots) === JSON.stringify(b.slots);
export class BandExecution {
  private offset = 0;
  private photoUploadMilliseconds = 0;
  private photoUploadSamples = 0;
  private photoAttempted = false;
  private checkpoint: BandReadback | undefined;
  private owned = false;
  private postAttempted = false;
  private submittedAt = 0;
  private verifiedPublished: string | undefined;
  private createdIdentity: string | undefined;
  private identitySave: Promise<void> | undefined;
  private discardAttempted = false;
  private restartAllowed = false;
  private verified = false;
  private photoOrder: PhotoOrder | undefined;
  private activity: import('../progress').EngineActivity | undefined;
  private signal(value: Omit<import('../progress').EngineActivity, 'channel'>) { this.activity = { channel: 'band', ...value }; this.report(this.checkpoint ?? { photos: [] } as unknown as BandReadback); }
  constructor(readonly plan: BandPlan, public files: readonly { url: string; path: string }[], readonly env: BandEnvironment) {
    if (plan.channel !== 'band') throw new Error('BAND_PLAN_REQUIRED');
  }
  get surface() { return this.env.directory.surface; }
  get hasOwnedComposer() { return this.owned; }
  get createdReceiptUrl() { return this.createdIdentity ?? this.env.directory.createdReceipt(this.env.key); }
  private async guard() {
    return traceStep('sites.band.plan.BandExecution.guard', async () => {
    this.env.check(); await this.env.directory.guardTarget(this.env.key); await this.env.directory.guard(true);
    if (!new RegExp(`^/band/${this.env.key}/post/?$`).test(new URL((await this.surface!.readState()).url).pathname)) throw new Error('BAND_TARGET_CHANGED');

    });
  }
  async ensureReady() {
    return traceStep('sites.band.plan.BandExecution.ensureReady', async () => {
    this.signal({ stage: 'open', phase: 'start' });
    const s = await this.env.directory.getSurface();
    this.env.check();
    const current = await readBandDocument(s);
    if (this.owned && current.composer) { await this.guard(); return; }
    if (current.composer) throw new Error('BAND_EXISTING_COMPOSER');
    const beforeFeed = this.env.directory.revision;
    const feedUrl = `${this.env.directory.baseUrl}/band/${this.env.key}/post`;
    await s.open({ url: feedUrl, session: 'band', width: 1280, height: 900, userAgent: bandMobileUA });
    await this.env.directory.guardTarget(this.env.key);
    await this.env.directory.guard(false);
    if (!this.env.directory.localPublish) await waitFor(async () => { await this.env.directory.guardTarget(this.env.key); return this.env.directory.freshFeed(this.env.key, beforeFeed); }, 20000, { surface: s, control: "BAND_FEED" });
    const already = await readBandDocument(s);
    if (already.composer) throw new Error('BAND_EXISTING_COMPOSER');
    const title = bandText(this.plan).split('\n')[0] ?? '';
    if (!this.env.directory.localPublish && !this.env.directory.publishEnabled && this.env.directory.existingTitle(title)) throw Error('BAND_EXISTING_TEST_POST');
    trace('verification', 'ok', { check: 'identity', counts: { expected: 0, observed: 0 } });
    this.env.check();
    const control = await waitForBandWrite(s, bandEditor, feedUrl, async () => {
      this.env.check();
      await this.env.directory.guardTarget(this.env.key);
    }, this.env.check);
    this.env.directory.beforeOpen(this.env.key);
    await s.click(control.x, control.y, control.recheck);
    try {
      await waitFor(async () => {
        this.env.check();
        await this.env.directory.guardTarget(this.env.key);
        return (await readBandDocument(s)).composer;
      }, undefined, { surface: s, control: "BAND_COMPOSER" });
    } catch (error) {
      if (error instanceof Error && error.message === 'OBSERVATION_TIMEOUT') throw Error('BAND_COMPOSER_UNAVAILABLE');
      throw error;
    }
    this.owned = true;
    const empty = await readBandDocument(s);
    if (compact(empty.body) || empty.photos.length) throw new Error('BAND_COMPOSER_NOT_EMPTY');
    this.checkpoint = empty;
    this.offset = 0; this.photoAttempted = false; this.verified = false; this.photoOrder = undefined;
    this.photoUploadMilliseconds = 0; this.photoUploadSamples = 0;
    this.limits(empty);

    });
  }
  private limits(actual: BandReadback) {
    this.env.directory.observeLimit(this.env.key, actual.photoLimit);
    if (actual.photoLimit !== null && this.photoUrls().length > actual.photoLimit) throw new Error('BAND_PHOTO_LIMIT');
    if (actual.textLimit !== null && bandText(this.plan).length > actual.textLimit) throw new Error('BAND_TEXT_LIMIT');
  }
  private photoUrls() { return photoUrls(this.plan); }
  allowRestart() { this.restartAllowed = true; }
  resetDiscard() { this.discardAttempted = false; this.restartAllowed = false; }
  async write() {
    return traceStep('sites.band.plan.BandExecution.write', async () => {
    this.env.check();
    if (!this.owned || !(await readBandDocument(await this.env.directory.getSurface())).composer) await this.ensureReady();
    await this.guard();
    const s = this.surface!;
    let current = await readBandDocument(s);
    this.limits(current);
    if (this.photoAttempted && this.offset === Array.from(bandText(this.plan)).length &&
        (!this.checkpoint || compact(current.body) === compact(this.checkpoint.body))) {
      // An ambiguous/failed attachment is never retried or accepted as a count-only prefix.
      current = await this.observe();
      try { this.env.verify(current); this.checkpoint = current; } catch { trace('sites.band.plan.BandExecution.write', 'fail', { reason: 'CAUGHT_FAILURE' });  /* Text edits still require restart consent below. */ }
    }
    if (this.checkpoint && !same(current, this.checkpoint)) {
      if (!this.restartAllowed) throw new Error('BAND_RESTART_REQUIRED');
      await this.discard(); this.restartAllowed = false; this.discardAttempted = false; this.owned = false;
      await this.ensureReady(); current = await readBandDocument(s);
    }
    const text = Array.from(bandText(this.plan));
    const textSteps = this.plan.steps.map((step, index) => ({ step, index })).filter(v => v.step.kind === 'text' || v.step.kind === 'table');
    await click(s, 'BAND_BODY', bandEditor); await s.pressKey({ key: 'End', modifiers: 2 });
    for (; this.offset < text.length;) {
      await this.guard();
      let end = this.offset;
      while (end < Math.min(this.offset + 32, text.length) && text[end] !== '\n') end++;
      if (end > this.offset) await s.typeText(text.slice(this.offset, end).join(''));
      if (text[end] === '\n') { await s.pressKey({ key: 'Enter' }); end++; }
      // Update only after readback confirms the entire prefix, even when login drops after input.
      current = await readBandDocument(s);
      if (!current.composer) { await this.guard(); throw new Error('BAND_INPUT_MISMATCH:input'); }
      const issues = bandBodyIssues(text.slice(0, end).join(''), current.body);
      if (issues.length) { await this.guard(); throw new ReadbackMismatch('BAND_INPUT_MISMATCH:' + [...new Set(issues.map(issue=>issue.field))].join(','), issues); }
      this.offset = end; this.checkpoint = current; this.report(current);
      let start = 0;
      for (const { step, index } of textSteps) {
        const length = Array.from(step.kind === 'text' ? step.text : step.kind === 'table' ? step.rows.map(r => r.join(' | ')).join('\n\n') : '').length;
        if (this.offset >= start) this.signal({ stage: 'write', phase: this.offset >= start + length ? 'finish' : 'progress', blockIndex: index, blockTotal: this.plan.steps.length, blockKind: step.kind === 'text' && step.role === 'title' ? 'title' : step.kind === 'text' && step.role === 'hashtags' ? 'tags' : 'paragraph', fraction: Math.min(1, (this.offset - start) / Math.max(1, length)) });
        start += length + 2;
      }
    }
    const urls = this.photoUrls();
    const files = urls.map(url => { const f = this.files.find(f => f.url === url); if (!f) throw new Error('PREPARED_PHOTOS_MISSING'); return f; });
    await this.guard();
    if (files.length && !this.photoAttempted) {
      const sizes = await Promise.all(files.map(file => this.env.sourceDimensions(file)));
      this.photoOrder = new PhotoOrder(urls, sizes);
      const before = (await readBandDocument(s)).slots.length;
      if (before) this.photoOrder.fail('PHOTO_COUNT_MISMATCH', { expected: 0, observed: before });
      if (!await read<boolean>(s, `return docs.some(({d})=>d.querySelector('input[type="file"]'));`)) await click(s, 'BAND_PHOTO_BUTTON', 'button,label,a', '사진');
      this.photoAttempted = true;
      for (const [index, file] of files.entries()) {
        this.signal({ stage: 'write', phase: 'start', blockKind: 'photos', photoIndex: index, photoTotal: files.length, fraction: 0 });
        await this.guard();
        this.photoOrder.check((await readBandDocument(s)).slots);
        const started = Date.now();
        // Record the attempt before dispatch. A lost reply must never attach the file twice.
        await s.attachFiles('input[type="file"][accept*="image"], input[type="file"]', [file.path]);
        await this.settlePhoto(index + 1);
        this.photoUploadMilliseconds += Date.now() - started; this.photoUploadSamples++;
        this.signal({ stage: 'write', phase: 'finish', blockKind: 'photos', photoIndex: index, photoTotal: files.length, fraction: 1 });
        this.report(this.checkpoint!);
      }
    }
    await this.guard(); current = await this.observe();
    this.checkpoint = current; this.env.verify(current); this.verified = true; this.report(current);

    });
  }
  private async settlePhoto(count: number) {
    return traceStep('sites.band.plan.BandExecution.settlePhoto', async () => {
    const s = this.surface!, order = this.photoOrder!;
    const check = async () => { await this.guard(); order.check((await readBandDocument(s)).slots, true); };
    let loaded = 0;
    try {
      // Desktop Band has a separate upload dialog; each invocation contains ONE new file.
      await confirmBandPhotos(s, count, check, 1, this.env.photoTimeoutMs);
      let previous = '', stableSince = Date.now();
      const slots = await waitFor(async () => {
        await check(); const actual = await readBandDocument(s);
        order.check(actual.slots, true);
        const signature = JSON.stringify(actual.slots);
        loaded = actual.slots.filter(p => p.loaded).length;
        if (signature !== previous || actual.uploading || loaded !== actual.slots.length) { previous = signature; stableSince = Date.now(); }
        return actual.slots.length === count && !actual.uploading && loaded === count && Date.now() - stableSince >= 500 ? actual.slots : null;
      }, this.env.photoTimeoutMs ?? 60000, { surface: s, control: "BAND_UPLOAD_SLOTS" });
      order.commit(slots);
      this.checkpoint = await readBandDocument(s);
    } catch (error) { trace('sites.band.plan.BandExecution.settlePhoto', 'fail', { reason: reasonCode(error) });
      if (error instanceof Error && error.message === 'OBSERVATION_TIMEOUT') order.fail('PHOTO_UPLOAD_NOT_SETTLED', { expected: count, observed: loaded });
      throw error;
    }

    });
  }
  /** Only this execution can add the plan URLs after its per-attachment ledger is proven. */
  async observe(): Promise<BandReadback> {
    return traceStep('sites.band.plan.BandExecution.observe', async () => {
    const actual = await readBandDocument(this.surface!);
    const expected = this.photoUrls().length;
    if (actual.composer && expected) {
      const loaded = actual.slots.filter(s => s.loaded).length;
      if (!this.photoOrder || actual.uploading || loaded !== actual.slots.length) {
        trace('verification', 'fail', { check: 'photos',
          reason: this.photoOrder ? 'PHOTO_UPLOAD_NOT_SETTLED' : 'PHOTO_UPLOAD_PROOF_INVALID',
          counts: { expected, observed: loaded, photoSlots: actual.slots.length } });
        throw new Error('BAND_READBACK_MISMATCH:photos');
      }
      actual.photoProof = this.photoOrder.prove(actual.slots);
    }
    return actual;

    });
  }
  private report(actual: BandReadback) {
    this.env.progress({ characters: this.offset, totalCharacters: Array.from(bandText(this.plan)).length, photos: actual.photos.length, totalPhotos: this.photoUrls().length,
      photoUploadMilliseconds: this.photoUploadMilliseconds, photoUploadSamples: this.photoUploadSamples, ...(this.activity ? { activity: this.activity } : {}) });
  }
  async stopBeforePost() {
    return traceStep('sites.band.plan.BandExecution.stopBeforePost', async () => { await this.guard(); this.env.verify(await this.observe()); if (!this.verified) throw new Error('BAND_NOT_VERIFIED');
    });
  }
  async detectPublished() {
    return traceStep('sites.band.plan.BandExecution.detectPublished', async () => {
    this.env.check();
    if (this.verifiedPublished) return this.verifiedPublished;
    if (!this.verified) return null;
    if (!this.env.directory.localPublish && this.postAttempted) return this.confirmPublished();
    if (await this.dialog()) throw new Error('USER_DIALOG_REQUIRED');
    const actual = await readBandDocument(this.surface!);
    // A closed composer alone is never evidence of publication; require the same band's new post URL and readback.
    if (actual.composer) return null;
    if (!actual.postUrl) return null;
    const url = new URL(actual.postUrl);
    if (!this.env.directory.sameOrigin(url) || !new RegExp(`^/band/${this.env.key}/post/[0-9]+/?$`).test(url.pathname)) return null;
    if (!this.verified) throw new Error('BAND_NOT_VERIFIED');
    this.env.verify(actual); return actual.postUrl;

    });
  }
  private async confirmPublished(): Promise<string> {
    if (this.verifiedPublished) return this.verifiedPublished;
    const directory = this.env.directory, timeout = this.env.submitTimeoutMs ?? 30000;
    trace('band.confirm.response', 'start');
    try {
      await waitFor(async () => {
        this.env.check();
        const blocked = directory.blockedBeforeSend(this.env.key); if (blocked) throw Error(blocked);
        return directory.responseResult(this.env.key)?.received;
      }, timeout, { surface: this.surface!, control: "BAND_CREATE_RECEIPT" });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'OBSERVATION_TIMEOUT') throw error;
      trace('band.confirm.response', 'wait', { reason: 'BAND_RESPONSE_UNOBSERVED', counts: { expected: 1, observed: 0 } });
    }
    const result = directory.responseResult(this.env.key);
    if (result?.received && !result.succeeded) {
      trace('band.confirm.response', 'fail', { reason: 'BAND_CREATE_REJECTED', counts: { expected: 1, observed: 0 } });
      throw Error('BAND_CREATE_REJECTED');
    }
    const uploaded = this.checkpoint?.slots.map(slot => { try { return JSON.parse(slot.signature)[0] as string; } catch { return ''; } }) ?? [];
    let url = directory.createdReceipt(this.env.key);
    let recoveredPhotos: BandPhotoEvidence[] | undefined;
    if (url) await this.storeIdentity(url);
    const expectedPhotos = this.photoUrls().length;
    const unreadable = uploaded.findIndex(value => !bandPhotoPath(value));
    if (uploaded.length !== expectedPhotos || unreadable >= 0) {
      trace('verification', 'fail', { check: 'photo_order',
        reason: uploaded.length !== expectedPhotos ? 'PHOTO_COUNT_MISMATCH' : 'PHOTO_PATH_UNREADABLE',
        counts: { expected: expectedPhotos, observed: uploaded.length, ...(unreadable >= 0 ? { photoIndex: unreadable + 1 } : {}) } });
      throw new ReadbackMismatch('BAND_PUBLISHED_READBACK_MISMATCH:photo', [{ field: 'photo' }]);
    }
    if (!url) {
      try {
        const post = await directory.readCreated({ band: this.env.key, title: bandText(this.plan).split('\n')[0] ?? '',
          body: bandText(this.plan), uploaded: uploaded.map(bandPhotoPath), after: this.submittedAt - 5000,
          before: (result?.at ?? this.submittedAt + timeout) + 5000 }, timeout, this.env.check);
        url = post?.url;
        if (post?.photos.length === uploaded.length) recoveredPhotos = post.photos;
      } catch (error) {
        this.env.check();
        trace('band.confirm.feed', 'fail', { check: 'identity', reason: reasonCode(error), counts: { expected: 1, observed: 0 } });
        url = directory.createdReceipt(this.env.key);
        if (!url) throw Error(error instanceof Error && error.message === 'BAND_POST_IDENTITY_AMBIGUOUS' ? 'BAND_POST_UNCONFIRMED:IDENTITY_AMBIGUOUS' : 'BAND_POST_UNCONFIRMED:IDENTITY_READ_FAILED');
      }
      // A receipt may arrive while the independent feed is being read.
      const receipt = directory.createdReceipt(this.env.key);
      const latest = directory.responseResult(this.env.key);
      if (latest?.received && !latest.succeeded) throw Error('BAND_CREATE_REJECTED');
      if (receipt && url && receipt !== url) {
        trace('verification', 'fail', { check: 'identity', reason: 'BAND_POST_IDENTITY_AMBIGUOUS', counts: { expected: 1, observed: 2 } });
        throw Error('BAND_POST_UNCONFIRMED:IDENTITY_AMBIGUOUS');
      }
      url = receipt ?? url;
      if (!url) {
        trace('verification', 'fail', { check: 'identity', reason: 'IDENTITY_NOT_FOUND', counts: { expected: 1, observed: 0 } });
        throw Error('BAND_POST_UNCONFIRMED:IDENTITY_NOT_FOUND');
      }
      await this.storeIdentity(url);
    } else {
      trace('band.photo.recovery_feed', 'skip', { reason: 'BAND_RESPONSE_IDENTITY', counts: { photoTotal: expectedPhotos } });
    }
    trace('band.confirm.detail', 'start');
    const expectedUrl = url;
    const expectedPath = new URL(expectedUrl).pathname;
    const inspect = async (mobile: boolean) => {
      const attempt = mobile ? 2 : 1;
      let domFailure: PhotoReadFailure | undefined = { reason: 'PHOTO_SOURCE_MISSING' };
      let domPhotos = 0;
      let cached: ApiPhotoRead | undefined;
      let routeMatches: boolean | undefined;
      trace('band.photo.detail_dom', 'start', { counts: { expected: expectedPhotos, attempt } });
      try {
        await directory.openPublishedView(expectedUrl, mobile, expectedPhotos, async (view, detailPhotos) => {
          await settleFullBandPost(view, bandText(this.plan), uploaded, this.env.check, this.env.submitTimeoutMs ?? 12000, async () => {
            this.env.check();
            if (await view.readDialog?.()) throw Error('USER_DIALOG_REQUIRED');
            const state = new URL((await view.readState()).url);
            const sameRoute = directory.sameOrigin(state) && state.pathname.replace(/\/$/, '') === expectedPath;
            if (routeMatches !== sameRoute) trace('verification', sameRoute ? 'ok' : 'wait', {
              check: 'identity', reason: sameRoute ? 'BAND_RESPONSE_IDENTITY' : 'BAND_DETAIL_ROUTE_MISMATCH',
              counts: { expected: 1, observed: Number(sameRoute), attempt },
            });
            routeMatches = sameRoute;
            domFailure = { reason: sameRoute ? 'PHOTO_SOURCE_MISSING' : 'BAND_DETAIL_ROUTE_MISMATCH' };
            domPhotos = 0;
            if (!sameRoute) return null;
            const actual = await readFullBandPost(view, failure => { domFailure = failure; });
            if (!actual) return null;
            const dom = bandDomPhotos(actual, expectedPhotos);
            domPhotos = dom.readable;
            domFailure = dom.reason ? { reason: dom.reason, counts: { photoSlots: actual.photos.length } } : undefined;
            let apiPhotos = detailPhotos();
            if (apiPhotos === undefined) {
              if (!cached) trace('band.photo.cached_feed', 'start', { counts: { expected: expectedPhotos, attempt } });
              cached = directory.publishedFeedPhotos(expectedUrl, expectedPhotos, this.submittedAt);
              apiPhotos = 'photos' in cached ? cached.photos : recoveredPhotos;
            }
            return apiPhotos ? { ...actual, apiPhotos } : actual;
          }, bandPlanLinks(this.plan));
        });
      } catch (error) {
        if (routeMatches === false) trace('verification', 'fail', {
          check: 'identity', reason: 'BAND_DETAIL_ROUTE_MISMATCH', counts: { expected: 1, observed: 0, attempt },
        });
        if (!(error instanceof ReadbackMismatch)) domFailure = { reason: reasonCode(error) };
        throw error;
      } finally {
        tracePhotoSource('band.photo.detail_dom', expectedPhotos, domPhotos, domFailure, attempt);
        if (!cached) trace('band.photo.cached_feed', 'skip', { reason: 'PHOTO_SOURCE_SKIPPED', counts: { photoTotal: expectedPhotos, attempt } });
        else if ('photos' in cached) tracePhotoSource('band.photo.cached_feed', expectedPhotos, cached.photos.length, undefined, attempt);
        else tracePhotoSource('band.photo.cached_feed', expectedPhotos, 0, cached, attempt);
      }
    };
    try {
      try { await inspect(false); }
      catch (error) {
        this.env.check();
        // An unreadable desktop layout gets one independent mobile detail read.
        // Retain concrete desktop observations without a second navigation.
        if (error instanceof Error && error.message === bandAppPromptFailure) throw error;
        if (error instanceof ReadbackMismatch && error.issues.some(issue => issue.missing || (issue.observed ?? 0) > 0 &&
          !(issue.field === 'photo' && issue.expected !== undefined && issue.observed! < issue.expected))) throw error;
        trace('band.confirm.detail', 'retry', { reason:reasonCode(error) });
        try { await inspect(true); }
        catch (mobileError) {
          this.env.check();
          if (error instanceof ReadbackMismatch && error.issues.some(issue => (issue.observed ?? 0) > 0) &&
            mobileError instanceof ReadbackMismatch && mobileError.issues.every(issue => !issue.missing && !issue.observed)) throw error;
          throw mobileError;
        }
      }
    } catch (error) {
      this.env.check();
      trace('band.confirm.detail', 'fail', { reason: reasonCode(error) });
      if (error instanceof ReadbackMismatch) throw error;
      throw Error('BAND_PUBLISHED_READBACK_UNAVAILABLE');
    }
    this.verifiedPublished = url; trace('band.confirm.detail', 'ok'); return url;
  }
  private storeIdentity(url: string): Promise<void> {
    if (this.createdIdentity === url && this.identitySave) return this.identitySave;
    this.createdIdentity = url;
    this.identitySave = (async () => {
      trace('band.confirm.record', 'start');
      try { await this.env.onIdentity?.(url); }
      catch (error) {
        trace('band.confirm.record', 'fail', { check: 'record', reason: reasonCode(error), counts: { expected: 1, observed: 0 } });
        throw error;
      }
      trace('band.confirm.record', 'ok', { reason: 'BAND_IDENTITY_STORED' });
    })();
    // Response observation cannot await persistence while the request is paused.
    // The publish path awaits the same promise before any verification/success.
    void this.identitySave.catch(() => {});
    return this.identitySave;
  }
  async publish() {
    return traceStep('sites.band.plan.BandExecution.publish', async () => {
    const submitFailure = (reason: ReasonCode): never => {
      trace('verification', 'fail', { check: 'input', reason, selector: 'submit', counts: { expected: 1, observed: 0 } });
      throw Error(reason);
    };
    const state = await this.surface!.readState();
    if (!this.env.directory.localPublish && !this.env.directory.publishEnabled && !this.env.directory.publishAllowance) {
      submitFailure('REAL_BAND_PUBLISH_DISABLED');
    }
    if (!this.env.directory.sameOrigin(new URL(state.url))) {
      trace('verification', 'fail', { check: 'identity', reason: 'BAND_LOCATION_UNCONFIRMED', counts: { expected: 1, observed: 0 } });
      throw Error('REAL_BAND_PUBLISH_DISABLED');
    }
    if (this.postAttempted) {
      const url = this.env.directory.submitted(this.env.key)
        ? await this.detectPublished()
        : null;
      if (url && (!this.env.directory.localPublish || this.env.directory.matchesPost(url))) return url;
      throw new Error(this.env.directory.blockedBeforeSend(this.env.key) ?? 'BAND_POST_UNCONFIRMED');
    }
    await this.guard();
    this.env.verify(await this.observe());
    if (!this.verified) submitFailure('BAND_NOT_VERIFIED');
    const control =
      (await point(
        this.surface!,
        bandSubmit,
        '완료',
      )) ??
      (await point(
        this.surface!,
        bandSubmit,
        '게시',
      ));
    if (!control) return submitFailure('BAND_POST_CONTROL_MISSING');
    try {
      await this.surface!.click(control.x, control.y, async () => {
        await this.guard();
        if (
          !(await this.surface!.readClickTarget?.(
            control.x,
            control.y,
            bandSubmit,
          ))
        )
          submitFailure('BAND_POST_CONTROL_CHANGED');
        if (!this.env.directory.localPublish && !this.env.directory.publishEnabled) {
          if (!(await this.env.directory.publishAllowance?.consume())) submitFailure('REAL_BAND_PUBLISH_DISABLED');
          this.env.directory.allowanceConsumed();
        }
        this.submittedAt = Date.now(); this.postAttempted = true;
        this.signal({ stage: 'submit', phase: 'start', submission: 'publish' });
        this.env.directory.arm(this.env.key, this.env.directory.localPublish ? undefined : url => { void this.storeIdentity(url); });
      });
      if (!this.env.directory.localPublish) return await this.confirmPublished();
      return await waitFor(async () => {
        const blocked = this.env.directory.blockedBeforeSend(this.env.key);
        if (blocked) throw new Error(blocked);
        const url = this.env.directory.submitted(this.env.key)
          ? await this.detectPublished()
          : null;
        return url && this.env.directory.matchesPost(url) ? url : null;
      }, this.env.submitTimeoutMs ?? 30000, { surface: this.surface!, control: "BAND_POST_DETAIL" });
    } catch (error) { trace('sites.band.plan.BandExecution.publish', 'fail', { reason: reasonCode(error) });
      if (!this.postAttempted) throw error;
      if (!this.env.directory.localPublish) throw error;
      throw new Error(this.env.directory.blockedBeforeSend(this.env.key) ?? 'BAND_POST_UNCONFIRMED');
    } finally {
      this.env.directory.disarm();
    }

    });
  }
  async discard() {
    return traceStep('sites.band.plan.BandExecution.discard', async () => {
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

    });
  }
  async dialog(): Promise<SurfaceDialog | null> {
    return traceStep('sites.band.plan.BandExecution.dialog', async () => { return await this.surface?.readDialog?.() ?? null;
    });
  }
  async answerDialog(id: string, accept: boolean) {
    return traceStep('sites.band.plan.BandExecution.answerDialog', async () => { if (!this.surface?.respondDialog) throw new Error('DIALOG_UNAVAILABLE'); await this.surface.respondDialog(id, accept);
    });
  }
  async show() {
    return traceStep('sites.band.plan.BandExecution.show', async () => { await this.surface?.show();
    });
  }
  async hide() {
    return traceStep('sites.band.plan.BandExecution.hide', async () => { await this.surface?.hide();
    });
  }
}
