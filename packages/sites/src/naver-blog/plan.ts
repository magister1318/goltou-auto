// Reference: ../refs/DAF/daf3/packages/engine-naver-editor/src/insert/info-table.ts (table toolbar/control selectors only; DOM mutations excluded).
import type { GuardedRequest, Surface, SurfaceDialog, SurfaceHost } from '@goltou/surface';
import { inputCharacters } from '@goltou/surface';
import { click, compact, point, read, sleep, waitFor } from '../dom';
import { confirmBlogPhotos, prepareBlogEditor } from './index';
import { ControlNotFoundError } from '../control-failure';
import { closeTagLayer, protectBlogInputs, requireTagFocus, requireTagLayerClosed, tagInputSelector, tagPanelToggle } from './draft-safety';
import { finalPublishSelector, guardedPublishClick, inspectPrivateRequest, postIdentity, readVisibility, requireVisibility, selectVisibility, type BlogVisibility, type PublishedPost, type VisibilityProof } from './publish-safety';

/** Structural subset of WP4 InputPlan. Sites has no dependency on core or a device API. */
export interface BlogPlan {
  channel: 'blog' | 'band';
  steps: ({ kind: 'text'; role: string; text: string } | { kind: 'break' } | { kind: 'photos'; urls: string[] } | { kind: 'table'; role: string; rows: string[][] })[];
}
export type BlogToken = { kind: 'text'; text: string } | { kind: 'photo'; identity: string };
export interface BlogReadback { title: string; tokens: BlogToken[]; tags: string[] }
export interface BlogProgress { characters: number; totalCharacters: number; photos: number; totalPhotos: number; photoUploadMilliseconds?: number; photoUploadSamples?: number }
export interface BlogEnvironment {
  host: SurfaceHost;
  mode?: 'draft' | 'publish';
  visibility?: BlogVisibility;
  publishEnabled?: boolean;
  editorUrl?: string;
  /** Loopback fixtures only. Never bypasses visibility or content verification. */
  localPublish?: boolean;
  /** Debug shell capability, separate from real publish authorization. ALWAYS blocks. */
  publishProbe?: { visibility: BlogVisibility; record(request: GuardedRequest, proof: VisibilityProof | undefined): Promise<void> };
  beforeSave(): void;
  check(): void;
  progress(value: BlogProgress): void;
  verify(value: BlogReadback): void;
}
const titleSelector = '.se-documentTitle .se-text-paragraph';
const bodySelector = '.se-component.se-text .se-text-paragraph';
const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Read document order, cells and uploaded filenames independently of the input plan. */
export async function readBlogDocument(surface: Surface): Promise<BlogReadback> {
  return read(surface, `
    const d=docs.find(({d})=>d.querySelector('.se-documentTitle'))?.d;
    if(!d) throw Error('LOGIN_OR_EDITOR_LOST');
    const text=e=>{const nodes=Array.from(e.querySelectorAll('.__se-node'));return nodes.length?nodes.map(n=>n.textContent||'').join(''):(e.querySelector('.se-placeholder')?'':e.textContent||'');};
    const main=d.querySelector('.se-main-container')||d.querySelector('.se-content')||d.querySelector('.se-viewer');
    const tokens=[];
    for(const e of main?.querySelectorAll('.se-component')||[]) {
      if(e.classList.contains('se-documentTitle')) continue;
      if(e.classList.contains('se-text')) {
        for(const p of e.querySelectorAll('.se-text-paragraph')) {const t=text(p);if(t.replace(/[\\s\\u200b-\\u200d\\ufeff]/g,'')) tokens.push({kind:'text',text:t});}
      } else if(e.classList.contains('se-image')) {
        for(const img of e.querySelectorAll('.se-image-resource')) {
          const raw=[img.getAttribute('src'),img.getAttribute('data-file-name'),img.getAttribute('alt')].join(' ');
          const match=/goltou-[a-f0-9]{16}-[0-9]+\\.[a-z]+/i.exec(raw);
          tokens.push({kind:'photo',identity:match?match[0]:''});
        }
      } else if(e.classList.contains('se-table')) {
        for(const row of e.querySelectorAll('tr')) tokens.push({kind:'text',text:Array.from(row.querySelectorAll('td,th')).map(text).join(' | ')});
      } else if(e.classList.contains('se-oglink')) {
        const a=e.querySelector('a[href]'); tokens.push({kind:'text',text:a?.getAttribute('href')||''});
      } else { tokens.push({kind:'text',text:'UNSUPPORTED_EDITOR_COMPONENT'}); }
    }
    return {title:text(d.querySelector(${JSON.stringify(titleSelector)})).trim(),tokens,
      tags:Array.from(d.querySelectorAll('.tag_list .tag, .se-tag-list .se-tag, .post_tag .item, [data-goltou-tag], [class^="tag_textarea__"] span[class*="tag__"][aria-label]')).map(e=>(e.textContent||'').replace(/^#/,'').trim())};`);
}
const same = (a: BlogReadback, b: BlogReadback) => compact(a.title) === compact(b.title) && JSON.stringify(a.tokens.map(t => t.kind === 'text' ? ['text', compact(t.text)] : ['photo', t.identity])) === JSON.stringify(b.tokens.map(t => t.kind === 'text' ? ['text', compact(t.text)] : ['photo', t.identity])) && JSON.stringify(a.tags) === JSON.stringify(b.tags);

export class BlogExecution {
  surface: Surface | undefined;
  private index = 0;
  private executingStep: BlogPlan['steps'][number] | undefined;
  private offset = 0;
  private characters = 0;
  private photos = 0;
  private photoUploadMilliseconds = 0;
  private photoUploadSamples = 0;
  readonly readbackTimings: { photos: number; milliseconds: number; navigationKeys: number }[] = [];
  private checkpoint: BlogReadback | undefined;
  private saveAttempted = false;
  private reopened = false;
  private verified = false;
  private recoveryConsent = false;
  private atomic = false;
  private publishInteraction = false;
  private publishArmed = false;
  private publishAttempted = false;
  private requestProof: VisibilityProof | undefined;
  private publishFailure = '';
  private responsePost: PublishedPost | undefined;
  /** Set only from this execution's successful publish response. Memory only. */
  publishedPost: PublishedPost | undefined;
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
    try {
    if (!this.surface) await this.fresh();
    else {
      await this.guard();
      await prepareBlogEditor(this.surface, this.env.check, { autoRecover: this.recoveryConsent ? 'decline-with-user-consent' : 'stop' });
      this.recoveryConsent = false; this.checkpoint = await readBlogDocument(this.surface);
    }
    } finally { if (this.surface) await closeTagLayer(this.surface); }
  }
  consentToDiscard() { this.recoveryConsent = true; }
  async dialog(): Promise<SurfaceDialog | null> { return await this.surface?.readDialog?.() ?? null; }
  async answerDialog(id: string, accept: boolean) {
    if (!this.surface?.respondDialog) throw new Error('DIALOG_UNAVAILABLE');
    await this.surface.respondDialog(id, accept);
  }
  private async guard() {
    this.env.check();
    if (await this.dialog()) throw new Error('USER_DIALOG_REQUIRED');
    const ready = await read<boolean>(this.surface!, `return !docs.some(({d})=>d.querySelector('input[type="password"]')||d.location.hostname==='nid.naver.com')&&docs.some(({d})=>d.querySelector('.se-documentTitle'));`);
    if (!ready) throw new Error('LOGIN_OR_EDITOR_LOST');
  }
  private async fresh() {
    const previous = this.surface;
    this.surface = await this.env.host.create('naver');
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
    } else {
      if (!this.surface.guardRequests) throw new Error('BLOG_PUBLISH_BARRIER_UNAVAILABLE');
      const hostname = this.env.localPublish ? new URL(this.env.editorUrl!).hostname : 'blog.naver.com';
      await this.surface.guardRequests(['/RabbitWrite.naver', '/RabbitUpdate.naver'].map(pathname => ({ hostname, pathname })), async request => {
        const allowedWindow = this.publishArmed; this.publishArmed = false;
        if (this.env.publishProbe) {
          // No inspector result, armed window, method, path or visibility can
          // authorize a probe. Persistence exceptions also leave it blocked.
          this.publishFailure = 'BLOG_PUBLISH_PROBE_BLOCKED';
          try { await this.env.publishProbe.record(request, this.requestProof); }
          catch { this.publishFailure = 'BLOG_PUBLISH_PROBE_EVIDENCE_FAILED'; }
          return false;
        }
        if (!allowedWindow || new URL(request.url).pathname !== '/RabbitWrite.naver' || request.method !== 'POST') {
          this.publishFailure = 'BLOG_PUBLISH_REQUEST_NOT_AUTHORIZED'; return false;
        }
        if (this.visibility === 'private' && (!this.requestProof || !inspectPrivateRequest(request, this.requestProof))) {
          this.publishFailure = 'BLOG_PRIVATE_REQUEST_UNCONFIRMED'; return false;
        }
        return true;
      }, response => {
        try {
          if (response.status !== 200) throw new Error();
          const parsed = JSON.parse(response.body) as { isSuccess?: boolean; result?: { logNo?: unknown; postUrl?: unknown; url?: unknown }; logNo?: unknown; postUrl?: unknown };
          if (parsed.isSuccess === false) throw new Error();
          const result = parsed.result ?? parsed;
          const id = String(result.logNo ?? '');
          const rawUrl = 'postUrl' in result ? result.postUrl : undefined;
          const rawOther = 'url' in result ? result.url : undefined;
          const identity = postIdentity(typeof rawUrl === 'string' ? rawUrl : typeof rawOther === 'string' ? rawOther : '');
          if (!/^[0-9]+$/.test(id)) throw new Error();
          if (identity && identity.postId !== id) throw new Error();
          // Some responses return only logNo. Correlate the resulting URL later.
          this.responsePost = { postId: id, url: identity?.url ?? '' };
          if (identity) this.publishedPost = identity;
        } catch { this.publishFailure = 'BLOG_PUBLISH_RESPONSE_UNCONFIRMED'; }
      });
    }
    // Keep the previous composition until the new editor is available. Never close on stop/failure.
    await this.surface.open({ url: this.env.editorUrl ?? 'https://blog.naver.com/GoBlogWrite.naver', session: 'naver', width: 1280, height: 900, userAgent: ua });
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
    }, 30000);
    await this.guard();
    await prepareBlogEditor(this.surface, this.env.check, { autoRecover: this.recoveryConsent ? 'decline-with-user-consent' : 'stop' });
    this.recoveryConsent = false;
    this.checkpoint = await readBlogDocument(this.surface);
    if (previous) await this.env.host.destroy(previous);
  }
  private report() {
    const totalCharacters = this.plan.steps.reduce((n, s) => n + (s.kind === 'text' ? Array.from(s.text).length : s.kind === 'table' ? s.rows.flat().reduce((a, t) => a + Array.from(t).length, 0) : 0), 0);
    this.env.progress({ characters: this.characters, totalCharacters, photos: this.photos, totalPhotos: this.files.length,
      photoUploadMilliseconds: this.photoUploadMilliseconds, photoUploadSamples: this.photoUploadSamples });
  }
  private async type(text: string, resume = false) {
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
      this.report();
    }
  }
  private async endOfBody() {
    const s = this.surface!;
    const selector = '.se-component.se-text:last-child .se-text-paragraph:last-child';
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
    if (!atEnd) throw new Error('CURSOR_POSITION_UNCONFIRMED');
  }
  private async tagInput() {
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
  }
  async write() {
    this.executingStep = undefined;
    try { await this.writePlan(); }
    catch (error) {
      const step = this.executingStep;
      if (error instanceof ControlNotFoundError && step) throw error.atPlanStep(this.index + 1, step);
      throw error;
    } finally {
      this.executingStep = undefined;
      if (this.surface) await closeTagLayer(this.surface);
    }
  }
  private async writePlan() {
    for (const step of this.plan.steps) if (step.kind === 'photos' && step.urls.some(url => !this.files.find(f => f.url === url))) throw new Error('PREPARED_PHOTOS_MISSING');
    if (!this.surface) await this.fresh();
    else {
      await this.guard();
      const current = await readBlogDocument(this.surface);
      if (this.checkpoint && same(current, this.checkpoint)) {
        if (this.index === 0) { await click(this.surface, 'BLOG_TITLE', titleSelector); await this.surface.pressKey({ key: 'End' }); }
        else await this.endOfBody();
      } else if (this.checkpoint) {
        await this.fresh(); this.index = 0; this.offset = 0; this.characters = 0; this.photos = 0; this.tableModes.length = 0; this.atomic = false;
        this.photoUploadMilliseconds = 0; this.photoUploadSamples = 0;
      } else await prepareBlogEditor(this.surface, this.env.check, { autoRecover: this.recoveryConsent ? 'decline-with-user-consent' : 'stop' });
      this.recoveryConsent = false;
    }
    const s = this.surface!;
    for (; this.index < this.plan.steps.length; this.index++, this.offset = 0) {
      await this.guard(); const step = this.plan.steps[this.index]!;
      this.executingStep = step;
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
          this.photoUploadMilliseconds += Date.now() - started; this.photoUploadSamples++;
          this.report();
        }
      } else if (step.kind === 'table') {
        this.atomic = true;
        await this.table(step.rows);
      } else if (step.kind === 'text' && step.role === 'hashtags') {
        this.atomic = true;
        await this.tagInput();
        const start = this.characters;
        const expected = step.text.split(/\s+/).filter(Boolean).map(tag => tag.replace(/^#/, ''));
        for (const [index, tag] of expected.entries()) {
          await requireTagFocus(s);
          await this.type(tag);
          await requireTagFocus(s);
          await s.pressKey({ key: 'Enter' });
          await waitFor(async () => {
            await this.guard();
            const tags = (await readBlogDocument(s)).tags;
            return JSON.stringify(tags) === JSON.stringify(expected.slice(0, index + 1));
          });
        }
        // Progress counts the plan's # prefixes and separators after tag commit.
        this.characters = start + Array.from(step.text).length;
        // Converted plans can end with a separator. Return keyboard focus to the
        // body so those Enter keys never commit another tag. observe() reopens
        // the layer before reading metadata, including after a fresh draft load.
        await closeTagLayer(s);
        await this.endOfBody();
      } else if (step.kind === 'text') {
        await this.type(step.text, true);
        if (step.role === 'linkCard') {
          await s.pressKey({ key: 'Enter' }); await sleep(1500); await this.guard();
          this.linkCard = await read<boolean>(s, `return docs.some(({d})=>d.querySelector('.se-component.se-oglink'));`) ? 'card' : 'url-text';
        }
      }
      await this.guard(); this.checkpoint = await readBlogDocument(s); this.atomic = false; this.report();
    }
    this.executingStep = undefined;
    this.env.verify(await this.observe());
  }
  private async table(rows: string[][]) {
    const s = this.surface!;
    const original = await readBlogDocument(s);
    const fallback = async () => {
      this.tableModes.push('text-list');
      for (const [i, row] of rows.entries()) { if (i) await s.pressKey({ key: 'Enter' }); await this.type(row.join(' | ')); }
    };
    const before = await read<number>(s, `return docs.reduce((n,{d})=>n+d.querySelectorAll('.se-component.se-table').length,0);`);
    const control = await point(s, 'button[data-name="table"]');
    if (!control) return fallback();
    await s.click(control.x, control.y); await sleep(350); await this.guard();
    // Native editor starts with a 3x3 table. Use visible control buttons to adjust it.
    try { await waitFor(() => read(s, `return docs.some(({d})=>d.querySelectorAll('.se-component.se-table').length===${before + 1});`), 3000); }
    catch {
      await this.guard(); await s.pressKey({ key: 'Escape' });
      if (!same(original, await readBlogDocument(s))) throw new Error('TABLE_DIMENSIONS_UNSTABLE');
      await this.endOfBody(); return fallback();
    }
    const shape = () => read<number[]>(s, `const tables=docs.flatMap(({d})=>Array.from(d.querySelectorAll('.se-component.se-table')));const t=tables[tables.length-1];return Array.from(t?.querySelectorAll('tr')||[]).map(r=>r.querySelectorAll('td,th').length);`);
    let dimensions = await shape();
    const columns = Math.max(...rows.map(r => r.length));
    // A partially inserted table is never followed by a text fallback that could duplicate facts.
    if (!dimensions.length || dimensions.some(n => n !== columns) || dimensions.length > rows.length) {
      await s.pressKey({ key: 'z', modifiers: 2 }); await sleep(350); await this.guard();
      if (!same(original, await readBlogDocument(s))) throw new Error('TABLE_DIMENSIONS_UNSTABLE');
      await this.endOfBody(); return fallback();
    }
    while (dimensions.length < rows.length) {
      await click(s, 'BLOG_TABLE_ADD_ROW', '.se-table-control.se-is-on .se-cell-controlbar-row .se-cell-add-button:last-child');
      const previous = dimensions.length;
      dimensions = await waitFor(async () => { const v = await shape(); return v.length === previous + 1 ? v : null; }, 5000);
    }
    if (dimensions.length !== rows.length) throw new Error('TABLE_DIMENSIONS_UNSTABLE');
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < columns; c++) {
      await this.guard();
      // Read coordinates from the last table. Scroll using keys only when necessary.
      const cell = await waitFor(async () => {
        const p = await read<{ x: number; y: number } | null>(s, `for(const {d,x,y} of docs){const tables=d.querySelectorAll('.se-component.se-table');const t=tables[tables.length-1];const e=t?.querySelectorAll('tr')[${r}]?.querySelectorAll('td,th')[${c}];if(e){const b=e.getBoundingClientRect();if(y+b.top>=0&&y+b.bottom<innerHeight)return {x:x+b.left+b.width/2,y:y+b.top+b.height/2};}}return null;`);
        if (!p) await s.pressKey({ key: 'PageDown' }); return p;
      }, 5000);
      await s.click(cell.x, cell.y); await this.type(rows[r]?.[c] ?? '');
    }
    this.tableModes.push('native');
    await s.pressKey({ key: 'Escape' }); await s.pressKey({ key: 'ArrowDown' }); await this.endOfBody();
  }
  async observe() {
    try {
    await this.guard();
    await closeTagLayer(this.surface!);
    const started = Date.now(); let navigationKeys = 0;
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
    }, Math.max(30000, this.files.length * 2000));
    this.readbackTimings.push({ photos: observed.tokens.filter(t => t.kind === 'photo').length, milliseconds: Date.now() - started, navigationKeys });
    if (this.plan.steps.some(s => s.kind === 'text' && s.role === 'hashtags')) {
      await this.tagInput(); observed = await readBlogDocument(this.surface!);
    }
    return observed;
    } finally { await closeTagLayer(this.surface!); }
  }
  async saveAndVerify() {
    try { return await this.saveAndVerifyPlan(); }
    finally {
      // The layer was verified closed before save. A native save dialog blocks
      // all page reads; leave its answer to the app instead of querying behind it.
      if (this.surface && !await this.dialog()) await closeTagLayer(this.surface);
    }
  }
  private async saveAndVerifyPlan() {
    await this.guard();
    if (this.verified) { const observed = await this.observe(); this.env.verify(observed); return observed; }
    if (!this.saveAttempted) {
      this.env.verify(await this.observe());
      await requireTagLayerClosed(this.surface!);
      this.env.check(); this.env.beforeSave();
      // Mark BEFORE sending input. Ambiguous transport responses never cause another save.
      this.saveAttempted = true;
      try {
        await requireTagLayerClosed(this.surface!);
        await click(this.surface!, 'BLOG_SAVE', 'button[data-click-area="tpb.save"]');
      }
      catch (error) {
        if (await this.dialog()) throw new Error('USER_DIALOG_REQUIRED');
        if (error instanceof Error && /^BLOG_TAG_/.test(error.message)) throw error;
        /* Resolve ambiguous transport from the list, never retry input. */
      }
      await sleep(800);
      await this.guard();
    }
    if (!this.reopened) { await this.fresh(); this.reopened = true; }
    await this.guard();
    const s = this.surface!;
    const opened = await read<boolean>(s, `return docs.some(({d})=>Array.from(d.querySelectorAll('[aria-label="임시저장된 글"]')).some(visible));`);
    if (!opened) await click(s, 'BLOG_DRAFT_LIST', 'button[data-click-area="tpb*s.count"]');
    const selector = '[aria-label="임시저장된 글"] > li button[data-click-area="tpb*s.tlist"] strong';
    const count = await waitFor(() => read<number | null>(s, `const n=docs.reduce((n,{d})=>n+Array.from(d.querySelectorAll(${JSON.stringify(selector)})).filter(e=>(e.textContent||'').trim()===${JSON.stringify(this.title.text)}).length,0);return n||null;`), 15000);
    if (count !== 1) throw new Error('DRAFT_IDENTITY_AMBIGUOUS');
    await this.guard(); await click(s, 'BLOG_DRAFT_ITEM', selector, this.title.text);
    await waitFor(async () => (await readBlogDocument(s)).title === this.title.text, 15000);
    const observed = await this.observe(); this.env.verify(observed); this.verified = true; return observed;
  }
  async publish() {
    if (this.env.mode !== 'publish' || !this.verified || !this.env.publishEnabled && !this.env.localPublish) throw new Error('REAL_PUBLISH_DISABLED');
    if (this.publishAttempted) throw new Error('BLOG_PUBLISH_ALREADY_ATTEMPTED');
    await this.guard(); this.env.verify(await this.observe());
    const s = this.surface!;
    try {
      await click(s, 'BLOG_PUBLISH', tagPanelToggle);
      this.publishInteraction = true;
      await selectVisibility(s, this.visibility);
      this.requestProof = await readVisibility(s, this.visibility);
      requireVisibility(this.requestProof, this.visibility);
      this.publishArmed = true;
      // Latch before input; failures, timeouts, stop/resume never republish.
      this.publishAttempted = true;
      await guardedPublishClick(s, this.visibility, this.env.check, proof => { this.requestProof = proof; });
      await waitFor(async () => {
        this.env.check();
        if (this.publishFailure) throw new Error(this.publishFailure);
        if (!this.responsePost) return false;
        const urls = await read<string[]>(s, `return docs.map(({d})=>d.location.href);`).catch(() => []);
        const identity = urls.map(postIdentity).find(v => v?.postId === this.responsePost!.postId);
        if (!identity || this.responsePost.url && identity.url !== this.responsePost.url) return false;
        this.publishedPost = identity;
        return true;
      }, 30000);
      await this.verifyPublished();
      return this.publishedPost!.url;
    } finally {
      this.publishArmed = false; this.publishInteraction = false;
      if (!this.publishedPost && !await this.dialog()) await closeTagLayer(s);
    }
  }
  async verifyPublished() {
    if (!this.publishedPost) throw new Error('BLOG_PUBLISH_ID_UNCONFIRMED');
    const s = this.surface!;
    const started = Date.now(); let navigationKeys = 0;
    const value = await waitFor(async () => {
      this.env.check();
      const actual = await readBlogDocument(s).catch(() => null);
      if (!actual) return false;
      if (actual.tokens.every(t => t.kind !== 'photo' || t.identity)) return actual;
      const focus = await point(s, titleSelector);
      if (!focus || !await s.readClickTarget?.(focus.x, focus.y, titleSelector)) throw new Error('BLOG_PUBLISHED_FOCUS_UNCONFIRMED');
      await s.click(focus.x, focus.y);
      await s.pressKey({ key: 'PageDown' }); navigationKeys++;
      return false;
    }, Math.max(30000, this.files.length * 2000));
    const identities = await read<string[]>(s, `return docs.map(({d})=>d.location.href);`);
    if (!identities.some(url => postIdentity(url)?.url === this.publishedPost!.url)) throw new Error('BLOG_PUBLISH_ID_UNCONFIRMED');
    if (this.visibility === 'private') {
      const privateMarked = await read<boolean>(s, `return docs.some(({d})=>Array.from(d.querySelectorAll('.post_visibility, .blog2_visibility, .post_author, .blog2_container, [data-post-visibility]')).some(e=>visible(e)&&(e.textContent||'').trim()==='비공개'));`);
      if (!privateMarked) throw new Error('BLOG_PUBLISHED_PRIVATE_UNCONFIRMED');
    }
    this.env.verify(value);
    this.readbackTimings.push({ photos: value.tokens.filter(t => t.kind === 'photo').length, milliseconds: Date.now() - started, navigationKeys });
    this.publishedVerified = true;
    return value;
  }
  async show() { await this.surface?.show(); }
  async hide() { await this.surface?.hide(); }
  async close() { if (this.surface) await this.env.host.destroy(this.surface); }
}
