// Reference: ../refs/DAF/daf3/packages/engine-naver-editor/src/insert/info-table.ts (table toolbar/control selectors only; DOM mutations excluded).
import { traceStep, trace, reasonCode } from '@goltou/surface/telemetry';
import type { GuardedRequest, GuardedResponse, Surface, SurfaceDialog, SurfaceHost } from '@goltou/surface';
import { inputCharacters } from '@goltou/surface';
import { click, compact, point, read, sleep, waitFor } from '../dom';
import { confirmBlogPhotos, prepareBlogEditor } from './index';
import { ControlNotFoundError } from '../control-failure';
import { closeTagLayer, protectBlogInputs, requireTagFocus, requireTagLayerClosed, tagInputSelector, tagPanelToggle } from './draft-safety';
import { finalPublishSelector, guardedPublishClick, inspectPrivateRequest, inspectPublicRequestDecision, postIdentity, readVisibility, requireVisibility, selectVisibility, type BlogVisibility, type PublishedPost, type VisibilityProof } from './publish-safety';
import { parsePublishIdentity, resolvePublishEvidence, type ResponseIdentity, type PublishedPage, type PublishIdentitySource } from './publish-identity';
import { containsServiceLink, tokenText, compareReadbackText, traceReadbackText, sameReadbackNumbers, sameReadbackIdentityText, ReadbackMismatch, type ReadbackIssue } from '../readback-checks';
import { settledReadback, type ReadbackClass } from '../settled-readback';
import { BlogRichTextWriter, blogBodyAtEnd, hasBlogLiteralMarker } from './rich-text';
import { insertBlogTable, tableRowRuns, type BlogTableToken } from './table';
import { BlogFormattingError, blogFieldReason, blogRunReader, normalizeBlogRuns, splitBlogRuns, type BlogRun, type FormattingStage } from './formatting';
import { closeDraftEntries, draftEntries, draftItem, draftSaveReceipt, identifySavedDraft, openDraftEntries, type DraftEntry } from './draft-identity';
import { expectedBlogTags, plannedBlogTags, sameBlogTags, sameServiceBlogTags } from './tags';

/** Structural subset of WP4 InputPlan. Sites has no dependency on core or a device API. */
export interface BlogPlan {
  channel: 'blog' | 'band';
  steps: ({ kind: 'text'; role: string; text: string; runs?: BlogRun[] } | { kind: 'break' } | { kind: 'photos'; urls: string[] } | { kind: 'table'; role: string; rows: string[][]; cellRuns?: BlogRun[][][] })[];
}
export type BlogToken = { kind: 'text'; text: string; runs?: BlogRun[] } | { kind: 'photo'; identity: string } | BlogTableToken;
export interface BlogReadback { title: string; tokens: BlogToken[]; tags: string[]; tagArea?: boolean; visibility?: BlogVisibility | null }
export interface BlogProgress { tableModes?: ('native'|'text-list')[]; characters: number; totalCharacters: number; photos: number; totalPhotos: number; photoUploadMilliseconds?: number; photoUploadSamples?: number; activity?: import('../progress').EngineActivity; ownRecoveryDiscarded?: boolean; blogParagraph?: { blockIndex: number; runs: BlogRun[] }; blogInputReset?: boolean }
export interface BlogEnvironment {
  host: SurfaceHost;
  lastTypedTitle?: { read(): Promise<string | null>; write(title: string): Promise<void> };
  mode?: 'draft' | 'publish';
  visibility?: BlogVisibility;
  publishEnabled?: boolean;
  editorUrl?: string;
  /** Loopback fixtures only. Never bypasses visibility or content verification. */
  localPublish?: boolean;
  /** Loopback timing tests may shorten the deadline; production always uses the generous default. */
  publishedSettleMs?: number;
  /** Debug shell capability, separate from real publish authorization. ALWAYS blocks. */
  publishProbe?: { visibility: BlogVisibility; record(request: GuardedRequest, proof: VisibilityProof | undefined): Promise<void> };
  recordPublishResponse?(response: GuardedResponse): Promise<void>;
  beforeSave(): void;
  check(): void;
  progress(value: BlogProgress): void;
  verify(value: BlogReadback, stage?: FormattingStage): void;
}
const titleSelector = '.se-documentTitle .se-text-paragraph';
const bodySelector = '.se-component.se-text .se-text-paragraph';
const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Read document order, cells and uploaded filenames independently of the input plan. */
export async function readBlogDocument(surface: Surface, documentUrls?: readonly string[], published = false): Promise<BlogReadback> {
    return traceStep('sites.naver-blog.plan.readBlogDocument', async () => {
  return read(surface, `
    ${blogRunReader}
    const allowed=${JSON.stringify(documentUrls ?? null)};
    const d=docs.find(({d})=>(!allowed||allowed.includes(d.location.href))&&d.querySelector('.se-documentTitle'))?.d;
    if(!d) throw Error('LOGIN_OR_EDITOR_LOST');
    const text=e=>{const nodes=Array.from(e.querySelectorAll('.__se-node'));return nodes.length?nodes.map(n=>n.textContent||'').join(''):(e.querySelector('.se-placeholder')?'':e.textContent||'');};
    const main=d.querySelector('.se-main-container')||d.querySelector('.se-content')||d.querySelector('.se-viewer');
    const tokens=[];
    for(const e of main?.querySelectorAll('.se-component')||[]) {
      if(e.classList.contains('se-documentTitle')) continue;
      if(e.classList.contains('se-text')) {
        // The published viewer fills otherwise empty paragraphs with U+200B.
        // Ignore only that standalone filler; preserve every character in real text.
        for(const p of e.querySelectorAll('.se-text-paragraph')) {const runs=paragraphRuns(p),t=runs.map(r=>r.text).join('');if(t.length&&t!=='\u200b') tokens.push({kind:'text',text:t,runs});}
      } else if(e.classList.contains('se-image') || e.classList.contains('se-imageGroup') || e.classList.contains('se-imageStrip')) {
        let nested=false;
        for(let parent=e.parentElement;parent&&parent!==main;parent=parent.parentElement)
          if(parent.classList.contains('se-imageGroup')||parent.classList.contains('se-imageStrip'))nested=true;
        if(nested)continue;
        const containers=Array.from(e.querySelectorAll('.se-module-image,.se-image-placeholder'));
        const images=Array.from(e.querySelectorAll('img')).filter(img=>img.classList.contains('se-image-resource')||containers.some(slot=>slot.contains(img)));
        const slots=Array.from(e.querySelectorAll('img,.se-module-image,.se-image-placeholder')).filter(node=>images.includes(node)||containers.includes(node)&&!node.querySelector('img,.se-module-image,.se-image-placeholder'));
        for(const img of slots) {
          const attributes=['data-lazy-src','data-src','data-original','data-file-name','src','alt'];
          const raw=attributes.flatMap(key=>[img.getAttribute(key),img.parentElement?.getAttribute(key)]).concat(img.currentSrc||'').join(' ');
          const match=/goltou-[a-f0-9]{16}-[0-9]+\\.[a-z]+/i.exec(raw);
          const photo={kind:'photo',identity:match?match[0]:''};
          tokens.push(photo);
        }
      } else if(e.classList.contains('se-table')) {
        const cellRuns=Array.from(e.querySelectorAll('tr')).map(row=>Array.from(row.querySelectorAll('td,th')).map(cell=>Array.from(cell.querySelectorAll('.se-text-paragraph')).flatMap((p,i)=>[...(i?[{text:'\\n',bold:false,href:null}]:[]),...paragraphRuns(p)])));
        tokens.push({kind:'table',rows:cellRuns.map(row=>row.map(runs=>runs.map(r=>r.text).join(''))),cellRuns,
          merged:Array.from(e.querySelectorAll('td,th')).some(cell=>Number(cell.getAttribute('rowspan')||1)!==1||Number(cell.getAttribute('colspan')||1)!==1)});
      } else if(e.classList.contains('se-oglink')) {
        const a=e.querySelector('a[href]'); tokens.push({kind:'text',text:a?.getAttribute('href')||'',runs:[{text:a?.getAttribute('href')||'',bold:false,href:null}]});
      } else { tokens.push({kind:'text',text:'UNSUPPORTED_EDITOR_COMPONENT'}); }
    }
    // The real post page wraps trim; its invocation fails throwOnSideEffect.
    const tags=Array.from(d.querySelectorAll('.wrap_tag a.itemTagfont, .wrap_tag a[href*="TagNaver"], .tag_list .tag, .se-tag-list .se-tag, .post_tag .item, [data-goltou-tag], [class^="tag_textarea__"] span[class*="tag__"][aria-label]')).map(e=>(e.textContent||'').replace(/^#/,'').trimStart().trimEnd()).filter(Boolean);
    const result={title:text(d.querySelector(${JSON.stringify(titleSelector)})).trimStart().trimEnd(),tokens,tags};
    if(${published})result.tagArea=!!d.querySelector('.wrap_tag,.tag_list,.se-tag-list,.post_tag,[class^="tag_textarea__"]')||tags.length>0;
    return result;`);

    });
  }
const same = (a: BlogReadback, b: BlogReadback) => JSON.stringify(a) === JSON.stringify(b);

export function plannedBlogParagraphs(plan: BlogPlan, modes: readonly ('native'|'text-list')[] = []): BlogRun[][] {
  let tableIndex = 0;
  return plan.steps.flatMap(step => {
    if (step.kind === 'table') {
      const fallback = modes[tableIndex++] === 'text-list';
      return step.rows.flatMap((_,r)=>fallback ? splitBlogRuns(tableRowRuns(step,r)).filter(runs=>runs.length>0) : [tableRowRuns(step,r)]);
    }
    if (step.kind !== 'text' || step.role === 'title' || step.role === 'hashtags') return [];
    return splitBlogRuns(step.runs ?? [{ text: step.text }]).filter(runs => runs.length > 0);
  });
}
export function compareBlogFormatting(plan: BlogPlan, actual: BlogReadback, modes: readonly ('native'|'text-list')[] = []): import('./formatting').BlogFormattingIssue[] {
  const expected = plannedBlogParagraphs(plan, modes);
  const saved = actual.tokens.flatMap(t => t.kind === 'text' ? [t] : t.kind === 'table' ? t.rows.map((row, r) => ({ kind: 'text' as const, text: row.join(' | '), runs: tableRowRuns(t, r) })) : []);
  const plannedText = expected.map(runs => runs.map(r => r.text).join(''));
  const observedText = saved.map(t => t.text);
  const result = compareReadbackText(plannedText, observedText);
  traceReadbackText(result);
  const issues: import('./formatting').BlogFormattingIssue[] = result.missing.map(paragraph => ({ paragraph, fields: ['text'] }));
  if (!sameReadbackNumbers(plannedText.join('\n'), observedText.join('\n'))) issues.push({ paragraph: 1, fields: ['number'] });

  const projections = (paragraphs: readonly (readonly BlogRun[])[]) => {
    const bold: { start: number; text: string }[] = [];
    const links: { start: number; text: string; href: string }[] = [];
    const runs = normalizeBlogRuns(paragraphs.flatMap(runs => [...runs, { text: '\n' }]));
    let offset = 0;
    for (const run of runs) {
      const text = tokenText(run.text);
      if (text && run.bold) bold.push({ start: offset, text });
      if (text && run.href) {
        const previous = links.at(-1);
        if (previous?.href === run.href && previous.start + previous.text.length === offset) previous.text += text;
        else links.push({ start: offset, text, href: run.href });
      }
      offset += text.length;
    }
    return { bold, links };
  };
  const planned = projections(expected);
  const observed = projections(saved.map(t => t.runs ?? []));
  trace('verification', 'ok', {
    check: 'bold', reason: JSON.stringify(planned.bold) !== JSON.stringify(observed.bold) ? 'READBACK_BOLD_VARIANCE' : 'READBACK_BOLD',
    counts: { expected: planned.bold.length, observed: observed.bold.length },
  });
  const source = plannedText.join('\n'), output = observedText.join('\n');
  const explicit = [...planned.links];
  for (const link of observed.links) {
    const next = explicit[0];
    if (next?.href === link.href && (source === output ? next.start === link.start && next.text === link.text
      : next.text === link.text || compareReadbackText([next.text], [link.text]).tolerated)) { explicit.shift(); continue; }
    if (!containsServiceLink(output, link) || !tokenText(source).includes(link.text) ||
      planned.links.some(planned => planned.start < link.start + link.text.length && link.start < planned.start + planned.text.length)) {
      issues.push({ paragraph: 1, fields: ['href'] });
      break;
    }
  }
  const cards = plan.steps.flatMap(step => step.kind === 'text' && step.role === 'linkCard' ? [step.text] : []);
  if ((explicit.length || cards.some(url => !observedText.includes(url))) && !issues.some(i => i.fields.includes('href'))) issues.push({ paragraph: 1, fields: ['href'] });
  trace('verification', issues.some(issue => issue.fields.includes('href')) ? 'fail' : 'ok', {
    check: 'links', reason: 'READBACK_LINKS', counts: { expected: planned.links.length + cards.length, observed: observed.links.length + cards.filter(url => observedText.includes(url)).length },
  });
  trace('verification', issues.some(issue => issue.fields.includes('text')) && plannedText.length !== observedText.length ? 'fail' : 'ok', {
    check: 'line_breaks', reason: 'READBACK_TEXT', counts: { expected: Math.max(0, plannedText.length - 1), observed: Math.max(0, observedText.length - 1) },
  });
  return issues;
}

export function blogTablesMatch(plan: BlogPlan, actual: BlogReadback, modes: readonly ('native'|'text-list')[] = []) {
  const expected = plan.steps.filter(step => step.kind === 'table').filter((_, i) => modes[i] !== 'text-list');
  const tables = actual.tokens.filter(token => token.kind === 'table');
  return expected.length === tables.length && expected.every((table, i) => {
    const observed = tables[i]!;
    return !observed.merged && observed.rows.length === table.rows.length && table.rows.every((row, r) => row.length === observed.rows[r]!.length);
  });
}
export function verifyBlogTables(plan: BlogPlan, actual: BlogReadback, modes: readonly ('native'|'text-list')[] = []) {
  const matches = blogTablesMatch(plan, actual, modes);
  trace('verification', matches ? 'ok' : 'fail', { check: 'table', reason: 'READBACK_TABLE', counts: {
    expected: plan.steps.filter(step => step.kind === 'table').filter((_, index) => modes[index] !== 'text-list').length,
    observed: actual.tokens.filter(token => token.kind === 'table').length,
  } });
  if (!matches) throw new ReadbackMismatch('BLOG_READBACK_MISMATCH:table',[{field:'table'}]);
}

export class BlogExecution {
  surface: Surface | undefined;
  private index = 0;
  private executingStep: BlogPlan['steps'][number] | undefined;
  private activity: import('../progress').EngineActivity | undefined;
  private signal(value: Omit<import('../progress').EngineActivity, 'channel'>) { this.activity = { channel: 'blog', ...value }; this.report(); }
  private offset = 0;
  private richWriter: BlogRichTextWriter | undefined;
  private blogParagraph: BlogProgress['blogParagraph'];
  private formattingFailure: BlogFormattingError | undefined;
  private inputFormattingFailure: BlogFormattingError | undefined;
  private verifyDocument(value: BlogReadback, stage: FormattingStage) {
    if (this.formattingFailure) throw this.formattingFailure;
    const tablesMatch = blogTablesMatch(this.plan, value, this.tableModes);
    trace('verification', tablesMatch ? 'ok' : 'wait', { check: 'table', reason: 'READBACK_TABLE', counts: {
      expected: this.plan.steps.filter(step => step.kind === 'table').filter((_, index) => this.tableModes[index] !== 'text-list').length,
      observed: value.tokens.filter(token => token.kind === 'table').length,
    } });
    this.env.verify(value, stage);
    const issues = compareBlogFormatting(this.plan, value, this.tableModes);
    if (issues.length) {
      for (const issue of issues) for (const field of issue.fields) trace('verification', 'fail', { check: field, reason: blogFieldReason[field], counts: { expected: 1, observed: 0, paragraphIndex: issue.paragraph } });
      const error = new BlogFormattingError(stage, issues);
      if (['AFTER_SAVE', 'REOPENED', 'PUBLISHED'].includes(stage)) this.formattingFailure = error;
      throw error;
    }
  }
  private characters = 0;
  private photos = 0;
  private photoUploadMilliseconds = 0;
  private photoUploadSamples = 0;
  readonly readbackTimings: { photos: number; milliseconds: number; navigationKeys: number }[] = [];
  private checkpoint: BlogReadback | undefined;
  get creationState(): 'none' | 'draft_saved' | 'published' | 'uncertain' {
    return this.publishedPost ? 'published' : this.publishAttempted ? 'uncertain' : this.saveAcknowledged || this.draftIdentity ? 'draft_saved' : this.saveAttempted ? 'uncertain' : 'none';
  }
  private saveAttempted = false;
  private draftsBefore: DraftEntry[] = [];
  private saveAcknowledged = false;
  private afterSaveChecked = false;
  private savedDraftId: string | undefined;
  draftIdentity: { existingSameTitle: number; source: 'response-id' | 'list-change' } | undefined;
  private reopened = false;
  private verified = false;
  private recoveryConsent = false;
  private ownRecoveryDiscarded = false;
  private async prepare() {
    return traceStep('sites.naver-blog.plan.BlogExecution.prepare', async () => {
    const lastTypedTitle = await this.env.lastTypedTitle?.read().catch(() => null);
    await prepareBlogEditor(this.surface!, this.env.check, {
      autoRecover: this.recoveryConsent ? 'decline-with-user-consent' : 'stop', lastTypedTitle: lastTypedTitle ?? null,
      onOwnRecoveryDiscarded: () => { this.ownRecoveryDiscarded = true; this.report(); },
    });
    this.recoveryConsent = false;

    });
  }
  private atomic = false;
  private publishInteraction = false;
  private publishArmed = false;
  private publishAttempted = false;
  private requestProof: VisibilityProof | undefined;
  private publishFailure = '';
  private responsePost: ResponseIdentity = { post: null, postId: null };
  private responseEvidence: Promise<void> = Promise.resolve();
  private publishRequestAccepted = false;
  /** Established from unambiguous response or resulting page evidence. Memory only. */
  publishedPost: PublishedPost | undefined;
  publishedIdentitySources: PublishIdentitySource[] = [];
  publishedVerified = false;
  private get visibility() { return this.env.visibility ?? 'public'; }
  readonly tableModes: ('native' | 'text-list')[] = [];
  linkCard: 'off' | 'card' | 'url-text' = 'off';
  private get title() { return this.plan.steps.find(s => s.kind === 'text' && s.role === 'title') as Extract<BlogPlan['steps'][number], { kind: 'text' }>; }
  constructor(readonly plan: BlogPlan, public files: readonly { url: string; path: string }[], private readonly env: BlogEnvironment) {
    if (plan.channel !== 'blog' || !this.title) throw new Error('BLOG_PLAN_REQUIRED');
    if (env.localPublish && (!env.editorUrl || new URL(env.editorUrl).hostname !== '127.0.0.1')) throw new Error('LOCAL_EDITOR_REQUIRED');
    if (env.visibility !== undefined && !['public', 'private'].includes(env.visibility)) throw new Error('BLOG_VISIBILITY_INVALID');
    if (env.publishProbe && (env.mode !== 'publish' || env.publishProbe.visibility !== this.visibility)) throw new Error('BLOG_PROBE_CONFIGURATION_MISMATCH');
  }
  async ensureReady() {
    return traceStep('sites.naver-blog.plan.BlogExecution.ensureReady', async () => {
    this.signal({ stage: 'open', phase: 'start', opening: this.surface ? 'empty' : 'navigate' });
    try {
    if (!this.surface) await this.fresh();
    else {
      await this.guard();
      await this.prepare();
      this.recoveryConsent = false; this.checkpoint = await readBlogDocument(this.surface);
    }
    this.signal({ stage: 'open', phase: 'finish', opening: 'empty' });
    } finally { if (this.surface) await closeTagLayer(this.surface); }

    });
  }
  consentToDiscard() { this.recoveryConsent = true; }
  async dialog(): Promise<SurfaceDialog | null> {
    return traceStep('sites.naver-blog.plan.BlogExecution.dialog', async () => { return await this.surface?.readDialog?.() ?? null;
    });
  }
  async answerDialog(id: string, accept: boolean) {
    return traceStep('sites.naver-blog.plan.BlogExecution.answerDialog', async () => {
    if (!this.surface?.respondDialog) throw new Error('DIALOG_UNAVAILABLE');
    await this.surface.respondDialog(id, accept);

    });
  }
  private async guard() {
    return traceStep('sites.naver-blog.plan.BlogExecution.guard', async () => {
    this.env.check();
    if (await this.dialog()) throw new Error('USER_DIALOG_REQUIRED');
    const ready = await read<boolean>(this.surface!, `return !docs.some(({d})=>d.querySelector('input[type="password"]')||d.location.hostname==='nid.naver.com')&&docs.some(({d})=>d.querySelector('.se-documentTitle'));`);
    if (!ready) throw new Error('LOGIN_OR_EDITOR_LOST');

    });
  }
  private async fresh(readback = false) {
    return traceStep('sites.naver-blog.plan.BlogExecution.fresh', async () => {
    const previous = this.surface;
    this.surface = await this.env.host.create('naver');
    // Loading a saved draft emits documentChanged too. Its three-second
    // autosave debounce must not recreate an unfinished composition during
    // readback or while waiting to publish. Install before navigation and
    // before the publication guard, retaining that guard's response checks.
    if (readback) {
      if (!this.surface.blockRequests) throw new Error('BLOG_READBACK_BARRIER_UNAVAILABLE');
      await this.surface.blockRequests([{ hostname: 'blog.naver.com', pathname: '/RabbitAutoSaveWrite.naver', expected: true }]);
    }
    protectBlogInputs(this.surface, async (x, y) => {
      if (!this.publishInteraction || this.env.mode !== 'publish') return false;
      const proof = await readVisibility(this.surface!, this.visibility);
      if (proof.target && await this.surface!.readClickTarget?.(x, y, proof.target.selector)) return true;
      if (!this.publishArmed || !await this.surface!.readClickTarget?.(x, y, finalPublishSelector)) return false;
      requireVisibility(proof, this.visibility);
      this.requestProof = proof;
      return true;
    });
    if ((this.env.mode ?? 'draft') === 'draft') {
      if (!this.surface.blockRequests) throw new Error('BLOG_DRAFT_BARRIER_UNAVAILABLE');
      // Read-only loaded editor script inspection: new publication and update
      // use RabbitWrite/RabbitUpdate; draft save uses RabbitTempPostWrite/Update.
      await this.surface.blockRequests(['/RabbitWrite.naver', '/RabbitUpdate.naver'].map(pathname => ({ hostname: 'blog.naver.com', pathname })));
    }
    {
      // One guard retains the publication barrier and observes only this save's receipt.
      if (!this.surface.guardRequests) throw new Error('BLOG_REQUEST_BARRIER_UNAVAILABLE');
      const hostname = this.env.localPublish ? new URL(this.env.editorUrl!).hostname : 'blog.naver.com';
      await this.surface.guardRequests(['/RabbitWrite.naver', '/RabbitUpdate.naver', '/RabbitTempPostWrite.naver'].map(pathname => ({ hostname, pathname })), async request => {
        const decision = (allowed: boolean, reason: import('@goltou/surface/telemetry').ReasonCode) => { trace('barrier', allowed ? 'ok' : 'fail', { reason }); return allowed; };
        if (new URL(request.url).pathname === '/RabbitTempPostWrite.naver') {
          const allowed = this.saveAttempted && !readback && request.method === 'POST';
          return decision(allowed, allowed ? 'BLOG_DRAFT_SAVE_REQUEST_ALLOWED' : 'BLOG_DRAFT_SAVE_REQUEST_NOT_AUTHORIZED');
        }
        if ((this.env.mode ?? 'draft') === 'draft') return decision(false, 'BLOG_PUBLISH_REQUEST_NOT_AUTHORIZED');
        const allowedWindow = this.publishArmed; this.publishArmed = false;
        if (this.env.publishProbe) {
          // No inspector result, armed window, method, path or visibility can
          // authorize a probe. Persistence exceptions also leave it blocked.
          this.publishFailure = 'BLOG_PUBLISH_PROBE_BLOCKED';
          try { await this.env.publishProbe.record(request, this.requestProof); }
          catch { trace('sites.naver-blog.plan.BlogExecution.fresh', 'fail', { reason: 'CAUGHT_FAILURE' });  this.publishFailure = 'BLOG_PUBLISH_PROBE_EVIDENCE_FAILED'; }
          return decision(false, reasonCode(this.publishFailure));
        }
        if (!allowedWindow || new URL(request.url).pathname !== '/RabbitWrite.naver' || request.method !== 'POST') {
          this.publishFailure = 'BLOG_PUBLISH_REQUEST_NOT_AUTHORIZED'; return decision(false, 'BLOG_PUBLISH_REQUEST_NOT_AUTHORIZED');
        }
        if (this.visibility === 'private' && (!this.requestProof || !inspectPrivateRequest(request, this.requestProof))) {
          this.publishFailure = 'BLOG_PRIVATE_REQUEST_UNCONFIRMED'; return decision(false, 'BLOG_PRIVATE_REQUEST_UNCONFIRMED');
        }
        if (this.visibility === 'public') {
          const inspection = this.requestProof ? inspectPublicRequestDecision(request, this.requestProof) : { allowed: false, reason: 'BLOG_PUBLISH_UI_PROOF_UNCONFIRMED' as const };
          if (!inspection.allowed) { this.publishFailure = inspection.reason; return decision(false, inspection.reason); }
        }
        this.publishRequestAccepted = true;
        return decision(true, 'BLOG_PUBLISH_REQUEST_ALLOWED');
      }, response => {
        if (response.url && new URL(response.url).pathname === '/RabbitTempPostWrite.naver') {
          const receipt = draftSaveReceipt(response);
          this.saveAcknowledged ||= receipt.saved;
          this.savedDraftId = receipt.id;
          trace('barrier', receipt.saved ? 'ok' : 'fail', { reason: receipt.saved ? 'BLOG_DRAFT_SAVE_RESPONSE_OK' : 'BLOG_DRAFT_SAVE_RESPONSE_UNCONFIRMED', counts: { status: response.status, bytes: response.body.length } });
          return;
        }
        this.responseEvidence = Promise.resolve().then(() => this.env.recordPublishResponse?.(response)).catch(() => { this.publishFailure = 'BLOG_PUBLISH_RESPONSE_EVIDENCE_FAILED'; });
        try {
          this.responsePost = parsePublishIdentity(response);
          trace('barrier', 'ok', { reason: 'BLOG_PUBLISH_RESPONSE_OK', counts: { status: response.status, bytes: response.body.length } });
          if (this.responsePost.post) this.publishedPost = this.responsePost.post;
        } catch (error) { trace('sites.naver-blog.plan.BlogExecution.fresh', 'fail', { reason: reasonCode(error) });  this.publishFailure = error instanceof Error ? error.message : 'BLOG_PUBLISH_RESPONSE_UNCONFIRMED'; }
      });
    }
    // Keep the previous composition until the new editor is available. Never close on stop/failure.
    await this.surface.open({ url: this.env.editorUrl ?? 'https://blog.naver.com/GoBlogWrite.naver', session: 'naver', width: 1280, height: 900, userAgent: ua });
    this.signal({ stage: 'open', phase: 'progress', opening: 'editor' });
    // The outer document's load can precede SmartEditor's iframe. Missing editor
    // during that interval is not evidence that the authenticated session expired.
    await waitFor(async () => {
      this.env.check();
      if (await this.dialog()) throw new Error('USER_DIALOG_REQUIRED');
      const state = await read<'expired' | 'ready' | false>(this.surface!, `
        if(docs.some(({d})=>d.location.hostname==='nid.naver.com'||d.querySelector('input[type="password"]'))) return 'expired';
        return docs.some(({d})=>d.querySelector('.se-documentTitle'))?'ready':false;`);
      if (state === 'expired') throw new Error('LOGIN_OR_EDITOR_LOST');
      return state;
    }, 30000, { surface: this.surface!, control: "BLOG_BODY" });
    await this.guard();
    this.signal({ stage: 'open', phase: 'progress', opening: 'empty' });
    await this.prepare();
    this.recoveryConsent = false;
    this.checkpoint = await readBlogDocument(this.surface);
    if (previous) await this.env.host.destroy(previous);

    });
  }
  private report(reset = false) {
    const totalCharacters = this.plan.steps.reduce((n, s) => n + (s.kind === 'text' ? Array.from(s.text).length : s.kind === 'table' ? s.rows.flat().reduce((a, t) => a + Array.from(t).length, 0) : 0), 0);
    this.env.progress({ tableModes: [...this.tableModes], characters: this.characters, totalCharacters, photos: this.photos, totalPhotos: this.plan.steps.reduce((n, step) => n + (step.kind === 'photos' ? step.urls.length : 0), 0), ...(reset ? { blogInputReset: true } : {}),
      ...(this.ownRecoveryDiscarded ? { ownRecoveryDiscarded: true } : {}), ...(this.blogParagraph ? { blogParagraph: this.blogParagraph } : {}),
      photoUploadMilliseconds: this.photoUploadMilliseconds, photoUploadSamples: this.photoUploadSamples, ...(this.activity ? { activity: this.activity } : {}) });
  }
  private async type(text: string, resume = false) {
    return traceStep('sites.naver-blog.plan.BlogExecution.type', async () => {
    const chars = inputCharacters(text);
    for (let offset = resume ? this.offset : 0; offset < chars.length;) {
      await this.guard();
      const start = offset;
      let end = offset;
      while (end < Math.min(offset + 32, chars.length) && chars[end] !== '\n') end++;
      const chunk = chars.slice(offset, end).join('');
      if (chunk) await this.surface!.typeText(chunk);
      if (chars[end] === '\n') { await this.surface!.pressKey({ key: 'Enter' }); end++; }
      await this.guard();
      offset = end; this.characters += Array.from(chars.slice(start, end).join('')).length;
      if (resume) this.offset = offset;
      if (!this.atomic) this.checkpoint = await readBlogDocument(this.surface!);
      if (this.activity?.stage === 'write' && this.executingStep?.kind === 'text') this.activity = { ...this.activity, phase: 'progress', fraction: Math.min(.99, offset / Math.max(1, chars.length)) };
      this.report();
    }

    });
  }
  private async endOfBody(appendAfterComponent = false) {
    return traceStep('sites.naver-blog.plan.BlogExecution.endOfBody', async () => {
    const s = this.surface!;
    const selector = '.se-component.se-text:last-child .se-text-paragraph:last-child';
    if (appendAfterComponent) {
      // Removing a table can also consume its empty append paragraph, leaving
      // a photo as the final component. Create only a new empty native anchor.
      for(let n=0;n<16;n++) {
        if(await read<boolean>(s, `return docs.some(({d})=>d.querySelector(${JSON.stringify(selector)}));`)) break;
        const bottom=await read<{x:number;y:number}|null>(s, `for(const {d,x,y}of docs){const e=d.querySelector('button.se-canvas-bottom-button');if(!e||!visible(e))continue;const b=e.getBoundingClientRect(),px=x+b.left+b.width/2,py=y+b.top+Math.min(20,b.height/2);if(px>0&&py>0&&px<innerWidth&&py<innerHeight)return{x:px,y:py};}return null;`);
        if(bottom) {
          await s.click(bottom.x,bottom.y,async()=>{if(s.readClickTarget&&!await s.readClickTarget(bottom.x,bottom.y,'button.se-canvas-bottom-button'))throw Error('CURSOR_POSITION_UNCONFIRMED');});
          await s.pressKey({key:'ArrowDown'}); continue;
        }
        const gap=await read<{x:number;y:number}|null>(s, `for(const {d,x,y}of docs){const all=Array.from(d.querySelectorAll('.se-component')).filter(e=>!e.classList.contains('se-documentTitle'));const t=all[all.length-1];if(!t||!['se-image','se-table'].some(c=>t.classList.contains(c)))continue;const b=t.getBoundingClientRect(),px=x+b.left+b.width/2,py=y+b.bottom+12;const top=y+Math.max(0,...Array.from(d.querySelectorAll('.se-document-toolbar,.se-property-toolbar')).filter(visible).map(e=>e.getBoundingClientRect().bottom));if(px>0&&py>top&&px<innerWidth&&py<innerHeight)return{x:px,y:py};}return null;`);
        if(gap) {
          await s.click(gap.x,gap.y,async()=>{if(s.readClickTarget&&!await s.readClickTarget(gap.x,gap.y,'.se-content,.se-components-wrap,.se-main-container'))throw Error('CURSOR_POSITION_UNCONFIRMED');});
          await s.pressKey({key:'ArrowDown'}); break;
        }
        await this.guard(); await s.pressKey({key:'PageDown'}); await sleep(100);
      }
    }

    let last = await point(s, selector);
    if (!last) {
      // SmartEditor scrolls its own canvas, rather than the outer document.
      // Focus a visible editor paragraph before sending navigation keys.
      const focus = await point(s, bodySelector) ?? await point(s, titleSelector);
      if (focus) await s.click(focus.x, focus.y);
    }
    // Closing metadata leaves focus on the sticky toolbar, which can also move
    // the viewport. Reveal the final paragraph with keys before restoring it.
    for (let n = 0; !last && n < 20; n++) {
      await this.guard(); await s.pressKey({ key: 'PageDown' }); await sleep(100);
      last = await point(s, selector);
    }
    if (last) await s.click(last.x, last.y);
    await s.pressKey({ key: 'End', modifiers: 2 });
    await s.pressKey({ key: 'ArrowDown' });
    await s.pressKey({ key: 'End' });
    const atEnd = await read<boolean>(s, `
      const d=docs.find(({d})=>d.querySelector('.se-documentTitle'))?.d, sel=d?.defaultView.getSelection();
      let e=sel?.anchorNode?.nodeType===1?sel.anchorNode:sel?.anchorNode?.parentElement;
      while(e&&!e.classList?.contains('se-component'))e=e.parentElement;
      const components=Array.from((d?.querySelector('.se-main-container')||d?.querySelector('.se-content'))?.querySelectorAll('.se-component')||[]).filter(e=>!e.classList.contains('se-documentTitle'));
      return !!e&&e===components[components.length-1]&&e.classList.contains('se-text');`);
    if (!atEnd && !await blogBodyAtEnd(s)) throw new Error('CURSOR_POSITION_UNCONFIRMED');

    });
  }
  private async tagInput() {
    return traceStep('sites.naver-blog.plan.BlogExecution.tagInput', async () => {
    const s = this.surface!;
    const present = await read<boolean>(s, `return docs.some(({d})=>d.querySelector(${JSON.stringify(tagInputSelector)}));`);
    if (!present && await point(s, tagPanelToggle)) {
      await this.guard();
      await click(s, 'BLOG_TAG_PANEL', tagPanelToggle);
    }
    for (let n = 0; n < 12 && !await point(s, tagInputSelector); n++) {
      await this.guard(); await s.pressKey({ key: 'PageDown' }); await sleep(100);
    }
    await click(s, 'BLOG_TAG_INPUT', tagInputSelector);

    });
  }
  async write() {
    return traceStep('sites.naver-blog.plan.BlogExecution.write', async () => {
    this.executingStep = undefined;
    try { await this.writePlan(); this.inputFormattingFailure = undefined; }
    catch (error) { trace('sites.naver-blog.plan.BlogExecution.write', 'fail', { reason: reasonCode(error) });
      if (error instanceof BlogFormattingError) this.inputFormattingFailure = error;
      const step = this.executingStep;
      if (error instanceof ControlNotFoundError && step) throw error.atPlanStep(this.index + 1, step);
      throw error;
    } finally {
      this.executingStep = undefined;
      if (this.surface) await closeTagLayer(this.surface);
    }

    });
  }
  private async writePlan() {
    return traceStep('sites.naver-blog.plan.BlogExecution.writePlan', async () => {
    for (const step of this.plan.steps) if (step.kind === 'photos' && step.urls.some(url => !this.files.find(f => f.url === url))) throw new Error('PREPARED_PHOTOS_MISSING');
    if (!this.surface) await this.fresh();
    else {
      await this.guard();
      const current = await readBlogDocument(this.surface);
      if (this.checkpoint && same(current, this.checkpoint)) {
        await this.richWriter?.requireClosedDialog(this.surface);
        if (this.index === 0) { await click(this.surface, 'BLOG_TITLE', titleSelector); await this.surface.pressKey({ key: 'End' }); }
        else await this.endOfBody();
      } else if (this.checkpoint) {
        if (this.richWriter && !this.recoveryConsent) throw new Error('AUTO_RECOVER_CONSENT_REQUIRED');
        this.richWriter = undefined; this.blogParagraph = undefined;
        await this.fresh(); this.index = 0; this.offset = 0; this.characters = 0; this.photos = 0; this.tableModes.length = 0; this.atomic = false;
        this.photoUploadMilliseconds = 0; this.photoUploadSamples = 0;
        this.activity = undefined; this.report(true);
      } else await this.prepare();
      this.recoveryConsent = false;
    }
    const s = this.surface!;
    for (; this.index < this.plan.steps.length; this.index++, this.offset = 0, this.richWriter = undefined) {
      await this.guard(); const step = this.plan.steps[this.index]!;
      this.executingStep = step;
      if (step.kind !== 'break') this.signal({ stage: 'write', phase: 'start', blockIndex: this.index, blockTotal: this.plan.steps.length, blockKind: step.kind === 'photos' ? 'photos' : step.kind === 'table' ? 'table' : step.role === 'title' ? 'title' : step.role === 'hashtags' ? 'tags' : 'paragraph', fraction: 0 });
      if (step.kind === 'text' && step.role === 'title') {
        if (!this.offset) await click(s, 'BLOG_TITLE', titleSelector);
        await this.type(step.text, true);
        await click(s, 'BLOG_BODY', bodySelector);
      } else if (step.kind === 'break') {
        // The title separator changes focus only. Other separators create editor paragraphs.
        if (this.index > 1) { await s.pressKey({ key: 'Enter' }); await s.pressKey({ key: 'Enter' }); }
      } else if (step.kind === 'photos') {
        this.atomic = true;
        for (const url of step.urls) {
          this.signal({ ...this.activity!, stage: 'write', phase: 'start', photoIndex: this.photos, photoTotal: this.files.length, fraction: 0 });
          await this.guard();
          const started = Date.now();
          await this.endOfBody();
          const before = await readBlogDocument(s);
          if (before.tokens.filter(t => t.kind === 'photo').length !== this.photos) throw new Error('PHOTO_CURSOR_PREFIX_MISMATCH');
          await click(s, 'BLOG_IMAGE_BUTTON', 'button[data-name="image"]');
          await s.attachFiles('input[type="file"]', [this.files.find(f => f.url === url)!.path]);
          await confirmBlogPhotos(s, this.photos + 1, this.env.check);
          await s.pressKey({ key: 'ArrowDown' }); await this.endOfBody();
          this.photos++;
          this.signal({ ...this.activity!, stage: 'write', phase: 'finish', fraction: 1 });
          this.photoUploadMilliseconds += Date.now() - started; this.photoUploadSamples++;
          this.report();
        }
      } else if (step.kind === 'table') {
        this.atomic = true;
        await this.table(step);
      } else if (step.kind === 'text' && step.role === 'hashtags') {
        this.atomic = true;
        await this.tagInput();
        const start = this.characters;
        const expected = expectedBlogTags({ ...this.plan, steps: this.plan.steps.slice(0, this.index) });
        await waitFor(async () => {
          await this.guard();
          return sameBlogTags(expected, (await readBlogDocument(s)).tags);
        }, undefined, { surface: s, control: "BLOG_TAG_INPUT" });
        for (const tag of plannedBlogTags({ ...this.plan, steps: [step] })) {
          // The editor already merged body hashtags when the layer opened.
          // Keep those chips and never submit a duplicate or delete a tag.
          if (expected.includes(tag)) continue;
          await requireTagFocus(s);
          await this.type(tag);
          await requireTagFocus(s);
          await s.pressKey({ key: 'Enter' });
          expected.push(tag);
          await waitFor(async () => {
            await this.guard();
            const tags = (await readBlogDocument(s)).tags;
            return sameBlogTags(expected, tags);
          }, undefined, { surface: s, control: "BLOG_TAG_INPUT" });
        }
        // Progress counts the plan's # prefixes and separators after tag commit.
        this.characters = start + Array.from(step.text).length;
        // Converted plans can end with a separator. Return keyboard focus to the
        // body so those Enter keys never commit another tag. observe() reopens
        // the layer before reading metadata, including after a fresh draft load.
        await closeTagLayer(s);
        await this.endOfBody();
      } else if (step.kind === 'text') {
        if (step.runs || hasBlogLiteralMarker(step.text)) {
          const ordinal = plannedBlogParagraphs({ ...this.plan, steps: this.plan.steps.slice(0, this.index) }).length + 1;
          this.richWriter ??= new BlogRichTextWriter(step.text, step.runs ?? [{ text: step.text }], ordinal);
          await this.richWriter.write(s, () => this.guard(), async (added, runs) => {
            this.characters += added; this.blogParagraph = { blockIndex: this.index, runs };
            this.checkpoint = await readBlogDocument(s);
            if (this.activity?.stage === 'write') this.activity = { ...this.activity, phase: 'progress', fraction: Math.min(.99, runs.reduce((n, r) => n + Array.from(r.text).length, 0) / Math.max(1, Array.from(step.text).length)) };
            this.report();
          });
        } else await this.type(step.text, true);
        if (step.role === 'linkCard') {
          await s.pressKey({ key: 'Enter' }); await sleep(1500); await this.guard();
          this.linkCard = await read<boolean>(s, `return docs.some(({d})=>d.querySelector('.se-component.se-oglink'));`) ? 'card' : 'url-text';
        }
      }
      await this.guard(); this.checkpoint = await readBlogDocument(s); this.atomic = false; this.report();
      if (step.kind === 'text' && step.role === 'title' && this.checkpoint.title === step.text) await this.env.lastTypedTitle?.write(step.text).catch(() => {});
      if (step.kind !== 'break') this.signal({ ...this.activity!, stage: 'write', phase: 'finish', fraction: 1 });
    }
    this.executingStep = undefined;
    this.verifyDocument(await this.observe(), 'INPUT');

    });
  }
  private async table(step: Extract<BlogPlan['steps'][number], {kind:'table'}>) {
    return traceStep('sites.naver-blog.plan.BlogExecution.table', async () => {
      const start = this.characters;
      const mode = await insertBlogTable(this.surface!, step, {
        check: () => this.guard(), snapshot: () => readBlogDocument(this.surface!), restoreEnd: () => this.endOfBody(true),
        acknowledge: added => { this.characters += added; this.report(); },
      });
      this.tableModes.push(mode); this.report();
      if (mode === 'text-list') {
        this.characters = start;
        for (let r = 0; r < step.rows.length; r++) {
          if (r) await this.surface!.pressKey({key:'Enter'});
          const runs = tableRowRuns(step, r), text = runs.map(run => run.text).join('');
          await new BlogRichTextWriter(text, runs, 1).write(this.surface!, () => this.guard(), async added => { this.characters += added; this.report(); });
        }
      }
    });
  }

  async observe() {
    return traceStep('sites.naver-blog.plan.BlogExecution.observe', async () => {
    try {
    await this.guard();
    await closeTagLayer(this.surface!);
    const started = Date.now();
    let navigationKeys = 0;
    let sweepStarted = false;
    let observed = await waitFor(async () => {
      await this.guard(); const value = await readBlogDocument(this.surface!);
      if (value.tokens.every(t => t.kind !== 'photo' || t.identity)) return value;
      // A metadata input consumes navigation keys. Reveal lazy-loaded photos
      // with the layer closed and body focused before opening it to read tags.
      if (!sweepStarted) {
        const focus = await point(this.surface!, bodySelector) ?? await point(this.surface!, titleSelector);
        if (!focus) throw new Error('CURSOR_POSITION_UNCONFIRMED');
        await this.surface!.click(focus.x, focus.y);
        await this.surface!.pressKey({ key: 'Home', modifiers: 2 }); navigationKeys++;
        sweepStarted = true;
      } else {
        await this.surface!.pressKey({ key: 'PageDown' }); navigationKeys++;
      }
      return null;
    }, Math.max(30000, this.files.length * 2000), { surface: this.surface!, control: "BLOG_IMAGE_LIST" });
    this.readbackTimings.push({ photos: observed.tokens.filter(t => t.kind === 'photo').length, milliseconds: Date.now() - started, navigationKeys });
    if (expectedBlogTags(this.plan).length || await point(this.surface!, tagPanelToggle)) {
      await this.tagInput(); observed = await readBlogDocument(this.surface!);
    }
    // Keep the existing non-table path; the additional settling is for tables.
    if (!this.plan.steps.some(step=>step.kind==='table')) return observed;
    const settled = await settledReadback({ read: () => readBlogDocument(this.surface!), check: this.env.check, timeoutMs: 15000,
      classes: value => [{ check: 'table', reason: 'READBACK_TABLE', expected: this.plan.steps.filter(s=>s.kind==='table').filter((_,i)=>this.tableModes[i]!=='text-list').length,
        observed: value?.tokens.filter(t=>t.kind==='table').length ?? 0, present: !!value && blogTablesMatch(this.plan,value,this.tableModes) }] });
    if (!settled.stable) throw new ReadbackMismatch('BLOG_READBACK_MISMATCH:stability',[{field:'stability'}]);
    return settled.value!;
    } finally { await closeTagLayer(this.surface!); }

    });
  }
  async saveAndVerify() {
    return traceStep('sites.naver-blog.plan.BlogExecution.saveAndVerify', async () => {
    try { return await this.saveAndVerifyPlan(); }
    finally {
      // The layer was verified closed before save. A native save dialog blocks
      // all page reads; leave its answer to the app instead of querying behind it.
      if (this.surface && !await this.dialog()) await closeTagLayer(this.surface);
    }

    });
  }
  private async saveAndVerifyPlan() {
    return traceStep('sites.naver-blog.plan.BlogExecution.saveAndVerifyPlan', async () => {
    await this.guard();
    if (this.formattingFailure) throw this.formattingFailure;
    if (this.inputFormattingFailure) throw this.inputFormattingFailure;
    if (this.verified) { const observed = await this.observe(); this.verifyDocument(observed, 'REOPENED'); return observed; }
    if (!this.saveAttempted) {
      this.verifyDocument(await this.observe(), 'BEFORE_SAVE');
      await requireTagLayerClosed(this.surface!);
      this.draftsBefore = await openDraftEntries(this.surface!, true);
      await closeDraftEntries(this.surface!);
      this.env.check(); this.env.beforeSave();
      // Mark BEFORE sending input. Ambiguous transport responses never cause another save.
      this.saveAttempted = true;
      this.signal({ stage: 'submit', phase: 'start', submission: 'draft' });
      try {
        await requireTagLayerClosed(this.surface!);
        trace('job.checkpoint', 'ok', { checkpoint: 'before_submit' });
        await click(this.surface!, 'BLOG_SAVE', 'button[data-click-area="tpb.save"]');
      }
      catch (error) { trace('sites.naver-blog.plan.BlogExecution.saveAndVerifyPlan', 'fail', { reason: reasonCode(error) });
        if (await this.dialog()) throw new Error('USER_DIALOG_REQUIRED');
        if (error instanceof Error && /^BLOG_TAG_/.test(error.message)) throw error;
        /* Resolve ambiguous transport from the list, never retry input. */
      }
      await sleep(800);
      await this.guard();
    }
    if (!this.reopened && !this.afterSaveChecked) { this.verifyDocument(await this.observe(), 'AFTER_SAVE'); this.afterSaveChecked = true; }
    if (!this.reopened) { await this.fresh(true); this.reopened = true; }
    await this.guard();
    const s = this.surface!;
    let after: DraftEntry[];
    try { after = await openDraftEntries(s, true); }
    catch { trace('sites.naver-blog.plan.BlogExecution.saveAndVerifyPlan', 'fail', { reason: 'CAUGHT_FAILURE' });  throw new Error(this.saveAcknowledged ? 'BLOG_DRAFT_SAVED_UNVERIFIED' : 'DRAFT_SAVE_UNCONFIRMED'); }
    const identity = identifySavedDraft(this.draftsBefore, after, this.title.text, this.savedDraftId);
    if (!identity) trace('verification', 'fail', { check: 'identity', reason: 'DRAFT_SAVE_UNCONFIRMED', counts: { expected: 1, observed: 0 } });
    if (!identity) throw new Error(this.saveAcknowledged || after.filter(e => e.title === this.title.text).length > this.draftsBefore.filter(e => e.title === this.title.text).length ? 'BLOG_DRAFT_SAVED_UNVERIFIED' : 'DRAFT_SAVE_UNCONFIRMED');
    this.draftIdentity = { existingSameTitle: this.draftsBefore.filter(e => e.title === this.title.text).length, source: identity.source };
    await this.guard();
    const selector = `${draftItem.split(' > li')[0]} > li:nth-child(${identity.index + 1}) button[data-click-area="tpb*s.tlist"]`;
    const matches = async () => {
      this.env.check();
      if (JSON.stringify(await draftEntries(s)) !== JSON.stringify(after)) throw new Error('BLOG_DRAFT_SAVED_UNVERIFIED');
    };
    await matches();
    const target = await point(s, selector);
    if (!target) throw new Error('BLOG_DRAFT_SAVED_UNVERIFIED');
    await s.click(target.x, target.y, matches);
    await waitFor(async () => sameReadbackIdentityText(this.title.text, (await readBlogDocument(s)).title), 15000, { surface: s, control: "BLOG_DRAFT_ITEM" });
    const observed = await this.observe(); this.verifyDocument(observed, 'REOPENED'); this.verified = true;
    trace('verification', 'ok', { check: 'identity', counts: { expected: 1, observed: 1 } });
    trace('job.checkpoint', 'ok', { checkpoint: 'readback_complete' });
    return observed;

    });
  }
  async publish() {
    return traceStep('sites.naver-blog.plan.BlogExecution.publish', async () => {
    if (this.env.mode !== 'publish' || !this.verified || !this.env.publishEnabled && !this.env.localPublish) throw new Error('REAL_PUBLISH_DISABLED');
    if (this.formattingFailure) throw this.formattingFailure;
    this.signal({ stage: 'submit', phase: 'start', submission: 'publish' });
    if (this.publishAttempted) throw new Error('BLOG_PUBLISH_ALREADY_ATTEMPTED');
    await this.guard(); this.verifyDocument(await this.observe(), 'REOPENED');
    const s = this.surface!;
    try {
      await click(s, 'BLOG_PUBLISH', tagPanelToggle);
      this.publishInteraction = true;
      await selectVisibility(s, this.visibility);
      this.requestProof = await readVisibility(s, this.visibility);
      requireVisibility(this.requestProof, this.visibility);
      this.publishArmed = true;
      trace('job.checkpoint', 'ok', { checkpoint: 'before_submit' });
      // Latch before input; failures, timeouts, stop/resume never republish.
      this.publishAttempted = true;
      await guardedPublishClick(s, this.visibility, this.env.check, proof => { this.requestProof = proof; });
      await waitFor(async () => {
        this.env.check();
        if (this.publishFailure) throw new Error(this.publishFailure);
        if (!this.publishRequestAccepted) return false;
        await this.responseEvidence;
        if (this.publishFailure) throw new Error(this.publishFailure);
        const state = await s.readState();
        const pages = await read<PublishedPage[]>(s, `return docs.map(({d})=>({url:d.location.href,titles:Array.from(d.querySelectorAll('.se-documentTitle .se-text-paragraph')).map(e=>(e.textContent||'').trimStart().trimEnd())}));`).catch(() => []);
        const evidence = resolvePublishEvidence(this.responsePost, [state.url], pages, this.title.text);
        const identity = evidence.post;
        // Retain a proven response/navigation identity before viewer hydration.
        // Title and every other content class settle together below.
        if (!identity) return false;
        this.publishedPost = identity;
        this.publishedIdentitySources = evidence.sources;
        return true;
      }, 30000, { surface: s, control: "BLOG_PUBLISH_RECEIPT" });
      await this.verifyPublished();
      return this.publishedPost!.url;
    } finally {
      this.publishArmed = false; this.publishInteraction = false;
      if (!this.publishedPost && !await this.dialog()) await closeTagLayer(s);
    }

    });
  }
  async verifyPublished() {
    return traceStep('sites.naver-blog.plan.BlogExecution.verifyPublished', async () => {
    if (!this.publishedPost) throw new Error('BLOG_PUBLISH_ID_UNCONFIRMED');
    const s = this.surface!;
    const started = Date.now();
    const ownUrls = async () => (await read<string[]>(s, `return docs.map(({d})=>d.location.href);`)).filter(url => postIdentity(url)?.url === this.publishedPost!.url);
    const paragraphs = plannedBlogParagraphs(this.plan,this.tableModes);
    const runs = (value: BlogReadback | null) => value?.tokens.flatMap(t => t.kind === 'text' ? normalizeBlogRuns(t.runs ?? []) : t.kind === 'table' ? t.rows.flatMap((_,r)=>normalizeBlogRuns(tableRowRuns(t,r))) : []) ?? [];
    const plannedRuns = paragraphs.flatMap(normalizeBlogRuns);
    const expectedPhotos = this.plan.steps.reduce((n, step) => n + (step.kind === 'photos' ? step.urls.length : 0), 0);
    const classes = (value: BlogReadback | null): ReadbackClass[] => {
      const photos = value?.tokens.filter(t => t.kind === 'photo') ?? [], observedRuns = runs(value);
      return [
        { check: 'table', reason: 'READBACK_TABLE', expected: this.plan.steps.filter(s=>s.kind==='table').filter((_,i)=>this.tableModes[i]!=='text-list').length, observed: value?.tokens.filter(t=>t.kind==='table').length ?? 0, present: !!value && blogTablesMatch(this.plan,value,this.tableModes) },
        { check: 'title', reason: 'READBACK_TITLE', expected: 1, observed: value?.title ? 1 : 0, present: !!value?.title },
        { check: 'paragraphs', reason: 'READBACK_PARAGRAPHS', expected: paragraphs.length, observed: value?.tokens.reduce((n,t)=>n+(t.kind==='text'?1:t.kind==='table'?t.rows.length:0),0) ?? 0, present: !!value && (!paragraphs.length || observedRuns.length > 0) },
        { check: 'text', reason: 'READBACK_TEXT', expected: plannedRuns.reduce((n,r)=>n+r.text.length,0), observed: observedRuns.reduce((n,r)=>n+r.text.length,0), present: !!value && (!plannedRuns.length || observedRuns.length > 0) },
        { check: 'bold', reason: 'READBACK_BOLD', expected: plannedRuns.filter(r=>r.bold).length, observed: observedRuns.filter(r=>r.bold).length, present: !!value },
        { check: 'links', reason: 'READBACK_LINKS', expected: plannedRuns.filter(r=>r.href).length, observed: observedRuns.filter(r=>r.href).length, present: observedRuns.filter(r=>r.href).length >= plannedRuns.filter(r=>r.href).length },
        { check: 'photos', reason: 'READBACK_PHOTOS', expected: expectedPhotos, observed: photos.length, present: photos.length >= expectedPhotos },
        { check: 'hashtags', reason: 'READBACK_TAGS', expected: plannedBlogTags(this.plan).length, observed: value?.tags.length ?? 0, present: !!value && (!value.tagArea || value.tags.length >= plannedBlogTags(this.plan).length) },
        { check: 'visibility', reason: 'READBACK_VISIBILITY', expected: this.visibility === 'public' ? 2 : 1,
          observed: value?.visibility === 'public' ? 2 : value?.visibility === 'private' ? 1 : 0, present: !!value?.visibility },
      ];
    };
    let mobile: Surface | undefined;
    try {
      // Public visibility has an independently observed openType=2 on the real
      // mobile post. Never infer it merely from the requested publish setting.
      if (!this.env.localPublish && this.visibility === 'public') {
        mobile = await this.env.host.create('naver');
        if (!mobile.blockRequests) throw Error('BLOG_READBACK_BARRIER_UNAVAILABLE');
        await mobile.blockRequests([{ hostname: 'blog.naver.com', pathname: '/RabbitWrite.naver' }, { hostname: 'blog.naver.com', pathname: '/RabbitAutoSaveWrite.naver', expected: true }]);
        await mobile.open({ url: this.publishedPost.url.replace('https://blog.naver.com/', 'https://m.blog.naver.com/'), session: 'naver', width: 412, height: 900, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
      }
      const settled = await settledReadback({
        timeoutMs: this.env.localPublish && this.env.publishedSettleMs !== undefined ? this.env.publishedSettleMs : 15000,
        check: this.env.check, classes,
        read: async () => {
          const urls = await ownUrls();
          const hasViewer = await read<boolean>(s, `return docs.some(({d})=>${JSON.stringify(urls)}.includes(d.location.href)&&!!d.querySelector('.se-documentTitle'));`);
          if (!hasViewer) return null;
          const actual = await readBlogDocument(s, urls, true);
          if (mobile) {
            const proof = await read<{url:string;title:string;openType:number|null;login:boolean}>(mobile, `return {url:location.href,title:document.querySelector(${JSON.stringify(titleSelector)})?.textContent||'',openType:typeof openType==='number'?openType:null,login:!!document.querySelector('input[type="password"]')};`);
            if (proof.login) throw Error('LOGIN_OR_EDITOR_LOST');
            actual.visibility = postIdentity(proof.url)?.url === this.publishedPost!.url && sameReadbackIdentityText(actual.title, proof.title) ? proof.openType === 2 ? 'public' : proof.openType === 0 ? 'private' : null : null;
          } else {
            actual.visibility = await read<BlogVisibility|null>(s, `for(const {d} of docs){if(!${JSON.stringify(urls)}.includes(d.location.href))continue;const values=Array.from(d.querySelectorAll('.post_visibility, .blog2_visibility, .post_author, [data-post-visibility], .se-documentTitle .blog2_container .writer .desc .txt')).filter(visible).map(e=>(e.textContent||'').trimStart().trimEnd());if(values.includes('전체공개'))return 'public';if(values.includes('비공개'))return 'private';}return null;`);
          }
          return actual;
        },
      });
      const value = settled.value;
      const issueField = (check: ReadbackClass['check']): ReadbackIssue['field'] =>
        check === 'paragraphs' ? 'text' : check === 'links' ? 'href' : check === 'photos' ? 'photo' : check as ReadbackIssue['field'];
      const issues: ReadbackIssue[] = settled.classes.filter(item => !item.present).map(({ check, expected, observed }) => ({
        field: issueField(check), expected, observed,
      }));
      if (!value || !settled.stable) throw new ReadbackMismatch('BLOG_PUBLISHED_READBACK_UNAVAILABLE', [{ field: 'stability' }, ...issues]);
      if (value.visibility !== this.visibility && !issues.some(issue=>issue.field==='visibility')) issues.push({field:'visibility'});
      if (!sameServiceBlogTags(this.plan, value.tags) && !issues.some(issue=>issue.field==='hashtags')) {
        issues.push({field:'hashtags',expected:plannedBlogTags(this.plan).length,observed:value.tags.length});
      }
      const sameTitle = sameReadbackIdentityText(this.title.text, value.title);
      for (const issue of compareBlogFormatting(this.plan, value, this.tableModes)) {
        for (const field of issue.fields) {
          const missing = sameTitle && (field === 'text' || field === 'href' || field === 'number');
          const prior = issues.find(value => value.field === field && value.paragraph === undefined);
          if (prior && missing) { prior.missing = true; prior.paragraph = issue.paragraph; }
          else if (!prior) issues.push({ field, paragraph:issue.paragraph, ...(missing ? { missing: true } : {}) });
        }
      }
      try { this.env.verify(value, 'PUBLISHED'); } catch(error) {
        if (!(error instanceof ReadbackMismatch)) throw error;
        for (const issue of error.issues) {
          if (issues.some(existing=>existing.field===issue.field)) continue;
          const count = settled.classes.find(item=>item.check==='photos');
          issues.push(issue.field==='photo' && count ? { ...issue, expected:count.expected, observed:count.observed } : issue);
        }
      }
      this.readbackTimings.push({ photos: value.tokens.filter(t => t.kind === 'photo').length, milliseconds: Date.now() - started, navigationKeys: 0 });
      if (issues.length) {
        for (const item of settled.classes) trace('verification', issues.some(issue => issue.field === issueField(item.check)) ? 'fail' : 'ok',
          { check: item.check, reason: item.reason, counts: { expected: item.expected, observed: item.observed } }, Date.now() - started);
        trace('verification', settled.stable?'ok':'fail', {check:'stability',reason:'READBACK_STABILITY',counts:{expected:2,observed:settled.stable?2:1}},Date.now()-started);
        if (issues.length === 1 && issues[0]?.field === 'visibility' && this.visibility === 'private') {
          throw new ReadbackMismatch('BLOG_PUBLISHED_PRIVATE_UNCONFIRMED', issues);
        }
        throw new ReadbackMismatch('BLOG_READBACK_MISMATCH:'+ [...new Set(issues.map(i=>i.field))].join(','), issues);
      }
    const pages = await read<PublishedPage[]>(s, `return docs.map(({d})=>({url:d.location.href,titles:Array.from(d.querySelectorAll('.se-documentTitle .se-text-paragraph')).map(e=>(e.textContent||'').trimStart().trimEnd())}));`);
    const evidence = resolvePublishEvidence(this.responsePost, [(await s.readState()).url], pages, this.title.text);
    const sameIdentity = evidence.post?.url === this.publishedPost.url;
    trace('verification', sameIdentity ? 'ok' : 'fail', { check: 'identity', reason: 'BLOG_PUBLISH_ID_UNCONFIRMED', counts: { expected: 1, observed: Number(sameIdentity) } });
    if (!sameIdentity) throw Error('BLOG_PUBLISH_ID_UNCONFIRMED');
    this.publishedIdentitySources = evidence.sources;
    trace('verification','ok',{check:'stability',reason:'READBACK_STABILITY',counts:{expected:2,observed:2}},Date.now()-started);
    this.publishedVerified = true;
    trace('job.checkpoint', 'ok', { checkpoint: 'readback_complete' });
    return value;
    } finally { if (mobile) await this.env.host.destroy(mobile); }

    });
  }
  async show() {
    return traceStep('sites.naver-blog.plan.BlogExecution.show', async () => { await this.surface?.show();
    });
  }
  async hide() {
    return traceStep('sites.naver-blog.plan.BlogExecution.hide', async () => { await this.surface?.hide();
    });
  }
  async close() {
    return traceStep('sites.naver-blog.plan.BlogExecution.close', async () => { if (this.surface) { await this.env.host.destroy(this.surface); this.surface = undefined; }
    });
  }
}
