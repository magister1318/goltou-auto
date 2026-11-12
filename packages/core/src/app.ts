import { ApiError, createFakeApi, type ApiClient, type Channel, type PostStatus, type Product, type PostInput } from '@goltou/api-client';
import { FakeRegistrationRunner, type RegistrationRunner } from './runner';
import type { AppRequest, AppSnapshot, Job, JobInput, TokenStore } from './protocol';
import { makePreview, preparePreview, preparationWork, type PreparationServices, type PreparedPreview } from './preparation';
export class MemoryTokenStore implements TokenStore {
  private token: string | null = null;
  async read() { return this.token; }
  async write(token: string | null) { this.token = token; }
}
export class AppCore {
  readonly state: AppSnapshot = { user: null, settings: null, services: { naver: 'confirmed', band: 'expired', ai: 'unknown' }, visibleService: null, job: null, simulation: { tickMs: 140, loginAt: null, failAt: null } };
  private readonly listeners = new Set<(state: AppSnapshot) => void>();
  private readonly runner: RegistrationRunner;
  private starting = false;
  private preparing = false;
  private preview: { product: Product; options: PostInput['options']; result: PreparedPreview; reverted: string[] } | undefined;
  private records: { postNo: number; channel: Channel; key: string; status: PostStatus }[] = [];
  constructor(private readonly api: ApiClient = createFakeApi(), private readonly tokens: TokenStore = new MemoryTokenStore(), factory?: (checkpoint: (job: Job) => Promise<void>, notify: (job: Job) => void) => RegistrationRunner, private readonly preparation?: PreparationServices) {
    const notify = (job: Job) => { this.state.job = job; if (job.status === 'login_paused' && job.service) { this.state.services[job.service] = 'expired'; this.state.visibleService = job.service; } this.emit(); };
    this.runner = factory ? factory(job => this.record(job), notify) : new FakeRegistrationRunner(() => this.state.simulation, job => this.record(job), notify);
    if (this.runner.checkLogin) { this.state.realBlog = true; this.state.services.naver = 'unknown'; }
    if (this.runner.listBands) { this.state.realBand = true; this.state.services.band = 'unknown'; }
  }
  subscribe(listener: (state: AppSnapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): AppSnapshot { return structuredClone(this.state); }
  private emit() { for (const listener of this.listeners) listener(this.snapshot()); }
  dispose() { this.runner.dispose(); this.listeners.clear(); }
  private async token(): Promise<string> { const token = await this.tokens.read(); if (!token) throw new ApiError('auth', '다시 로그인해 주세요.'); return token; }
  async handle(request: AppRequest): Promise<unknown> {
    if (request.command === 'session.get') return this.snapshot();
    if (request.command === 'login') {
      if (this.state.user) throw new ApiError('conflict', '먼저 로그아웃해 주세요.');
      const result = await this.api.request('/auto/login', request.input);
      await this.tokens.write(result.token); this.state.user = result.user;
      this.state.settings = (await this.api.request('/auto/me', {}, result.token)).settings;
      this.emit(); return this.snapshot();
    }
    const token = await this.token();
    switch (request.command) {
      case 'logout':
        if (this.starting || (this.runner.job && !['draft_saved', 'published', 'stopped'].includes(this.runner.job.status) && !this.runner.job.completedSteps.includes(7))) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
        await this.api.request('/auto/logout', {}, token); await this.tokens.write(null); this.state.user = null; this.state.settings = null; this.state.job = null; break;
      case 'products.list': return this.api.request('/auto/products/list', request.input, token);
      case 'products.get': return this.api.request('/auto/products/get', request.input, token);
      case 'preview.prepare': {
        if (this.preparing || this.starting || this.state.job?.status === 'running') throw new ApiError('conflict', '진행 중인 작업을 먼저 마쳐 주세요.');
        this.preparing = true;
        try {
          const product = await this.api.request('/auto/products/get', { productNo: request.input.productNo }, token);
          const options = request.input.options;
          const previous = this.preview;
          const reusable = options.polish && previous?.options.polish && previous.product.productNo === product.productNo && previous.product.contentHash === product.contentHash && previous.result.polish;
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
      case 'posts.list': return this.api.request('/auto/posts/list', request.input, token);
      case 'settings.save': await this.api.request('/auto/settings/save', request.input, token); this.state.settings = (await this.api.request('/auto/me', {}, token)).settings; break;
      case 'service.check': this.state.services[request.input.service] = request.input.service === 'band' && this.runner.checkBandLogin ? await this.runner.checkBandLogin() : request.input.service === 'naver' && this.runner.checkLogin ? await this.runner.checkLogin() : 'confirmed'; break;
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
        if (this.starting || this.state.job && !['draft_saved', 'published', 'stopped'].includes(this.state.job.status) && !this.state.job.completedSteps.includes(7)) throw new ApiError('conflict', '진행 중인 작업을 먼저 마쳐 주세요.');
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
      default: throw new ApiError('invalid', '지원하지 않는 요청입니다.');
    }
    this.emit(); return this.snapshot();
  }
  private async start(input: JobInput, token: string) {
    if (this.preparing || this.starting || (this.runner.job && !['draft_saved', 'published', 'stopped'].includes(this.runner.job.status) && !this.runner.job.completedSteps.includes(7))) throw new ApiError('conflict', '한 번에 한 작업만 등록할 수 있습니다.');
    if (!input.targets.length || new Set(input.targets.map(t => `${t.channel}:${t.key}`)).size !== input.targets.length) throw new ApiError('invalid', '올릴 곳을 선택해 주세요.');
    if (input.mode === 'publish' && input.publishConfirmed !== true) throw new ApiError('invalid', '발행 전에 한 번 더 확인해 주세요.');
    this.starting = true; this.records = [];
    try {
      const product = await this.api.request('/auto/products/get', { productNo: input.productNo }, token);
      let preview: PreparedPreview;
      if (input.options.polish) {
        const cached = this.preview;
        if (!cached || cached.product.productNo !== product.productNo || cached.result.contentHash !== product.contentHash || (['polish', 'closing', 'linkCard'] as const).some(key => cached.options[key] !== input.options[key])) throw new ApiError('invalid', '상품 또는 옵션이 바뀌었습니다. 내용을 다시 확인해 주세요.');
        preview = cached.result;
      } else preview = makePreview(product, this.convertOptions(input.options));
      if (input.previewHash && input.previewHash !== product.contentHash) throw new ApiError('invalid', '상품이 바뀌었습니다. 내용을 다시 확인해 주세요.');
      const mismatch = input.targets.map(t => preview.verification[t.channel]).find(v => !v.matches);
      if (mismatch) throw new ApiError('invalid', mismatch.message);
      for (const target of input.targets) {
        let postNo: number;
        try { ({ postNo } = await this.api.request('/auto/posts/start', { productNo: input.productNo, channel: target.channel, mode: input.mode, target: { name: target.name, key: target.key }, options: input.options, contentHash: product.contentHash }, token)); }
        catch (error) { if (target.channel === 'band' && error instanceof ApiError && error.code === 'conflict') throw new ApiError('conflict', `${target.name}: ${error.message}`); throw error; }
        this.records.push({ postNo, channel: target.channel, key: target.key, status: 'running' });
      }
      await this.runner.start(input, product.title, product.images.length, this.preparation ? preparationWork(product, preview, this.preparation) : undefined);
    } catch (error) {
      for (const record of this.records) await this.api.request('/auto/posts/update', { postNo: record.postNo, status: 'stopped', step: 1, failReason: '작업 시작 실패', postUrl: '' }, token);
      throw error;
    } finally { this.starting = false; }
  }
  private convertOptions(options: PostInput['options']) {
    return { closing: options.closing, closingText: this.state.settings?.closingText ?? '', linkCard: options.linkCard, hashtags: this.state.settings?.defaultHashtags ?? [] };
  }
  private async record(job: Job) {
    const token = await this.token();
    for (const record of this.records) {
      if (['draft_saved', 'published'].includes(record.status)) continue;
      const saved = job.completedSteps.includes(record.channel === 'blog' ? 5 : 6);
      const result = job.targetResults?.find(t => t.channel === record.channel && t.key === record.key);
      const status: PostStatus = (result?.status === 'running' && job.status === 'user_paused' ? 'stopped' : result?.status) ?? (saved ? (record.channel === 'band' && job.mode === 'draft' ? 'stopped_before_post' : job.mode === 'draft' ? 'draft_saved' : 'published') : job.status === 'failed' ? 'failed' : job.status === 'user_paused' ? 'stopped' : 'running');
      await this.api.request('/auto/posts/update', { postNo: record.postNo, status, step: job.step, failReason: ['failed', 'stopped'].includes(status) ? (result?.reason ?? job.message) : '', postUrl: status === 'published' ? (result?.postUrl ?? job.postUrl ?? (job.targetResults ? '' : `https://example.invalid/posts/${record.postNo}`)) : '' }, token);
      record.status = status;
    }
  }
}
