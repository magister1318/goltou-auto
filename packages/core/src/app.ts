import { ApiError, createFakeApi, type ApiClient, type Channel, type PostStatus } from '@goltou/api-client';
import { FakeRegistrationRunner, type RegistrationRunner } from './runner';
import type { AppRequest, AppSnapshot, Job, JobInput, TokenStore } from './protocol';
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
  private records: { postNo: number; channel: Channel; status: PostStatus }[] = [];
  constructor(private readonly api: ApiClient = createFakeApi(), private readonly tokens: TokenStore = new MemoryTokenStore(), factory?: (checkpoint: (job: Job) => Promise<void>, notify: (job: Job) => void) => RegistrationRunner) {
    const notify = (job: Job) => { this.state.job = job; if (job.status === 'login_paused' && job.service) { this.state.services[job.service] = 'expired'; this.state.visibleService = job.service; } this.emit(); };
    this.runner = factory ? factory(job => this.record(job), notify) : new FakeRegistrationRunner(() => this.state.simulation, job => this.record(job), notify);
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
        if (this.starting || (this.runner.job && !['draft_saved', 'published'].includes(this.runner.job.status))) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
        await this.api.request('/auto/logout', {}, token); await this.tokens.write(null); this.state.user = null; this.state.settings = null; this.state.job = null; break;
      case 'products.list': return this.api.request('/auto/products/list', request.input, token);
      case 'products.get': return this.api.request('/auto/products/get', request.input, token);
      case 'posts.list': return this.api.request('/auto/posts/list', request.input, token);
      case 'settings.save': await this.api.request('/auto/settings/save', request.input, token); this.state.settings = (await this.api.request('/auto/me', {}, token)).settings; break;
      case 'service.check': this.state.services[request.input.service] = 'confirmed'; break;
      case 'service.show': this.state.visibleService = request.input.service; break;
      case 'service.hide': this.state.visibleService = null; break;
      case 'service.clear': this.state.services[request.input.service] = 'unknown'; if (this.state.visibleService === request.input.service) this.state.visibleService = null; break;
      case 'simulation.configure': {
        const c = request.input;
        if ((c.tickMs !== undefined && (!Number.isFinite(c.tickMs) || c.tickMs < 10 || c.tickMs > 10000)) || [c.loginAt, c.failAt].some(n => n !== undefined && n !== null && (!Number.isInteger(n) || n < 1 || n > 7))) throw new ApiError('invalid', '가짜 실행 설정을 확인해 주세요.');
        Object.assign(this.state.simulation, c); break;
      }
      case 'job.start': await this.start(request.input, token); return this.snapshot();
      case 'job.stop': await this.runner.stop(); return this.snapshot();
      case 'job.resume':
        if (this.runner.job?.status === 'login_paused' && this.runner.job.service && this.state.services[this.runner.job.service] !== 'confirmed') throw new ApiError('auth', '로그인 상태를 먼저 확인해 주세요.');
        this.state.visibleService = null; await this.runner.resume(); return this.snapshot();
      default: throw new ApiError('invalid', '지원하지 않는 요청입니다.');
    }
    this.emit(); return this.snapshot();
  }
  private async start(input: JobInput, token: string) {
    if (this.starting || (this.runner.job && !['draft_saved', 'published'].includes(this.runner.job.status))) throw new ApiError('conflict', '한 번에 한 작업만 등록할 수 있습니다.');
    if (!input.targets.length || input.targets.length > 3 || new Set(input.targets.map(t => `${t.channel}:${t.key}`)).size !== input.targets.length) throw new ApiError('invalid', '올릴 곳을 선택해 주세요.');
    if (input.mode === 'publish' && input.publishConfirmed !== true) throw new ApiError('invalid', '발행 전에 한 번 더 확인해 주세요.');
    this.starting = true; this.records = [];
    try {
      const product = await this.api.request('/auto/products/get', { productNo: input.productNo }, token);
      for (const target of input.targets) {
        const { postNo } = await this.api.request('/auto/posts/start', { productNo: input.productNo, channel: target.channel, mode: input.mode, target: { name: target.name, key: target.key }, options: input.options, contentHash: product.contentHash }, token);
        this.records.push({ postNo, channel: target.channel, status: 'running' });
      }
      await this.runner.start(input, product.title, product.images.length);
    } catch (error) {
      for (const record of this.records) await this.api.request('/auto/posts/update', { postNo: record.postNo, status: 'stopped', step: 1, failReason: '작업 시작 실패', postUrl: '' }, token);
      throw error;
    } finally { this.starting = false; }
  }
  private async record(job: Job) {
    const token = await this.token();
    for (const record of this.records) {
      if (['draft_saved', 'published'].includes(record.status)) continue;
      const saved = job.completedSteps.includes(record.channel === 'blog' ? 5 : 6);
      const status: PostStatus = saved ? (job.mode === 'draft' ? 'draft_saved' : 'published') : job.status === 'failed' ? 'failed' : job.status === 'user_paused' ? 'stopped' : 'running';
      await this.api.request('/auto/posts/update', { postNo: record.postNo, status, step: job.step, failReason: job.message, postUrl: status === 'published' ? `https://example.invalid/posts/${record.postNo}` : '' }, token);
      record.status = status;
    }
  }
}
