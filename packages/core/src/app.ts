import { randomUUID } from 'node:crypto';
import { requireDeletablePost, removeRecordedBlogPost, deletedUpdate } from './post-delete';
import { ApiError, type ApiClient, type Channel, type PostStatus, type Product, type PostInput } from '@goltou/api-client';
import { FakeRegistrationRunner, type RegistrationRunner } from './runner';
import type { AppRequest, AppSnapshot, Job, JobInput, TokenStore } from './protocol';
import { makePreview, preparePreview, preparationWork, type PreparationServices, type PreparedPreview } from './preparation';
import { RecordError } from './record-checkpoint';
import { MemoryPolishStrengthStore, type PolishStrengthStore } from './polish/setting';
export class MemoryTokenStore implements TokenStore {
  private token: string | null = null;
  async read() { return this.token; }
  async write(token: string | null) { this.token = token; }
}
export class AppCore {
  readonly state: AppSnapshot = { user: null, settings: null, services: { naver: 'confirmed', band: 'expired', ai: 'unknown' }, visibleService: null, job: null, simulation: { tickMs: 140, loginAt: null, failAt: null } };
  private readonly listeners = new Set<(state: AppSnapshot) => void>();
  private runner: RegistrationRunner;
  private readonly createRunner: () => RegistrationRunner;
  private deleting = false;
  private deleteConfirmation: { key: string; post: import('@goltou/api-client').Post } | undefined;
  private pendingDeleteUpdate: import('@goltou/api-client').PostUpdate | undefined;
  private starting = false;
  private preparing = false;
  private authenticating = false;
  private initialization: Promise<void> | undefined;
  private preview: { product: Product; options: PostInput['options']; result: PreparedPreview; reverted: string[] } | undefined;
  private uncertainStart = false;
  private records: { postNo: number; channel: Channel; key: string; status: PostStatus; updates: Map<string, RecordError | null> }[] = [];
  private recordPrivateText: string[] = [];
  private deletionRecording: import('./record-checkpoint').RecordingCheckpoint | undefined;
  private readonly polishSetting: PolishStrengthStore;
  constructor(private readonly api: ApiClient, private readonly tokens: TokenStore = new MemoryTokenStore(), factory?: (checkpoint: import('./runner').Checkpoint, notify: (job: Job) => void) => RegistrationRunner, private readonly preparation?: PreparationServices, private readonly runtime?: { device: () => Promise<import('@goltou/api-client').LoginInput['device']>; deleteHost?: import('@goltou/surface').SurfaceHost; deleteLog?: import('@goltou/sites').DeleteLog; experimentTitle?: boolean; experimentTitleLabel?: string; polishStrength?: PolishStrengthStore }) {
    this.polishSetting = runtime?.polishStrength ?? new MemoryPolishStrengthStore();
    const notify = (job: Job) => { if (!this.state.user) return; this.state.job = job; if (job.status === 'login_paused' && job.service) { this.state.services[job.service] = 'expired'; this.state.visibleService = job.service; } this.emit(); };
    this.createRunner = () => factory ? factory((job, retry) => this.record(job, retry), notify) : new FakeRegistrationRunner(() => this.state.simulation, job => this.record(job), notify);
    this.runner = this.createRunner();
    if (this.runner.checkLogin) { this.state.realBlog = true; this.state.services.naver = 'unknown'; }
    if (this.runner.listBands) { this.state.realBand = true; this.state.services.band = 'unknown'; }
  }
  subscribe(listener: (state: AppSnapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): AppSnapshot { return structuredClone(this.state); }
  /** Restore an already provisioned session; never submits credentials or calls login. */
  async restoreSession() {
    const { user, settings } = await this.call('/auto/me', {}, await this.token());
    this.state.user = user; this.state.settings = settings; this.emit();
  }
  private emit() { for (const listener of this.listeners) listener(this.snapshot()); }
  dispose() { this.runner.dispose(); this.listeners.clear(); }
  /** Debug entry supplies the deletion capability; release exposes no command. */
  async cleanupTestPost(remove: (execution: import('@goltou/sites').BlogExecution) => Promise<void>) {
    const job = this.runner.job, execution = this.runner.blogExecution?.();
    if (this.starting || !job || job.status === 'running' || !execution || job.mode !== 'publish' || !job.title.startsWith('[골투오토 실험]') || job.testPostDeleted) throw new ApiError('invalid', '이번 작업의 실험 발행 글만 삭제할 수 있습니다.');
    await remove(execution);
    job.testPostDeleted = true; job.status = 'stopped'; job.message = '실험 글 삭제 확인';
    const result = job.targetResults?.find(t => t.channel === 'blog');
    if (!result) throw new Error('BLOG_TEST_DELETE_RECORD_MISSING');
    result.status = 'stopped'; result.reason = 'BLOG_TEST_POST_DELETED'; delete result.postUrl;
    delete job.postUrl;
    // The same checkpoint/retry path updates the original record only.
    const { RecordingCheckpoint } = await import('./record-checkpoint');
    this.deletionRecording = new RecordingCheckpoint((value, retry) => this.record(value, retry), value => { this.state.job = value; this.emit(); });
    await this.deletionRecording.emit(job);
  }
  private async token(): Promise<string> { const token = await this.tokens.read(); if (!token) throw new ApiError('auth', '다시 로그인해 주세요.'); return token; }
  private async clearSession() { await this.tokens.write(null); this.initialization = Promise.resolve(); this.preview = undefined; this.records = []; this.recordPrivateText = []; this.deleteConfirmation = undefined; this.pendingDeleteUpdate = undefined; delete this.state.postDeletion; this.state.user = null; this.state.settings = null; this.state.job = null; this.emit(); }
  private async call<P extends keyof import('@goltou/api-client').ApiRoutes>(path: P, input: import('@goltou/api-client').ApiRoutes[P]['input'], token?: string): Promise<import('@goltou/api-client').ApiRoutes[P]['output']> {
    try { return await this.api.request(path, input, token); }
    catch (error) {
      if (error instanceof ApiError && ['auth', 'forbidden'].includes(error.code)) { this.runner.dispose(); await this.clearSession(); this.runner = this.createRunner(); }
      throw error;
    }
  }
  /** Called only once on launch; a failed request is never retried automatically. */
  async initialize() {
    this.initialization ??= (async () => { if (await this.tokens.read()) await this.restoreSession(); })();
    return this.initialization;
  }
  async auditProducts<T>(run: (api: ApiClient, token: string) => Promise<T>): Promise<T> {
    if (this.preparing || this.starting || this.state.job && !['draft_saved', 'published', 'stopped'].includes(this.state.job.status)) throw new ApiError('conflict', '진행 중인 작업을 먼저 마쳐 주세요.');
    this.preparing = true;
    try { return await run({ request: (route, input, token) => this.call(route, input, token) }, await this.token()); }
    finally { this.preparing = false; }
  }
  async handle(request: AppRequest): Promise<unknown> {
    if (this.deleting && !['session.get', 'posts.list', 'products.list', 'products.get'].includes(request.command)) throw new ApiError('conflict', '글 삭제가 진행 중입니다.');
    if (request.command === 'polish.setting.get') return this.polishSetting.read();
    if (request.command === 'polish.setting.save') {
      const strength = request.input.strength;
      if (strength !== 'spelling' && strength !== 'natural') throw new ApiError('invalid', '문장 다듬기 수준을 확인해 주세요.');
      await this.polishSetting.write(strength); return strength;
    }
    if (request.command === 'session.get') { await this.initialize(); return this.snapshot(); }
    if (this.preparation?.ai && ((request.command === 'service.show' || request.command === 'service.check' || request.command === 'service.clear') && request.input.service === 'ai' || request.command === 'service.hide' && this.state.visibleService === 'ai')) {
      if (this.preparing || this.starting || this.state.job?.status === 'running') throw new ApiError('conflict', '진행 중인 작업을 먼저 마쳐 주세요.');
      if (request.command === 'service.show') { await this.preparation.ai.show(); this.state.visibleService = 'ai'; }
      if (request.command === 'service.hide') { await this.preparation.ai.hide(); this.state.visibleService = null; }
      if (request.command === 'service.clear') { await this.preparation.ai.clear(); this.state.visibleService = null; this.preview = undefined; }
      // An input box or the owner's click does not prove Google authentication.
      this.state.services.ai = 'unknown'; this.emit(); return this.snapshot();
    }
    if (request.command === 'login') {
      if (this.authenticating) { request.input.password = ''; request.input.loginId = ''; throw new ApiError('conflict', '로그인 요청이 진행 중입니다.'); }
      if (this.state.user) { request.input.password = ''; request.input.loginId = ''; throw new ApiError('conflict', '먼저 로그아웃해 주세요.'); }
      this.authenticating = true;
      try {
        if (this.runtime) request.input.device = await this.runtime.device();
        let result;
        try { result = await this.call('/auto/login', request.input); }
        finally { request.input.password = ''; request.input.loginId = ''; }
        await this.tokens.write(result.token);
        const me = await this.call('/auto/me', {}, result.token);
        this.initialization = Promise.resolve(); this.state.user = me.user; this.state.settings = me.settings;
        this.emit(); return this.snapshot();
      } finally { request.input.password = ''; request.input.loginId = ''; this.authenticating = false; }
    }
    const token = await this.token();
    switch (request.command) {
      case 'logout':
        if (this.preparing || this.starting || (this.runner.job && (this.runner.job.status === 'record_failed' || !['draft_saved', 'published', 'stopped'].includes(this.runner.job.status) && !this.runner.job.completedSteps.includes(7)))) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
        try { await this.call('/auto/logout', {}, token); } finally { await this.clearSession(); } break;
      case 'products.list': return this.call('/auto/products/list', request.input, token);
      case 'products.get': return this.call('/auto/products/get', request.input, token);
      case 'preview.prepare': {
        if (this.preparing || this.starting || this.state.job?.status === 'running') throw new ApiError('conflict', '진행 중인 작업을 먼저 마쳐 주세요.');
        this.preparing = true;
        try {
          const product = this.forRegistration(await this.call('/auto/products/get', { productNo: request.input.productNo }, token));
          const options = request.input.options;
          const previous = this.preview;
          const reusable = !request.input.retryPolish && options.polish && previous?.options.polish && (options.polishStrength ?? 'spelling') === (previous.options.polishStrength ?? 'spelling') && previous.product.productNo === product.productNo && previous.product.contentHash === product.contentHash && previous.result.polish;
          const reverted = reusable ? previous.reverted : [];
          const result = reusable ? makePreview(product, this.convertOptions(options), undefined, reusable, reverted) : await preparePreview(product, { ...this.convertOptions(options), polish: options.polish }, this.preparation?.polish);
          this.preview = { product, options: { ...options }, result, reverted };
          return structuredClone(result);
        } finally { this.preparing = false; }
      }
      case 'preview.revert': {
        const preview = this.preview;
        if (this.preparing || !preview || preview.product.productNo !== request.input.productNo || !preview.result.polish?.paragraphs.some(p => p.id === request.input.paragraphId)) throw new ApiError('invalid', '확인할 문단을 다시 선택해 주세요.');
        preview.reverted = [...new Set([...preview.reverted, request.input.paragraphId])];
        preview.result = makePreview(preview.product, this.convertOptions(preview.options), undefined, preview.result.polish, preview.reverted);
        return structuredClone(preview.result);
      }
      case 'posts.delete.prepare': {
        this.requireDeleteIdle();
        const post = await this.ownedPost(request.input.postNo, token);
        requireDeletablePost(post);
        const key = randomUUID(); this.deleteConfirmation = { key, post };
        return { confirmation: key, productTitle: post.productTitle };
      }
      case 'posts.delete.confirm': {
        this.requireDeleteIdle();
        const confirmation = this.deleteConfirmation; this.deleteConfirmation = undefined;
        if (!confirmation || confirmation.key !== request.input.confirmation) throw new ApiError('invalid', '삭제할 글을 다시 선택하고 확인해 주세요.');
        this.deleting = true;
        try {
          const post = await this.ownedPost(confirmation.post.postNo, token);
          requireDeletablePost(post);
          if (['postUrl', 'productTitle', 'startedAt', 'productNo'].some(key => post[key as keyof typeof post] !== confirmation.post[key as keyof typeof post])) throw new ApiError('conflict', '기록이 바뀌었습니다. 삭제할 글을 다시 확인해 주세요.');
          if (!this.runtime?.deleteHost) throw new ApiError('invalid', '블로그 삭제 기능을 사용할 수 없습니다.');
          await removeRecordedBlogPost(this.runtime.deleteHost, post, this.runtime.deleteLog);
          this.pendingDeleteUpdate = deletedUpdate(post);
          this.state.postDeletion = { postNo: post.postNo, verifiedGone: true, recorded: false };
          this.emit();
          await this.saveDeletion(token);
        } finally { this.deleting = false; }
        return this.snapshot();
      }
      case 'posts.delete.retryRecord': {
        if (this.deleting || !this.pendingDeleteUpdate) throw new ApiError('conflict', '다시 기록할 삭제 결과가 없습니다.');
        this.deleting = true;
        try { await this.saveDeletion(token); } finally { this.deleting = false; }
        return this.snapshot();
      }
      case 'posts.list': return this.call('/auto/posts/list', request.input, token);
      case 'settings.save': await this.call('/auto/settings/save', request.input, token); this.state.settings = (await this.call('/auto/me', {}, token)).settings; break;
      case 'service.check': this.state.services[request.input.service] = request.input.service === 'ai' ? 'unknown' : request.input.service === 'band' && this.runner.checkBandLogin ? await this.runner.checkBandLogin() : request.input.service === 'naver' && this.runner.checkLogin ? await this.runner.checkLogin() : 'confirmed'; break;
      case 'service.show': await this.runner.showService?.(request.input.service); this.state.visibleService = request.input.service; break;
      case 'service.hide': await this.runner.hideService?.(); this.state.visibleService = null; break;
      case 'service.clear': this.state.services[request.input.service] = 'unknown'; if (this.state.visibleService === request.input.service) this.state.visibleService = null; break;
      case 'simulation.configure': {
        const c = request.input;
        if ((c.tickMs !== undefined && (!Number.isFinite(c.tickMs) || c.tickMs < 10 || c.tickMs > 10000)) || [c.loginAt, c.failAt].some(n => n !== undefined && n !== null && (!Number.isInteger(n) || n < 1 || n > 7))) throw new ApiError('invalid', '가짜 실행 설정을 확인해 주세요.');
        Object.assign(this.state.simulation, c); break;
      }
      case 'job.start': await this.start(request.input, token); return this.snapshot();
      case 'job.stop': await this.runner.stop(); return this.snapshot();
      case 'job.recovery':
        if (!this.runner.recover || typeof request.input.discard !== 'boolean') throw new ApiError('invalid', '자동복구 선택을 확인해 주세요.');
        await this.runner.recover(request.input.discard); return this.snapshot();
      case 'job.dialog':
        if (!this.runner.answerDialog || typeof request.input.id !== 'string' || typeof request.input.accept !== 'boolean') throw new ApiError('invalid', '확인창 선택을 확인해 주세요.');
        await this.runner.answerDialog(request.input.id, request.input.accept); return this.snapshot();
      case 'draft.show':
        if (!this.runner.showDraft) throw new ApiError('invalid', '이 실행기는 실제 임시글을 열 수 없습니다.');
        await this.runner.showDraft(request.input.title); return this.snapshot();
      case 'bands.list':
        if (this.starting || this.state.job && (this.state.job.status === 'record_failed' || !['draft_saved', 'published', 'stopped'].includes(this.state.job.status) && !this.state.job.completedSteps.includes(7))) throw new ApiError('conflict', '진행 중인 작업을 먼저 마쳐 주세요.');
        return this.runner.listBands ? this.runner.listBands() : [{ key: 'travel', name: '골투 여행', photoLimit: null, observedAt: null }, { key: 'golf', name: '해외골프 모임', photoLimit: null, observedAt: null }];
      case 'band.show':
        if (!this.runner.showBand) throw new ApiError('invalid', '열 수 있는 밴드 작성기가 없습니다.');
        await this.runner.showBand(request.input.key); return this.snapshot();
      case 'band.check': await this.runner.checkBand?.(); return this.snapshot();
      case 'band.discard':
        if (!this.runner.discardBand) throw new ApiError('invalid', '버릴 밴드 작성기가 없습니다.');
        await this.runner.discardBand(); return this.snapshot();
      case 'job.continueBand':
        if (!this.runner.continueBand) throw new ApiError('invalid', '진행할 밴드 단계가 없습니다.');
        await this.runner.continueBand(); return this.snapshot();
      case 'job.resume':
        if (this.runner.job?.status === 'login_paused' && this.runner.job.service && this.state.services[this.runner.job.service] !== 'confirmed') throw new ApiError('auth', '로그인 상태를 먼저 확인해 주세요.');
        this.state.visibleService = null; await this.runner.resume(); return this.snapshot();
      case 'job.retryRecord':
        if (this.deletionRecording && this.runner.job?.testPostDeleted) { await this.deletionRecording.retry(this.runner.job); return this.snapshot(); }
        if (!this.runner.retryRecord) throw new ApiError('invalid', '다시 시도할 기록이 없습니다.');
        await this.runner.retryRecord(); return this.snapshot();
      default: throw new ApiError('invalid', '지원하지 않는 요청입니다.');
    }
    this.emit(); return this.snapshot();
  }
  private requireDeleteIdle() {
    if (this.deleting || this.starting || this.preparing || this.pendingDeleteUpdate || this.state.job && !['draft_saved', 'published', 'stopped'].includes(this.state.job.status)) throw new ApiError('conflict', '진행 중인 작업과 기록을 먼저 마쳐 주세요.');
  }
  private async ownedPost(postNo: number, token: string) {
    if (!Number.isSafeInteger(postNo) || postNo < 1) throw new ApiError('invalid', '등록 기록을 다시 선택해 주세요.');
    for (let page = 1; ; page++) {
      const result = await this.call('/auto/posts/list', { scope: 'mine', page, pageSize: 50 }, token);
      const matches = result.items.filter(p => p.postNo === postNo);
      if (matches.length === 1) return matches[0]!;
      if (!result.items.length || page * 50 >= result.total) break;
    }
    throw new ApiError('forbidden', '내 등록 기록에서 찾을 수 없는 글은 삭제할 수 없습니다.');
  }
  private async saveDeletion(token: string) {
    const update = this.pendingDeleteUpdate!;
    try {
      await this.call('/auto/posts/update', update, token);
      const saved = await this.ownedPost(update.postNo, token);
      if (saved.status !== update.status || saved.failReason !== update.failReason || saved.postUrl !== '' || !saved.finishedAt) throw new ApiError('server', '삭제 기록을 다시 읽어 확인하지 못했습니다.');
      this.state.postDeletion = { postNo: update.postNo, verifiedGone: true, recorded: true, at: saved.finishedAt };
      this.pendingDeleteUpdate = undefined; this.emit();
    } catch (error) {
      throw new RecordError(error, [token]);
    }
  }
  private async start(input: JobInput, token: string) {
    if (this.pendingDeleteUpdate) throw new ApiError('conflict', '삭제 결과 기록을 먼저 마쳐 주세요.');
    if (this.uncertainStart) throw new ApiError('conflict', '이전 기록 시작 요청의 결과를 확인하지 못했습니다. 등록 기록을 확인해 주세요.');
    if (this.preparing || this.starting || (this.runner.job && (this.runner.job.status === 'record_failed' || !['draft_saved', 'published', 'stopped'].includes(this.runner.job.status) && !this.runner.job.completedSteps.includes(7)))) throw new ApiError('conflict', '한 번에 한 작업만 등록할 수 있습니다.');
    if (!input.targets.length || new Set(input.targets.map(t => `${t.channel}:${t.key}`)).size !== input.targets.length) throw new ApiError('invalid', '올릴 곳을 선택해 주세요.');
    if (input.mode === 'publish' && input.publishConfirmed !== true) throw new ApiError('invalid', '발행 전에 한 번 더 확인해 주세요.');
    if (!['draft', 'publish'].includes(input.mode) || input.blogVisibility !== undefined && !['public', 'private'].includes(input.blogVisibility)) throw new ApiError('invalid', '등록 방식과 공개 범위를 확인해 주세요.');
    this.starting = true; this.records = [];
    try {
      const product = this.forRegistration(await this.call('/auto/products/get', { productNo: input.productNo }, token));
      let preview: PreparedPreview;
      if (input.options.polish) {
        const cached = this.preview;
        if (!cached || cached.product.productNo !== product.productNo || cached.result.contentHash !== product.contentHash || (cached.options.polishStrength ?? 'spelling') !== (input.options.polishStrength ?? 'spelling') || (['polish', 'closing', 'linkCard'] as const).some(key => cached.options[key] !== input.options[key])) throw new ApiError('invalid', '상품 또는 옵션이 바뀌었습니다. 내용을 다시 확인해 주세요.');
        preview = cached.result;
      } else preview = makePreview(product, this.convertOptions(input.options));
      if (input.previewHash && input.previewHash !== product.contentHash) throw new ApiError('invalid', '상품이 바뀌었습니다. 내용을 다시 확인해 주세요.');
      const mismatch = input.targets.map(t => preview.verification[t.channel]).find(v => !v.matches);
      if (mismatch) throw new ApiError('invalid', mismatch.message);
      for (const target of input.targets) {
        let postNo: number;
        try { this.uncertainStart = true; ({ postNo } = await this.call('/auto/posts/start', { productNo: input.productNo, channel: target.channel, mode: input.mode, target: { name: target.name, key: target.key }, options: input.options, contentHash: product.contentHash }, token)); this.uncertainStart = false; }
        catch (error) { if (error instanceof ApiError && error.code !== 'server') this.uncertainStart = false; if (target.channel === 'band' && error instanceof ApiError && error.code === 'conflict') throw new ApiError('conflict', `${target.name}: ${error.message}`); throw error; }
        this.records.push({ postNo, channel: target.channel, key: target.key, status: 'running', updates: new Map() });
      }
      this.recordPrivateText = [product.title, ...product.golfCourses, ...preview.blog.steps.flatMap(step => step.kind === 'text' ? [step.text] : step.kind === 'table' ? step.rows.flat() : [])];
      await this.runner.start(input, product.title, product.images.length, this.preparation ? preparationWork(product, preview, this.preparation) : undefined);
    } catch (error) {
      for (const record of this.records) await this.call('/auto/posts/update', { postNo: record.postNo, status: 'stopped', step: 1, failReason: '작업 시작 실패', postUrl: '' }, token);
      throw error;
    } finally { this.starting = false; }
  }
  private forRegistration(product: Product): Product { return this.runtime?.experimentTitle ? { ...product, title: `[골투오토 실험] ${this.runtime.experimentTitleLabel ?? ''}${product.title}` } : product; }
  private convertOptions(options: PostInput['options']) {
    return { closing: options.closing, closingText: this.state.settings?.closingText ?? '', linkCard: options.linkCard, hashtags: this.state.settings?.defaultHashtags ?? [], polishStrength: options.polishStrength ?? 'spelling' };
  }
  private async record(job: Job, retry = false) {
    const token = await this.token();
    for (const record of this.records) {
      if (['draft_saved', 'published'].includes(record.status) && !(record.channel === 'blog' && job.testPostDeleted && record.status === 'published')) continue;
      const saved = job.completedSteps.includes(record.channel === 'blog' ? 5 : 6);
      const result = job.targetResults?.find(t => t.channel === record.channel && t.key === record.key);
      const status: PostStatus = (result?.status === 'running' && job.status === 'user_paused' ? 'stopped' : result?.status) ?? (saved ? (record.channel === 'band' && job.mode === 'draft' ? 'stopped_before_post' : job.mode === 'draft' ? 'draft_saved' : 'published') : job.status === 'failed' ? 'failed' : job.status === 'user_paused' ? 'stopped' : 'running');
      const update = { postNo: record.postNo, status, step: job.step, failReason: ['failed', 'stopped'].includes(status) ? (result?.reason ?? job.message) : '', postUrl: status === 'published' ? (result?.postUrl ?? job.postUrl ?? (job.targetResults ? '' : `https://example.invalid/posts/${record.postNo}`)) : '' };
      const identity = JSON.stringify(update);
      if (record.updates.has(identity)) {
        const failure = record.updates.get(identity);
        if (!failure) continue;
        if (!retry) throw failure; // Only the explicit record action may resend an uncertain update.
      }
      try { await this.call('/auto/posts/update', update, token); }
      catch (error) {
        const failure = new RecordError(error, [token, job.title, ...this.recordPrivateText]);
        record.updates.set(identity, failure); throw failure;
      }
      record.updates.set(identity, null);
      record.status = status;
    }
  }
}
