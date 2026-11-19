import { beginTrace, currentTrace, inTrace, trace, traceJob, reasonCode, type TraceJob } from '@goltou/surface/telemetry';
import { randomUUID } from 'node:crypto';
import { requireDeletablePost, removeRecordedBlogPost, removeRecordedBandPost, deletedUpdate } from './post-delete';
import { ApiError, defaultMyText, type ApiClient, type Channel, type PostStatus, type PostUpdate, type Product } from '@goltou/api-client';
import { FakeRegistrationRunner, type RegistrationRunner } from './runner';
import type { AppRequest, AppSnapshot, Job, JobInput, JobOptions, TargetResult, TokenStore } from './protocol';
import { makePreview, preparePreview, preparationWork, type PreparationServices, type PreparedPreview } from './preparation';
import { RecordError } from './record-checkpoint';
import { MemoryPolishStrengthStore, type PolishStrengthStore } from './polish/setting';
import { updateJobBusy } from './app-update';
import { MemoryPreferencesStore, migratePreferences, type PreferencesStore } from './preferences';
import { fillMyText, validMyText } from './convert';
import { PostTraceQueue } from './post-trace-queue';
import { canRetryJob } from './job-safety';
import { MemoryPostMetadata, type PostMetadataStore } from './post-metadata';
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
  private deleteConfirmation: { key: string; post: import('@goltou/api-client').Post; log?: TraceJob } | undefined;
  private pendingDeleteUpdate: import('@goltou/api-client').PostUpdate | undefined;
  private starting = false;
  private transferringLocalData = false;
  private preparing = false;
  private authenticating = false;
  private initialization: Promise<void> | undefined;
  private serviceTimer: ReturnType<typeof setTimeout> | undefined;
  private serviceUnsubscribe: (() => void) | undefined;
  private readonly pendingServiceChecks = new Set<'naver' | 'band'>();
  private disposed = false;
  private preview: { product: Product; options: JobOptions; result: PreparedPreview; reverted: string[] } | undefined;
  private lastInput: JobInput | undefined;
  private earlierResults: TargetResult[] | undefined;
  private uncertainStart = false;
  private jobPreview: PreparedPreview | null = null;
  private records: { postNo: number; channel: Channel; key: string; status: PostStatus; log?: TraceJob; claimed?: boolean; deferred?: { update: PostUpdate; error: RecordError }; updates: Map<string, RecordError | null> }[] = [];
  private readonly postTraces: PostTraceQueue | undefined;
  private recordPrivateText: string[] = [];
  private deletionRecording: import('./record-checkpoint').RecordingCheckpoint | undefined;
  private readonly polishSetting: PolishStrengthStore;
  private readonly preferences: PreferencesStore;
  private readonly postMetadata: PostMetadataStore;
  constructor(private readonly api: ApiClient, private readonly tokens: TokenStore = new MemoryTokenStore(), factory?: (checkpoint: import('./runner').Checkpoint, notify: (job: Job) => void) => RegistrationRunner, private readonly preparation?: PreparationServices, private readonly runtime?: { localData?: import('./local-data-transfer').LocalDataTransfer; transferLocalData?: (mode: 'export' | 'import', text?: string) => Promise<string | null>; logs?: import('./job-logs').JobLogStore; exportLogs?: () => Promise<void>; serviceChecks?: readonly ('naver' | 'band')[]; device: () => Promise<import('@goltou/api-client').LoginInput['device']>; deleteHost?: import('@goltou/surface').SurfaceHost; deleteLog?: import('@goltou/sites').DeleteLog; bandDeleteLog?: import('@goltou/sites').BandDeleteLog; bandDeleteReview?: import('@goltou/sites').BandDeleteReview; experimentTitle?: boolean; experimentTitleLabel?: string; polishStrength?: PolishStrengthStore; preferences?: PreferencesStore; postMetadata?: PostMetadataStore; openExternal?: (url: string) => Promise<void>; exit?: (event: import('./protocol').Commands['app.exit']['input']['event']) => Promise<void>; updater?: import('./app-update').AppUpdater }) {
    this.polishSetting = runtime?.polishStrength ?? new MemoryPolishStrengthStore();
    this.postMetadata = runtime?.postMetadata ?? new MemoryPostMetadata();
    this.preferences = runtime?.preferences ?? new MemoryPreferencesStore();
    this.postTraces = runtime?.logs && new PostTraceQueue(runtime.logs, api, async () => {
      const user = this.state.user;
      const token = await this.tokens.read();
      if (user && token && user === this.state.user) return { userNo: user.userNo, token };
    });
    const notify = (job: Job) => { if (!this.state.user) return; this.state.job = this.aggregateJob(job); if (!this.runner.serviceLogin && job.status === 'login_paused' && job.service) { this.state.services[job.service] = 'expired'; this.state.visibleService = job.service; } this.emit(); };
    this.createRunner = () => factory ? factory((job, retry) => this.record(job, retry), notify) : new FakeRegistrationRunner(() => this.state.simulation, job => this.record(job), notify);
    this.runner = this.createRunner();
    if (this.runner.checkLogin) { this.state.realBlog = true; this.state.services.naver = 'unknown'; }
    if (this.runner.listBands) { this.state.realBand = true; this.state.services.band = 'unknown'; }
    this.bindServiceLogin();
    runtime?.updater?.subscribe(() => this.emit());
  }
  private bindServiceLogin() {
    this.serviceUnsubscribe?.();
    const bands = this.runner.subscribeBands?.(value => {
      this.state.bandList = value; this.emit();
      if (!value.failure && !value.refreshing && (value.source === 'band' || value.savedAt !== null)) void this.keepAvailableBands(value.rows).catch(() => {});
    });
    const login = this.runner.serviceLogin?.subscribe(update => {
      this.state.services[update.service] = update.state;
      if (update.visible) this.state.visibleService = update.service;
      else if (this.state.visibleService === update.service) this.state.visibleService = null;
      if (update.error) this.state.serviceError = update.error; else delete this.state.serviceError;
      this.emit();
    });
    this.serviceUnsubscribe = () => { bands?.(); login?.(); };
    this.scheduleServiceChecks();
  }
  /** Native lifecycle supplies only elapsed background time; no platform API in core. */
  foregrounded(backgroundMs: number) { if (backgroundMs >= 5 * 60 * 1000) this.scheduleServiceChecks(); }
  serviceRuntimeReady() { this.scheduleServiceChecks(); }
  private serviceIdle() {
    return !this.disposed && !this.starting && !this.preparing && !this.deleting && !this.state.visibleService && !this.runner.serviceLogin?.active &&
      (!this.runner.job || ['draft_saved', 'draft_unverified', 'published', 'stopped'].includes(this.runner.job.status));
  }
  private scheduleServiceChecks() {
    if (!this.runner.serviceLogin || this.disposed) return;
    if (this.state.realBlog && (this.runtime?.serviceChecks?.includes('naver') ?? true)) this.pendingServiceChecks.add('naver');
    if (this.state.realBand && (this.runtime?.serviceChecks?.includes('band') ?? true)) this.pendingServiceChecks.add('band');
    clearTimeout(this.serviceTimer);
    this.serviceTimer = setTimeout(() => { void this.checkNextService(); }, 800);
  }
  private async checkNextService() {
    if (this.disposed || !this.pendingServiceChecks.size) return;
    if (this.serviceIdle()) {
      const service = this.pendingServiceChecks.values().next().value!;
      this.pendingServiceChecks.delete(service);
      await this.runner.serviceLogin!.check(service);
    }
    if (!this.disposed && this.pendingServiceChecks.size) this.serviceTimer = setTimeout(() => { void this.checkNextService(); }, 800);
  }
  private requireServiceIdle() {
    if (this.starting || this.preparing || this.deleting || this.runner.job && !['draft_saved', 'draft_unverified', 'published', 'stopped', 'login_paused'].includes(this.runner.job.status)) throw new ApiError('conflict', '진행 중인 작업을 먼저 마쳐 주세요.');
  }
  subscribe(listener: (state: AppSnapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): AppSnapshot { return structuredClone(this.state); }
  /** Restore an already provisioned session; never submits credentials or calls login. */
  async restoreSession() {
    const { user, settings, myText } = await this.call('/auto/me', {}, await this.token());
    this.state.user = user; this.state.settings = settings; this.state.myText = { ...defaultMyText(), ...myText }; this.emit();
    this.scheduleServiceChecks();
    this.postTraces?.retry();
  }
  private emit() {
    this.runtime?.updater?.setBlocked(!this.state.user || this.starting || this.preparing || this.deleting || updateJobBusy(this.state.job));
    if (this.runtime?.updater) this.state.update = this.runtime.updater.snapshot();
    for (const listener of this.listeners) listener(this.snapshot()); }
  dispose() { this.disposed = true; this.runtime?.updater?.dispose(); this.deleteConfirmation?.log?.end('stopped', 'USER_STOPPED'); this.postTraces?.dispose(); this.deleteConfirmation = undefined; clearTimeout(this.serviceTimer); this.serviceUnsubscribe?.(); this.runner.dispose(); this.listeners.clear(); }
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
  private async clearSession() { await this.tokens.write(null); this.initialization = Promise.resolve(); this.preview = undefined; this.jobPreview = null; this.records = []; this.recordPrivateText = []; this.deleteConfirmation = undefined; this.pendingDeleteUpdate = undefined; delete this.state.postDeletion; this.state.user = null; this.state.settings = null; delete this.state.myText; this.lastInput = undefined; this.earlierResults = undefined; this.state.job = null; this.emit(); }
  private async call<P extends keyof import('@goltou/api-client').ApiRoutes>(path: P, input: import('@goltou/api-client').ApiRoutes[P]['input'], token?: string): Promise<import('@goltou/api-client').ApiRoutes[P]['output']> {
    try { return await this.api.request(path, input, token); }
    catch (error) {
      if (error instanceof ApiError && ['auth', 'forbidden'].includes(error.code)) { this.runner.dispose(); await this.clearSession(); this.runner = this.createRunner(); this.bindServiceLogin(); }
      throw error;
    }
  }
  /** Called only once on launch; a failed request is never retried automatically. */
  async initialize() {
    this.initialization ??= (async () => { if (await this.tokens.read()) await this.restoreSession(); })();
    return this.initialization;
  }
  async auditProducts<T>(run: (api: ApiClient, token: string) => Promise<T>): Promise<T> {
    if (this.preparing || this.starting || this.state.job && !['draft_saved', 'draft_unverified', 'published', 'stopped'].includes(this.state.job.status)) throw new ApiError('conflict', '진행 중인 작업을 먼저 마쳐 주세요.');
    this.preparing = true;
    try { return await run({ request: (route, input, token) => this.call(route, input, token) }, await this.token()); }
    finally { this.preparing = false; }
  }
  async handle(request: AppRequest): Promise<unknown> {
    try { return await this.handleRequest(request); }
    finally { if (this.runtime?.updater && !this.disposed) this.emit(); }
  }
  private async handleRequest(request: AppRequest): Promise<unknown> {
    if (request.command === 'update.home' || request.command === 'update.check' || request.command === 'update.action') {
      const updater = this.runtime?.updater;
      if (!updater || !this.state.user) return {};
      updater.setBlocked(this.starting || this.preparing || this.deleting || updateJobBusy(this.state.job));
      if (request.command === 'update.home') void updater.check('auto');
      else if (request.command === 'update.check') await updater.check('manual');
      else if (!updateJobBusy(this.state.job) && !this.starting && !this.preparing && !this.deleting) {
        const action = request.input.action;
        if (action === 'open') updater.open();
        else if (action === 'later' || action === 'close') await updater.later();
        else if (action === 'download') void updater.download();
        else if (action === 'cancel') await updater.cancel();
        else if (action === 'settings') await updater.settings();
      }
      return {};
    }
    if (this.runtime?.updater?.busy && ['job.start', 'job.retryFailed', 'preview.prepare', 'posts.delete.prepare', 'posts.delete.confirm', 'localData.import', 'logout'].includes(request.command))
      throw new ApiError('conflict', '업데이트 확인 또는 설치를 먼저 마쳐 주세요.');
    if (this.transferringLocalData) throw new ApiError('conflict', '데이터 옮기기를 먼저 마쳐 주세요.');
    if (request.command === 'localData.export' || request.command === 'localData.import') {
      this.requireServiceIdle();
      if (this.state.visibleService || this.runner.serviceLogin?.active) throw new ApiError('conflict', '연결 창을 먼저 닫아 주세요.');
      if (!this.runtime?.localData || !this.runtime.transferLocalData) throw new ApiError('invalid', '이 기기에서는 데이터 옮기기를 사용할 수 없습니다.');
      this.starting = true; this.transferringLocalData = true;
      try {
        if (request.command === 'localData.export') {
          const text = await this.runtime.localData.export();
          return { cancelled: (await this.runtime.transferLocalData('export', text)) === null };
        }
        const text = await this.runtime.transferLocalData('import');
        if (text === null) return { cancelled: true };
        await this.runtime.localData.import(text);
        return { cancelled: false, preferences: await this.preferences.read(), polishStrength: await this.polishSetting.read() };
      } finally { this.starting = false; this.transferringLocalData = false; }
    }
    if (this.deleting && !['session.get', 'posts.list', 'products.list', 'products.get'].includes(request.command)) throw new ApiError('conflict', '글 삭제가 진행 중입니다.');
    if (request.command === 'preferences.get') return this.preferences.read();
    if (request.command === 'preferences.save') {
      const value = migratePreferences(request.input);
      if (!value) throw new ApiError('invalid', '글 옵션을 다시 확인해 주세요.');
      await this.preferences.write(value); return this.preferences.read();
    }
    if (request.command === 'polish.setting.get') return this.polishSetting.read();
    if (request.command === 'polish.setting.save') {
      const strength = request.input.strength;
      if (strength !== 'spelling' && strength !== 'natural') throw new ApiError('invalid', '문장 다듬기 수준을 확인해 주세요.');
      await this.polishSetting.write(strength); return strength;
    }
    if (request.command === 'logs.list') return this.runtime?.logs?.list() ?? [];
    if (request.command === 'logs.export') { if (!this.runtime?.exportLogs) throw new ApiError('invalid', '로그 내보내기를 사용할 수 없습니다.'); await this.runtime.exportLogs(); return {}; }
    if (request.command === 'session.get') { await this.initialize(); return this.snapshot(); }
    if (this.preparation?.ai && ((request.command === 'service.show' || request.command === 'service.check' || request.command === 'service.clear') && request.input.service === 'ai' || request.command === 'service.hide' && this.state.visibleService === 'ai')) {
      if (this.preparing || this.starting || this.runner.serviceLogin?.active || this.state.job?.status === 'running') throw new ApiError('conflict', '진행 중인 작업을 먼저 마쳐 주세요.');
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
        this.initialization = Promise.resolve(); this.state.user = me.user; this.state.settings = me.settings; this.state.myText = { ...defaultMyText(), ...me.myText };
        this.postTraces?.retry();
        this.scheduleServiceChecks();
        this.emit(); return this.snapshot();
      } finally { request.input.password = ''; request.input.loginId = ''; this.authenticating = false; }
    }
    const token = await this.token();
    switch (request.command) {
      case 'logout':
        if (this.preparing || this.starting || (this.runner.job && (this.runner.job.status === 'record_failed' || !['draft_saved', 'draft_unverified', 'published', 'stopped'].includes(this.runner.job.status) && !this.runner.job.completedSteps.includes(7)))) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
        try { await this.call('/auto/logout', {}, token); } finally { await this.clearSession(); } break;
      case 'products.list': return this.call('/auto/products/list', request.input, token);
      case 'products.get': return this.call('/auto/products/get', request.input, token);
      case 'app.exit': {
        const { event } = request.input;
        if (!['hint', 'confirm', 'cancel', 'finish'].includes(event)) throw new ApiError('invalid', '종료 요청을 확인해 주세요.');
        if (event === 'finish' && this.state.job?.status === 'running') await this.runner.stop();
        await this.runtime?.exit?.(event);
        return {};
      }
      case 'stats.today':
        if (this.state.user?.role !== 'admin') throw new ApiError('forbidden', '관리자만 오늘 현황을 볼 수 있습니다.');
        try { return await this.api.request('/auto/stats/today', {}, token); }
        catch (error) { if (error instanceof ApiError && error.code === 'not_found') return null; throw error; }
      case 'bands.dailyUsage': return this.bandDailyUsage(token);
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
        this.postTraces?.retry();
        const post = await this.ownedPost(request.input.postNo, token);
        requireDeletablePost(post);
        this.deleteConfirmation?.log?.end('stopped', 'USER_STOPPED');
        const log = beginTrace(post.channel === 'band' ? 'band_delete' : 'blog_delete', post.channel === 'band' ? 'band' : 'naver');
        if (log && this.state.user) this.postTraces?.track(log, post.postNo, post.channel, this.state.user.userNo, post.channel === 'band' ? new URL(post.postUrl).pathname.split('/')[2] ?? '' : post.targetName);
        const key = randomUUID(); this.deleteConfirmation = { key, post, ...(log ? { log } : {}) };
        log?.line('delete', 'wait', { reason: 'APP_PREPARED' });
        if (post.channel === 'band') this.runtime?.bandDeleteLog?.({ code: 'APP_PREPARED' });
        return { confirmation: key, productTitle: post.productTitle };
      }
      case 'posts.delete.cancel': {
        if (this.deleteConfirmation?.key === request.input.confirmation) { this.deleteConfirmation.log?.end('stopped', 'USER_STOPPED'); this.deleteConfirmation = undefined; }
        return {};
      }
      case 'posts.delete.confirm': {
        this.requireDeleteIdle();
        const confirmation = this.deleteConfirmation; this.deleteConfirmation = undefined;
        if (!confirmation || confirmation.key !== request.input.confirmation) { confirmation?.log?.end('stopped', 'DELETE_CONFIRMATION_MISMATCH'); throw new ApiError('invalid', '삭제할 글을 다시 선택하고 확인해 주세요.'); }
        return inTrace(confirmation.log, async () => {
        trace('delete', 'start', { reason: 'APP_CONFIRMED' });
        this.deleting = true;
        let outcome: 'succeeded' | 'stopped' | 'uncertain' | 'failed' = 'failed';
        let failure = reasonCode('UNEXPECTED_FAILURE');
        try {
          const post = await this.ownedPost(confirmation.post.postNo, token);
          requireDeletablePost(post);
          if (['postUrl', 'productTitle', 'startedAt', 'productNo', 'channel', 'targetName'].some(key => post[key as keyof typeof post] !== confirmation.post[key as keyof typeof post])) throw new ApiError('conflict', '기록이 바뀌었습니다. 삭제할 글을 다시 확인해 주세요.');
          if (!this.runtime?.deleteHost) throw new ApiError('invalid', '글 삭제 기능을 사용할 수 없습니다.');
          let alreadyAbsent = false;
          if (post.channel === 'band') {
            this.runtime.bandDeleteLog?.({ code: 'APP_CONFIRMED' });
            const result = await removeRecordedBandPost(this.runtime.deleteHost, post, this.runtime.bandDeleteLog, this.runtime.bandDeleteReview);
            if (result.status !== 'deleted') {
              this.state.postDeletion = { postNo: post.postNo, verifiedGone: false, recorded: false, outcome: result.status };
              outcome = result.status === 'uncertain' ? 'uncertain' : 'stopped'; failure = result.status === 'uncertain' ? 'UNCERTAIN' : 'NOT_STARTED';
              this.emit(); return this.snapshot();
            }
            alreadyAbsent = result.alreadyAbsent === true;
          } else await removeRecordedBlogPost(this.runtime.deleteHost, post, this.runtime.deleteLog);
          trace('verification', 'ok', { check: 'missing_read', counts: { expected: 1, observed: 1 } });
          this.pendingDeleteUpdate = deletedUpdate(post, alreadyAbsent);
          this.state.postDeletion = { postNo: post.postNo, verifiedGone: true, recorded: false, outcome: 'deleted' };
          this.emit();
          await this.saveDeletion(token); outcome = 'succeeded';
        } catch (error) { failure = reasonCode(error); trace('delete', 'fail', { reason: failure }); throw error; }
        finally { this.deleting = false; confirmation.log?.end(outcome, outcome === 'succeeded' ? undefined : failure); }
        return this.snapshot();
        });
      }
      case 'posts.delete.retryRecord': {
        if (this.deleting || !this.pendingDeleteUpdate) throw new ApiError('conflict', '다시 기록할 삭제 결과가 없습니다.');
        const band = this.pendingDeleteUpdate.failReason?.startsWith('BAND_');
        return traceJob(band ? 'band_delete' : 'blog_delete', band ? 'band' : 'naver', async () => {
        this.runtime?.logs?.associate(String(this.pendingDeleteUpdate!.postNo));
        trace('runner.record', 'retry', { reason: 'RECORD_FAILED' });
        this.deleting = true;
        try {
          const log = currentTrace();
          const postNo = this.pendingDeleteUpdate!.postNo;
          if (log && this.state.user) this.postTraces?.track(log, postNo, band ? 'band' : 'blog', this.state.user.userNo, String(postNo));
          trace('verification', 'ok', { check: 'missing_read', counts: { expected: 1, observed: 1 } });
          await this.saveDeletion(token);
        } finally { this.deleting = false; }
        return this.snapshot();
        });
      }
      case 'posts.list': {
        const page = await this.call('/auto/posts/list', request.input, token);
        return { ...page, items: await Promise.all(page.items.map(async post => ({ ...post, jobLog: this.runtime?.logs?.forRecord(String(post.postNo)), tableFallback: post.channel === 'blog' ? await this.postMetadata.getTableFallback(post.postNo) : false, blogVisibility: post.channel === 'blog' ? await this.postMetadata.get(post.postNo) ?? post.blogVisibility : undefined }))) };
      }
      case 'myText.save': {
        if (!validMyText(request.input)) throw new ApiError('invalid', '글 앞·끝 문구를 확인해 주세요.');
        await this.api.request('/auto/me/text/save', request.input, token);
        this.state.myText = { ...defaultMyText(), ...(await this.call('/auto/me', {}, token)).myText };
        break;
      }
      case 'settings.save': await this.call('/auto/settings/save', request.input, token); this.state.settings = (await this.call('/auto/me', {}, token)).settings; break;
      case 'service.check': this.requireServiceIdle(); this.state.services[request.input.service] = request.input.service === 'ai' ? 'unknown' : request.input.service === 'band' && this.runner.checkBandLogin ? await this.runner.checkBandLogin() : request.input.service === 'naver' && this.runner.checkLogin ? await this.runner.checkLogin() : 'confirmed'; break;
      case 'service.show': this.requireServiceIdle(); await this.runner.showService?.(request.input.service); if (!this.runner.serviceLogin) this.state.visibleService = request.input.service; break;
      case 'service.hide': await this.runner.hideService?.(); this.state.visibleService = null; break;
      case 'service.clear': {
        this.requireServiceIdle();
        if (this.runner.job && !['draft_saved', 'draft_unverified', 'published', 'stopped'].includes(this.runner.job.status)) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
        if (request.input.service !== 'ai' && this.runner.serviceLogin) {
          if (request.input.service === 'band') await this.runner.clearBandCache?.('BAND_SERVICE_RESET');
          await this.runner.serviceLogin.clear(request.input.service);
          this.runner.dispose(); this.runner = this.createRunner(); this.bindServiceLogin();
        }
        this.state.services[request.input.service] = 'expired'; this.state.visibleService = null; break;
      }
      case 'simulation.configure': {
        const c = request.input;
        if ((c.tickMs !== undefined && (!Number.isFinite(c.tickMs) || c.tickMs < 10 || c.tickMs > 10000)) || [c.loginAt, c.failAt].some(n => n !== undefined && n !== null && (!Number.isInteger(n) || n < 1 || n > 7))) throw new ApiError('invalid', '가짜 실행 설정을 확인해 주세요.');
        Object.assign(this.state.simulation, c); break;
      }
      case 'job.retryFailed': {
        const job = this.state.job;
        if (!job || !this.lastInput || job.mode !== 'publish' || !['failed', 'published'].includes(job.status)) throw new ApiError('conflict', '다시 시도할 곳이 없습니다.');
        const targets = this.lastInput.targets.filter(target => job.targetResults?.some(result => result.channel === target.channel && result.key === target.key && result.outcome === 'failed') || this.lastInput!.targets.length === 1 && canRetryJob(job));
        if (!targets.length) throw new ApiError('conflict', '다시 시도할 곳이 없습니다.');
        await this.start({ ...this.lastInput, targets }, token, true);
        return this.snapshot();
      }
      case 'job.start': await this.start(request.input, token); return this.snapshot();
      case 'job.preview': return structuredClone(this.jobPreview);
      case 'job.cancel':
        if (!this.runner.cancel) throw new ApiError('invalid', '이 작업은 아직 중단을 지원하지 않습니다.');
        await this.runner.cancel(); return this.snapshot();
      case 'post.open': {
        const url = new URL(request.input.url);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'blog.naver.com' || url.hostname === 'm.blog.naver.com' || url.hostname === 'band.us' && /^[/]band[/][0-9]+[/]post[/][0-9]+[/]?$/.test(url.pathname))) throw new ApiError('invalid', '글 주소를 확인해 주세요.');
        await this.runtime?.openExternal?.(url.href); return this.snapshot();
      }
      case 'job.stop': await this.runner.stop(); return this.snapshot();
      case 'job.recovery':
        if (!this.runner.recover || typeof request.input.discard !== 'boolean') throw new ApiError('invalid', '자동복구 선택을 확인해 주세요.');
        await this.runner.recover(request.input.discard); return this.snapshot();
      case 'job.dialog':
        if (!this.runner.answerDialog || typeof request.input.id !== 'string' || typeof request.input.accept !== 'boolean') throw new ApiError('invalid', '확인창 선택을 확인해 주세요.');
        await this.runner.answerDialog(request.input.id, request.input.accept); return this.snapshot();
      case 'draft.show': throw new ApiError('invalid', '네이버 블로그 앱의 임시저장함에서 확인해 주세요.');
      case 'bands.list': {
        if (this.runner.serviceLogin?.active) throw new ApiError('conflict', '로그인 확인을 먼저 마쳐 주세요.');
        if (this.starting || this.state.job && (this.state.job.status === 'record_failed' || !['draft_saved', 'draft_unverified', 'published', 'stopped'].includes(this.state.job.status) && !this.state.job.completedSteps.includes(7))) throw new ApiError('conflict', '진행 중인 작업을 먼저 마쳐 주세요.');
        if (request.input.refresh !== undefined && typeof request.input.refresh !== 'boolean') throw new ApiError('invalid', '새로고침 선택을 확인해 주세요.');
        const result = this.runner.listBands ? await this.runner.listBands(request.input) : [{ key: 'travel', name: '골투 여행', photoLimit: null, observedAt: null }, { key: 'golf', name: '해외골프 모임', photoLimit: null, observedAt: null }];
        if (Array.isArray(result) || !result.failure && !result.refreshing && (result.source === 'band' || result.savedAt !== null)) await this.keepAvailableBands(Array.isArray(result) ? result : result.rows);
        return result;
      }
      case 'band.show': throw new ApiError('invalid', '작업 화면은 앱 안에서만 확인합니다.');
      case 'band.check': await this.runner.checkBand?.(); return this.snapshot();
      case 'band.discard':
        if (!this.runner.discardBand) throw new ApiError('invalid', '버릴 밴드 작성기가 없습니다.');
        await this.runner.discardBand(); return this.snapshot();
      case 'job.continueBand':
        if (!this.runner.continueBand) throw new ApiError('invalid', '진행할 밴드 단계가 없습니다.');
        this.postTraces?.retry();
        await this.runner.continueBand(); return this.snapshot();
      case 'job.resume':
        if (this.runner.serviceLogin?.active) throw new ApiError('conflict', '로그인 확인을 먼저 마쳐 주세요.');
        if (this.runner.job?.status === 'login_paused' && this.runner.job.service && this.state.services[this.runner.job.service] !== 'confirmed') throw new ApiError('auth', '로그인 상태를 먼저 확인해 주세요.');
        this.postTraces?.retry();
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
    // Failed readback is terminal too. Its preserved receipt must remain deletable;
    // requireDeletablePost still checks the owned record before any site input.
    if (this.deleting || this.starting || this.preparing || this.pendingDeleteUpdate || this.state.job && !['draft_saved', 'draft_unverified', 'published', 'stopped', 'failed'].includes(this.state.job.status)) throw new ApiError('conflict', '진행 중인 작업과 기록을 먼저 마쳐 주세요.');
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
      if (update.failReason.startsWith('BAND_POST_')) this.runtime?.bandDeleteLog?.({ code: 'RECORD_SAVED' });
    } catch (error) {
      if (update.failReason.startsWith('BAND_POST_')) this.runtime?.bandDeleteLog?.({ code: 'RECORD_FAILED' });
      throw new RecordError(error, [token]);
    }
  }
  private aggregateJob(job: Job): Job {
    if (!this.earlierResults || !this.lastInput) return job;
    const targetResults = this.earlierResults.map(earlier =>
      job.targetResults?.find(result => result.channel === earlier.channel && result.key === earlier.key) ??
      (job.targets.some(target => target.channel === earlier.channel && target.key === earlier.key)
        ? { channel: earlier.channel, key: earlier.key, name: earlier.name, status: 'running' as const } : earlier));
    const status = job.status === 'published' && targetResults.some(target => target.outcome === 'unconfirmed' || target.outcome === 'failed') ? 'failed' : job.status;
    return { ...job, status, targets: this.lastInput.targets, targetResults };
  }
  private async keepAvailableBands(bands: readonly { key: string }[]) {
    const prefs = await this.preferences.read();
    const lastBandKeys = prefs.lastBandKeys.filter(key => bands.some(band => band.key === key));
    if (lastBandKeys.length !== prefs.lastBandKeys.length) await this.preferences.write({ ...prefs, lastBandKeys });
  }
  private async bandDailyUsage(token: string) {
    const limit = this.state.settings?.bandDailyLimit;
    if (!limit) return null;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    let used = 0;
    for (let page = 1; ; page++) {
      const data = await this.call('/auto/posts/list', { scope: 'mine', page, pageSize: 50 }, token);
      if (!Array.isArray(data?.items)) break;
      for (const post of data.items) {
        const date = /(?:Z|[+-]\d\d:\d\d)$/.test(post.startedAt)
          ? new Date(post.startedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : post.startedAt.slice(0, 10);
        if (post.channel === 'band' && date === today && (['running', 'published', 'stopped_before_post'].includes(post.status) || !!post.postUrl || post.failReason.startsWith('BAND_POST_UNCONFIRMED'))) used++;
      }
      if (data.items.length < 50 || page * 50 >= data.total) break;
    }
    return { limit, used };
  }
  private async checkBandLimit(selected: number, token: string) {
    if (!selected) return;
    const usage = await this.bandDailyUsage(token);
    if (usage && selected + usage.used > usage.limit) throw new ApiError('conflict', `밴드 하루 한도 ${usage.limit}건 중 오늘 ${usage.used}건을 썼습니다. ${selected}곳을 고르면 한도를 넘습니다.`);
  }
  private async start(input: JobInput, token: string, retry = false) {
    input = { ...input, targets: [...input.targets].sort((a,b) => Number(a.channel === 'band') - Number(b.channel === 'band')),
      options: { ...input.options, closing: input.options.closing ?? this.state.myText?.closingOn ?? true } };
    if (input.mode === 'draft' && input.targets.some(t => t.channel === 'band')) throw new ApiError('invalid', '임시저장은 네이버 블로그만 선택할 수 있습니다.');
    if (this.state.visibleService || this.runner.serviceLogin?.active) throw new ApiError('conflict', '로그인 확인을 먼저 마쳐 주세요.');
    if (this.pendingDeleteUpdate) throw new ApiError('conflict', '삭제 결과 기록을 먼저 마쳐 주세요.');
    if (this.uncertainStart) throw new ApiError('conflict', '이전 기록 시작 요청의 결과를 확인하지 못했습니다. 등록 기록을 확인해 주세요.');
    if (this.preparing || this.starting || this.state.job?.status === 'running' || (this.runner.job && (this.runner.job.status === 'record_failed' || !['draft_saved', 'draft_unverified', 'published', 'stopped'].includes(this.runner.job.status) && !this.runner.job.completedSteps.includes(7) && !retry))) throw new ApiError('conflict', '한 번에 한 작업만 등록할 수 있습니다.');
    if (!input.targets.length || input.targets.filter(t => t.channel === 'blog').length > 1 || new Set(input.targets.map(t => `${t.channel}:${t.key}`)).size !== input.targets.length) throw new ApiError('invalid', '올릴 곳을 선택해 주세요.');
    if (input.mode === 'publish' && input.publishConfirmed !== true) throw new ApiError('invalid', '발행 전에 한 번 더 확인해 주세요.');
    if (!['draft', 'publish'].includes(input.mode) || input.blogVisibility !== undefined && !['public', 'private'].includes(input.blogVisibility)) throw new ApiError('invalid', '등록 방식과 공개 범위를 확인해 주세요.');
    this.starting = true; this.records = [];
    this.postTraces?.retry();
    const previousResults = this.earlierResults;
    try {
      const bandKeys = input.targets.filter(target => target.channel === 'band').map(target => target.key);
      await this.checkBandLimit(bandKeys.length, token);
      const product = this.forRegistration(await this.call('/auto/products/get', { productNo: input.productNo }, token));
      let preview: PreparedPreview;
      if (input.options.polish) {
        const cached = this.preview;
        if (!cached || cached.product.productNo !== product.productNo || cached.result.contentHash !== product.contentHash || (cached.options.polishStrength ?? 'spelling') !== (input.options.polishStrength ?? 'spelling') || (['polish', 'linkCard'] as const).some(key => cached.options[key] !== input.options[key]) || cached.result.options.closing !== input.options.closing) throw new ApiError('invalid', '상품 또는 옵션이 바뀌었습니다. 내용을 다시 확인해 주세요.');
        preview = makePreview(product, this.convertOptions(input.options), undefined, cached.result.polish, cached.reverted);
      } else preview = makePreview(product, this.convertOptions(input.options));
      if (input.previewHash && input.previewHash !== product.contentHash) throw new ApiError('invalid', '상품이 바뀌었습니다. 내용을 다시 확인해 주세요.');
      const mismatch = input.targets.map(t => preview.verification[t.channel]).find(v => !v.matches);
      if (mismatch) throw new ApiError('invalid', mismatch.message);
      this.jobPreview = preview;
      const startFailures: TargetResult[] = [];
      for (const target of input.targets) {
        let postNo: number;
        try {
          this.uncertainStart = true;
          ({ postNo } = await this.call('/auto/posts/start', { productNo: input.productNo, channel: target.channel, mode: input.mode, target: { name: target.name, key: target.key }, options: { ...input.options, closing: input.options.closing! }, contentHash: product.contentHash }, token));
          if (!Number.isSafeInteger(postNo) || postNo < 1) throw new ApiError('server', '등록 기록 번호를 확인하지 못했습니다.');
          this.uncertainStart = false;
        }
        catch (error) {
          const log = beginTrace('record', target.channel === 'band' ? 'band' : 'naver');
          log?.line('runner.record', 'fail', { reason: 'POST_RECORD_START_FAILED' });
          log?.end('failed', 'POST_RECORD_START_FAILED');
          if (input.targets.length > 1 && target.channel === 'band' && this.state.user) {
            this.uncertainStart = false;
            const reason = 'POST_RECORD_START_FAILED';
            startFailures.push({ ...target, status: 'failed', outcome: 'failed', reason });
            continue;
          }
          if (error instanceof ApiError && error.code !== 'server') this.uncertainStart = false;
          if (target.channel === 'band' && error instanceof ApiError && error.code === 'conflict') throw new ApiError('conflict', `${target.name}: ${error.message}`);
          throw error;
        }
        const record = { postNo, channel: target.channel, key: target.key, status: 'running' as const, updates: new Map() };
        this.records.push(record);
        this.startRecordLog(record, input.mode);
        if (target.channel === 'blog') await this.postMetadata.set(postNo, input.blogVisibility ?? 'public');
      }
      this.recordPrivateText = [product.title, ...product.golfCourses, ...preview.blog.steps.flatMap(step => step.kind === 'text' ? [step.text] : step.kind === 'table' ? step.rows.flat() : [])];
      this.earlierResults = retry ? this.state.job?.targetResults : undefined;
      const records = this.records;
      await this.runner.start(input, product.title, product.images.length, this.preparation ? preparationWork(product, preview, this.preparation) : undefined, {
        retry, startFailures, traceForTarget: target => {
          const record = records.find(value => value.channel === target.channel && value.key === target.key);
          if (!record) return;
          if (!record.log || !this.runtime?.logs?.runningKind(record.log.id)) this.startRecordLog(record, input.mode);
          record.claimed = true;
          return record.log;
        },
      });
      if (!retry) this.lastInput = structuredClone(input);
      if (!retry && input.mode === 'publish' && bandKeys.length) {
        await this.preferences.read().then(selected => this.preferences.write({ ...selected, lastBandKeys: bandKeys })).catch(() => {});
      }
    } catch (error) {
      this.earlierResults = previousResults;
      for (const record of this.records) {
        record.log?.line('runner.record', 'fail', { reason: 'POST_RECORD_START_FAILED' });
        await this.api.request('/auto/posts/update', { postNo: record.postNo, status: 'stopped', step: 1, failReason: 'POST_RECORD_START_FAILED', postUrl: '' }, token).catch(() => {});
        record.log?.end('failed', 'POST_RECORD_START_FAILED');
      }
      throw error;
    } finally { this.starting = false; }
  }
  private forRegistration(product: Product): Product { return this.runtime?.experimentTitle ? { ...product, title: `[골투오토 실험] ${this.runtime.experimentTitleLabel ?? ''}${product.title}` } : product; }
  private convertOptions(options: JobOptions) {
    const myText = this.state.myText ?? defaultMyText(), user = this.state.user ?? { name: '' };
    return { closing: options.closing ?? myText.closingOn, closingText: fillMyText(myText.closing, user), prefixText: fillMyText(myText.prefix, user),
      linkCard: options.linkCard, tagWords: this.state.settings?.defaultHashtags ?? [], polishStrength: options.polishStrength ?? 'spelling' };
  }
  private startRecordLog(record: AppCore['records'][number], mode: JobInput['mode']) {
    const band = record.channel === 'band';
    const log = beginTrace(band ? 'band_post' : mode === 'draft' ? 'blog_draft' : 'blog_publish', band ? 'band' : 'naver');
    if (!log) return;
    record.log = log;
    if (this.state.user) this.postTraces?.track(log, record.postNo, record.channel, this.state.user.userNo, record.key);
  }
  private async record(job: Job, retry = false) {
    trace('runner.record', retry ? 'retry' : 'start', { counts: { step: job.step } });
    const token = await this.token();
    const log = currentTrace();
    const active = job.step < 6 ? this.records.find(record => record.channel === 'blog') ?? this.records[0]
      : job.step === 6 ? this.records.find(record => record.channel === 'band' && record.key === job.activeTargetKey) : undefined;
    for (const record of this.records) {
      if (this.runner instanceof FakeRegistrationRunner && record.log && !this.runtime?.logs?.runningKind(record.log.id) && job.status === 'running')
        this.startRecordLog(record, job.mode);
      if (record.deferred && !retry) {
        if (job.completedSteps.includes(7)) throw record.deferred.error;
        continue;
      }
      if (['draft_saved', 'published'].includes(record.status) && !(record.channel === 'blog' && job.testPostDeleted && record.status === 'published')) continue;
      const saved = job.completedSteps.includes(record.channel === 'blog' ? 5 : 6);
      const result = job.targetResults?.find(t => t.channel === record.channel && t.key === record.key);
      if (record.status === 'failed' && result?.status === 'failed') continue;
      const status: PostStatus = (result?.status === 'running' && job.status === 'user_paused' ? 'stopped' : result?.status) ?? (saved ? (record.channel === 'band' && job.mode === 'draft' ? 'stopped_before_post' : job.mode === 'draft' ? 'draft_saved' : 'published') : job.status === 'failed' ? 'failed' : job.status === 'user_paused' ? 'stopped' : 'running');
      const update = record.deferred?.update ?? { postNo: record.postNo, status, step: job.step, failReason: ['failed', 'stopped'].includes(status) || result?.readbackNotes?.length ? (result?.reason ?? job.message) : '', postUrl: result?.postUrl ? result.postUrl : status === 'published' ? (result?.postUrl ?? job.postUrl ?? (this.runner instanceof FakeRegistrationRunner ? `https://example.invalid/posts/${record.postNo}` : '')) : '' };
      const identity = JSON.stringify(update);
      if (record.updates.has(identity)) {
        const failure = record.updates.get(identity);
        if (!failure) continue;
        if (!retry) throw failure; // Only the explicit record action may resend an uncertain update.
      }
      try {
        if (record.channel === 'blog' && job.tableModes?.includes('text-list')) await this.postMetadata.setTableFallback(record.postNo);
        await this.call('/auto/posts/update', update, token);
      }
      catch (error) {
        const failure = new RecordError(error, [token, job.title, ...this.recordPrivateText]);
        record.updates.set(identity, failure);
        (record === active ? log ?? record.log : record.log)?.line('runner.record', 'fail', { reason: 'RECORD_FAILED', counts: { step: job.step } });
        if (!record.claimed) record.log?.end('failed', 'RECORD_FAILED');
        if (record.channel === 'band' && job.targets.length > 1 && result?.outcome && job.step < 7 && this.state.user) {
          record.deferred = { update, error: failure };
          continue;
        }
        throw failure;
      }
      record.updates.set(identity, null);
      record.status = update.status;
      delete record.deferred;
      if (!record.claimed && status === 'running' && job.status === 'login_paused') record.log?.end('stopped', 'LOGIN_REQUIRED');
      if (!record.claimed && ['failed', 'draft_saved', 'published', 'stopped', 'stopped_before_post'].includes(status)) {
        const reason = reasonCode(result?.reason ?? job.failureCode ?? (job.status === 'user_paused' ? 'USER_STOPPED' : 'NOT_STARTED'));
        record.log?.line('runner.record', status === 'failed' ? 'fail' : 'ok', { reason, counts: { step: job.step } });
        if (result?.outcome === 'unconfirmed') record.log?.end('uncertain', reason);
        else if (status === 'published' || status === 'draft_saved') record.log?.end('succeeded');
        else record.log?.end(status === 'failed' ? 'failed' : 'stopped', reason);
      }
    }
  }
}
