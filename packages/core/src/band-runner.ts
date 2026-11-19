import { setTimeout as pause } from 'node:timers/promises';
import { existingServiceResult } from './job-safety';
import { retainBlogOutcome, blogOutcomeFailure, retainPublishedReadback } from './blog-outcome';
import { registrationLog, registrationAttempt } from './registration-log';
import { inTrace, trace, reasonCode, traceJob, type TraceJob } from '@goltou/surface/telemetry';
import { ApiError } from '@goltou/api-client';
import { safeFailureCode, ReadbackMismatch, bandPostBlocked, BandDirectory, type BandExecution, type BlogExecution, type BandProgress } from '@goltou/sites';
import { ServiceLoginController } from './service-login';
import type { Job, JobInput, Service, TargetResult } from './protocol';
import type { Checkpoint, RegistrationRunner, RegistrationStart } from './runner';
import type { PreparationWork } from './preparation';
import { createBandExecution, type BandServices } from './band';
import { createBlogExecution, type BlogServices } from './blog';
import { updateInputProgress } from './input-progress';
import { RecordError, RecordingCheckpoint } from './record-checkpoint';
import { markDraftUnverified } from './draft-unverified';
import { markBlogFormattingFailure } from './blog-formatting-failure';
import { BandListCache, type BandListResult, type BandCacheClearReason } from './band-list-cache';

/** One product, blog first, then exactly one Band composer at a time. */
export class ChannelRegistrationRunner implements RegistrationRunner {
  job: Job | null = null;
  readonly directory: BandDirectory;
  readonly serviceLogin: ServiceLoginController;
  private work: PreparationWork | undefined;
  private blog: BlogExecution | undefined;
  private band: BandExecution | undefined;
  private abort = new AbortController();
  private active: Promise<void> | undefined;
  private disposed = false;
  private serial = 0;
  private log: TraceJob | undefined;
  private saves = 0;
  private bandIndex = 0;
  private discardPending = false;
  private blogSkipped = false;
  private readonly recording: RecordingCheckpoint;
  private readonly bandCache: BandListCache | undefined;
  private readonly bandListeners = new Set<(value: BandListResult) => void>();
  constructor(private readonly services: { band: BandServices; blog?: BlogServices; bandPause?: (milliseconds: number, signal: AbortSignal) => Promise<void> }, checkpoint: Checkpoint, private readonly notify: (job: Job) => void) {
    this.recording = new RecordingCheckpoint(checkpoint, notify);
    this.directory = new BandDirectory(services.band.host, services.band.baseUrl, services.band.localPublish, services.band.publishEnabled, services.band.publishAllowance, services.band.recordBarrierDecision);
    this.serviceLogin = new ServiceLoginController(services.band.host);
    if (services.band.listStore) this.bandCache = new BandListCache(this.directory, services.band.listStore, value => {
      for (const listener of this.bandListeners) listener(value);
    });
    this.serviceLogin.subscribe(update => {
      if (update.service === 'band' && update.state === 'expired') void this.clearBandCache('BAND_LOGOUT').catch(() => {});
    });
  }
  subscribeBands(listener: (value: BandListResult) => void) { this.bandListeners.add(listener); return () => { this.bandListeners.delete(listener); }; }
  async clearBandCache(reason: BandCacheClearReason) { await this.bandCache?.clear(reason); }
  async listBands(input: { refresh?: boolean } = {}) {
    if (this.bandCache) {
      if (this.active || this.band && !['stopped', 'published'].includes(this.result()?.status ?? '')) throw new ApiError('conflict', '작성 중인 밴드부터 확인하거나 버려 주세요.');
      return this.bandCache.list(input);
    }
    return traceJob('band_list', 'band', async () => {
    if (this.active || this.band && !['stopped', 'published'].includes(this.result()?.status ?? '')) throw new ApiError('conflict', '작성 중인 밴드부터 확인하거나 버려 주세요.');
    const rows = await this.directory.list();
    trace('band.list.cache', 'ok', { bandList: { cacheSource: 'band', cacheAgeMinutes: 0, stale: false, refreshRequested: input.refresh === true, rowCount: rows.length, cacheCleared: false } });
    return rows;
    }, () => ({ result: 'succeeded', ...(this.directory.listReason ? { reason: this.directory.listReason } : {}) }));
  }
  async start(input: JobInput, title: string, photos: number, work?: PreparationWork, context?: RegistrationStart) {
    if (input.targets.some(target => target.channel === 'blog') && input.targets[0]?.channel !== 'blog') {
      input = { ...input, targets: [...input.targets.filter(target => target.channel === 'blog'), ...input.targets.filter(target => target.channel === 'band')] };
    }
    this.log = registrationLog(input);
    return inTrace(this.log, async () => {
    try {
    if (this.serviceLogin.active) throw new ApiError('conflict', '로그인 확인을 먼저 마쳐 주세요.');
    await this.bandCache?.settle();
    if (this.serviceLogin.active) throw new ApiError('conflict', '로그인 확인을 먼저 마쳐 주세요.');
    if (this.job && (this.job.status === 'record_failed' || !['draft_saved', 'draft_unverified', 'published', 'stopped'].includes(this.job.status) && !this.job.completedSteps.includes(7) && !context?.retry)) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
    if (!work?.preview || !input.targets.length) throw new ApiError('invalid', '입력 준비가 필요합니다.');
    if (input.mode === 'publish' && !input.publishConfirmed) throw new ApiError('invalid', '이 작업의 발행 확인이 필요합니다.');
    const bands = input.targets.filter(t => t.channel === 'band');
    if (this.services.blog?.publishProbe && (bands.length || input.mode !== 'publish' || input.blogVisibility !== this.services.blog.publishProbe.visibility)) throw new ApiError('invalid', '발행 차단 프로브의 블로그 공개 범위를 확인해 주세요.');
    if (bands.length && input.mode === 'publish' && !this.services.band.localPublish && !this.services.band.publishEnabled && !await this.services.band.publishAllowance?.available()) throw new ApiError('invalid', '이 시험 빌드에서는 실제 밴드 게시를 시험하지 않습니다.');
    if (input.targets.length === 1 && bands.some(t => !this.directory.choices.some(b => b.key === t.key))) throw new ApiError('invalid', '내 밴드 목록에서 다시 골라 주세요.');
    if (!this.services.band.localPublish && !this.services.band.publishEnabled && !this.services.band.publishAllowance && bands.some(t => t.key !== this.directory.choices[0]?.key)) throw new ApiError('invalid', '이번 실기기 확인은 첫 밴드만 허용합니다.');
    const blogs = input.targets.filter(t => t.channel === 'blog');
    if (blogs.length > 1 || blogs.length && !this.services.blog) throw new ApiError('invalid', '블로그 실행 설정을 확인해 주세요.');
    if (blogs.length && !this.services.blog?.localPublish && !this.services.blog?.publishEnabled && (input.mode !== 'draft' || !title.startsWith('[골투오토 실험]'))) throw new ApiError('invalid', '실제 네이버 발행 설정을 확인해 주세요.');
    await this.active;
    if (context?.retry || this.job?.completedSteps.includes(7) && this.band?.hasOwnedComposer) {
      await this.directory.releaseSurface();
      await this.work?.cleanup();
    }
    trace('runner.post_options', 'ok', { counts: { hashtags: work.preview.tags?.length ?? 0,
      observed: work.preview.band.steps.filter(step => step.kind === 'text' && (step.role === 'prefix' || step.role === 'closing')).length,
      expected: input.targets.length } });
    this.work = work; this.abort = new AbortController(); this.band = undefined; this.bandIndex = 0; this.discardPending = false; this.blogSkipped = false; this.saves = 0;
    await this.blog?.close(); this.blog = undefined;
    this.job = { creationState: 'none', startedAt: Date.now(), id: ++this.serial, productNo: input.productNo, title, mode: input.mode, blogVisibility: input.blogVisibility ?? 'public', targets: structuredClone(input.targets), targetResults: input.targets.map(t => context?.startFailures.find(f => f.channel === t.channel && f.key === t.key) ?? ({ ...t, status: 'running' })), status: 'running', step: 1, current: 0, total: photos, completedSteps: [], service: null, message: '' };
    if (this.services.blog?.publishProbe) { this.job.publishProbe = true; this.job.message = '발행 차단 프로브'; }
    try { await this.emit(); this.launch(); } catch (error) { this.log?.end('failed', reasonCode(error)); if (!(error instanceof RecordError)) throw error; }
    } catch (error) { this.log?.end('failed', reasonCode(error)); throw error; }
    });
  }
  private result() { return this.job?.targetResults?.filter(t => t.channel === 'band')[this.bandIndex]; }
  private async emit() { if (this.job) await this.recording.emit(this.job); }
  async retryRecord() {
    await this.active; if (!this.job) return;
    this.log = registrationLog(this.job); this.log?.line('runner.record', 'retry');
    await registrationAttempt(this.log, () => this.recording.retry(this.job!), () => this.job);
  }
  private check = () => { this.abort.signal.throwIfAborted(); if (this.disposed) throw new Error('RUNNER_DISPOSED'); };
  private rootOutcome() {
    const job = this.job;
    if (!job?.completedSteps.includes(7) || job.targets.length === 1) return job;
    const target = job.targetResults?.[0];
    if (!target?.outcome) return job;
    const { failureCode: _aggregateCode, ...snapshot } = job;
    return { ...snapshot, status: target.outcome === 'ok' ? target.status as 'published' | 'draft_saved' : 'failed' as const,
      publicationUncertain: target.outcome === 'unconfirmed', ...(target.reason ? { failureCode: target.reason } : {}) };
  }
  private launch() {
    this.active = registrationAttempt(this.log, () => this.run(), () => this.rootOutcome()).catch(error => { if (error instanceof RecordError) return; if (this.job) { this.job.status = 'failed'; this.job.message = '기록을 저장하지 못했습니다.'; this.notify(structuredClone(this.job)); } }).finally(() => { this.active = undefined; });
  }
  private progress = (v: BandProgress) => {
    const j = this.job!; updateInputProgress(j, v);
    this.notify(structuredClone(j));
  };
  private async run() {
    const j = this.job!;
    try {
      while (j.step <= 7) {
        const phase = (['runner.ready', 'runner.download', 'runner.arrange', 'runner.blog_write', 'runner.blog_save', 'runner.band_write', 'runner.record'] as const)[j.step - 1]!;
        const phaseStarted = Date.now();
        trace(phase, 'start', { counts: { step: j.step } });
        this.check();
        if (j.step === 1 && j.targets.some(t => t.channel === 'blog')) {
          this.blog ??= createBlogExecution(this.work!.preview!.blog, [], this.services.blog!, { mode: j.mode, visibility: j.blogVisibility ?? 'public', check: this.check, progress: this.progress, beforeSave: () => { if (++this.saves > (this.services.blog?.draftSaveLimit ?? 3)) throw new Error('DRAFT_SAVE_LIMIT'); } });
          await this.blog.ensureReady();
        }
        if (j.step === 2) await this.work!.download(this.abort.signal, n => { j.current = n; this.notify(structuredClone(j)); });
        if (j.step === 3) await this.work!.arrange();
        if (j.step === 4 && this.blog) { this.blog.files = this.work!.prepared!.files; await this.blog.write(); }
        if (j.step === 5 && this.blog) {
          await this.blog.saveAndVerify();
          if (this.blog.draftIdentity) j.blogDraftIdentity = this.blog.draftIdentity;
          const result = j.targetResults!.find(t => t.channel === 'blog')!;
          if (j.mode === 'publish') {
            try { result.postUrl = await this.blog.publish(); j.publicationUncertain = false; }
            catch (error) {
              if (j.publishProbe && error instanceof Error && error.message === 'BLOG_PUBLISH_PROBE_BLOCKED') {
                result.status = 'stopped'; result.reason = 'BLOG_PUBLISH_PROBE_BLOCKED';
              } else result.postUrl = retainPublishedReadback(result, this.blog.publishedPost?.url, error);
              j.publicationUncertain = false;
            }
          }
          j.blogReadbackTimings = [...this.blog.readbackTimings];
          j.blogIdentitySources = [...this.blog.publishedIdentitySources];
          if (!j.publishProbe) { result.status = j.mode === 'draft' ? 'draft_saved' : 'published'; result.outcome = 'ok'; }
          j.tableModes = [...this.blog.tableModes]; j.linkCard = this.blog.linkCard;
          await this.capture(false, 'draft-verified');
        }
        if (j.step === 6 && !await this.runBands()) return;
        if (j.step === 7) {
          if (j.targetResults?.some(t => t.channel === 'blog' && ['draft_saved', 'published'].includes(t.status))) await this.blog?.close();
          await this.work!.cleanup();
        }
        trace(phase, 'ok', { counts: { step: j.step } }, Date.now() - phaseStarted);
        this.check(); if (!j.completedSteps.includes(j.step)) j.completedSteps.push(j.step);
        if (j.step === 7) {
          const results = j.targetResults!;
          j.status = results.some(t => t.outcome === 'failed' || t.outcome === 'unconfirmed' || t.status === 'failed') ? 'failed' : results.every(t => t.status === 'stopped') ? 'stopped' : results.some(t => t.status === 'published') ? 'published' : 'draft_saved';
          j.message = '채널별 결과를 등록 기록에 남겼습니다.'; j.secondsLeft = 0; await this.emit(); return;
        }
        j.step++; j.current = 0; delete j.secondsLeft; await this.emit();
      }
    } catch (error) {
      trace('job', 'fail', { reason: reasonCode(error), counts: { step: j.step } });
      if (this.abort.signal.aborted || this.disposed) return;
      await this.fail(error);
      if (j.mode === 'publish' && j.step < 6 && j.targets.some(t => t.channel === 'blog') && j.targets.some(t => t.channel === 'band') && ['failed', 'draft_unverified', 'channel_paused'].includes(j.status) && ![2, 3].includes(j.step)) {
        const blog = j.targetResults?.find(result => result.channel === 'blog');
        if (blog) {
          blog.outcome ??= existingServiceResult({ ...j, targetResults: [blog] }) ? 'unconfirmed' : 'failed';
          blog.reason ??= j.failureCode ?? 'CHANNEL_FAILED';
          if (blog.status === 'running') blog.status = 'failed';
        }
        for (const target of j.targetResults ?? []) if (target.channel === 'band' && target.status === 'stopped') { target.status = 'running'; delete target.reason; delete target.outcome; }
        await this.blog?.close().catch(() => {});
        this.blog = undefined;
        await this.emit();
        this.resetTargetState();
        j.step = this.work?.prepared ? 6 : 2;
        await this.run();
      }
    }
  }
  private resetTargetState() {
    const j = this.job!;
    j.status = 'running'; j.creationState = 'none'; j.publicationUncertain = false; j.message = ''; j.service = null;
    delete j.failureCode; delete j.readbackIssues; delete j.blogFormattingIssues; delete j.dialog; delete j.activity;
  }
  private async runBands() {
    const j = this.job!;
    const bands = j.targetResults!.filter(t => t.channel === 'band');
    let needsPause = this.bandIndex > 0 && bands.slice(0, this.bandIndex).some(target => target.reason !== 'POST_RECORD_START_FAILED');
    for (; this.bandIndex < bands.length; this.bandIndex++, this.band = undefined) {
      const result = bands[this.bandIndex]!;
      if (result.outcome || ['published', 'stopped'].includes(result.status)) continue;
      const child = j.targets[0]?.channel === 'blog' || this.bandIndex > 0 ? registrationLog({ targets: [result], mode: j.mode }) : undefined;
      const proceed = await inTrace(child, async () => {
        if (j.activeTargetKey && j.activeTargetKey !== result.key) {
          delete j.activity;
          j.activityLog = j.activityLog?.filter(event => event.channel !== 'band') ?? [];
          j.current = 0;
        }
        j.activeTargetKey = result.key;
        try {
          if (j.mode === 'publish' && needsPause) j.bandPause = true;
          await this.emit();
          if (j.bandPause) {
            const milliseconds = 20000 + Math.floor(Math.random() * 20001);
            trace('runner.band_pause', 'wait', { reason: 'BAND_TARGET_PAUSE', counts: { expected: milliseconds } });
            await (this.services.bandPause ?? ((ms, signal) => pause(ms, undefined, { signal })))(milliseconds, this.abort.signal);
            this.check();
            trace('runner.band_pause', 'ok', { reason: 'BAND_TARGET_PAUSE', counts: { observed: milliseconds } });
            delete j.bandPause;
            await this.emit();
          }
          if (!this.directory.choices.some(band => band.key === result.key)) throw Error('BAND_TARGET_INVALID');
          const finished = await this.runBand(result);
          child?.end(finished ? 'succeeded' : 'stopped', finished ? undefined : 'STOPPED_BEFORE_POST');
          return finished;
        } catch (error) {
          delete j.bandPause;
          if (this.abort.signal.aborted || this.disposed || error instanceof RecordError) {
            child?.end(error instanceof RecordError ? 'failed' : 'stopped', error instanceof RecordError ? 'RECORD_FAILED' : 'USER_STOPPED');
            throw error;
          }
          if (j.mode !== 'publish' || j.targets.length === 1) {
            if (!child) throw error;
            await this.fail(error);
            child.end(j.publicationUncertain ? 'uncertain' : 'failed', reasonCode(j.failureCode));
            return false;
          }
          this.markBandFailure(result, error);
          try {
            if (result.reason === 'BAND_TARGET_INVALID' && this.bandCache) {
              const remaining = this.directory.choices.filter(band => band.key !== result.key);
              await this.clearBandCache('BAND_TARGET_INVALID').catch(() => { trace('band.list.cache', 'skip', { reason: 'CAUGHT_FAILURE' }); });
              this.directory.seedChoices(remaining);
            }
            try { await this.directory.releaseSurface(); }
            catch { trace('runner.band_write', 'skip', { reason: 'CAUGHT_FAILURE' }); }
            await this.emit();
          } finally {
            child?.end(result.outcome === 'unconfirmed' ? 'uncertain' : 'failed', reasonCode(result.reason));
          }
          this.resetTargetState();
          return true;
        }
      });
      if (!proceed) return false;
      needsPause = true;
    }
    return true;
  }
  private async runBand(result: TargetResult) {
    const j = this.job!;
    this.band ??= createBandExecution(this.work!.preview!.band, this.work!.prepared!.files, this.directory, result.key, { check: this.check, progress: this.progress,
      onIdentity: async url => { j.creationState = 'published'; result.postUrl = url; await this.emit(); } });
    const existingPost = await this.band.detectPublished();
    if (existingPost) { result.status = 'published'; result.outcome = 'ok'; result.postUrl = existingPost; await this.emit(); return true; }
    await this.band.write();
    const proof = (await this.band.observe()).photoProof;
    if (proof) j.bandPhotoVerification = { order: 'matched', ratio: proof.ratio, counts: proof.counts, sources: proof.sources, thumbnails: proof.thumbnails };
    const choice = this.directory.choices.find(b => b.key === result.key);
    j.bandPhotoLimit = choice?.photoLimit ?? null; j.bandLimitObservedAt = choice?.observedAt ?? undefined;
    if (j.mode === 'draft') {
      await this.band.stopBeforePost(); result.status = 'stopped_before_post';
      await this.capture(true, 'before-post');
      j.status = 'stopped_before_post'; j.secondsLeft = 0; j.message = '게시 전 멈춤 · 밴드 화면에서 확인하고 게시하거나 버려 주세요.';
      await this.emit(); return false;
    }
    result.postUrl = await this.band.publish().catch(error => {
      if (error instanceof RecordError) throw error;
      return retainPublishedReadback(result, this.band?.createdReceiptUrl, error);
    });
    j.bandBarrierDecisions = this.directory.decisionCodes;
    j.creationState = 'published'; j.publicationUncertain = false; result.status = 'published'; result.outcome = 'ok';
    await this.emit();
    await this.directory.releaseSurface().catch(error => trace('runner.band_write', 'skip', { reason:reasonCode(error) }));
    return true;
  }
  private markBandFailure(result: TargetResult, error: unknown) {
    const j = this.job!;
    if (error instanceof ReadbackMismatch) j.readbackIssues = error.issues;
    const code = safeFailureCode(error, 'CHANNEL_FAILED');
    const blocked = this.directory.blockedBeforeSend(result.key);
    const receipt = this.band?.createdReceiptUrl;
    if (receipt) result.postUrl ??= receipt;
    const unconfirmed = !!result.postUrl || !blocked && code !== 'BAND_CREATE_REJECTED' && (j.publicationUncertain || /^BAND_(?:POST_UNCONFIRMED|PUBLISHED_READBACK)/.test(code));
    result.reason = blocked ?? (unconfirmed && !/^BAND_(?:POST_UNCONFIRMED|PUBLISHED_READBACK)/.test(code) ? 'BAND_POST_UNCONFIRMED' : code);
    result.status = 'failed'; result.outcome = unconfirmed ? 'unconfirmed' : 'failed';
    j.publicationUncertain = false;
    j.creationState = 'none';
    j.bandBarrierDecisions = this.directory.decisionCodes;
    trace('runner.band_write', 'fail', { reason: reasonCode(result.reason), counts: { attempt: this.bandIndex + 1 } });
  }
  private async capture(isBand: boolean, stage: string) {
    const surface = isBand ? this.directory.surface : this.blog?.surface;
    const capture = isBand ? this.services.band.capture : this.services.blog?.capture;
    if (!surface || !capture) return;
    const result = await capture(surface, `job-${this.job!.id}-${Date.now()}-${stage}`).catch(() => null);
    const file = result?.file;
    if (result?.redacted === true && typeof file === 'string' && /^[a-zA-Z0-9-]+\.png$/.test(file)) this.job!.evidence = file;
  }
  private async fail(error: unknown) {
    if (error instanceof RecordError) return;
    const j = this.job!; const code = error instanceof Error ? error.message : 'BAND_FAILED';
    if (j.step !== 6) retainBlogOutcome(j, this.blog, error);
    if (error instanceof ReadbackMismatch) j.readbackIssues = error.issues;
    if (markBlogFormattingFailure(j, error)) { await this.emit(); return; }
    if (code === 'BLOG_DRAFT_SAVED_UNVERIFIED') {
      markDraftUnverified(j); await this.emit(); return;
    }
    const isBand = j.step === 6;
    if (isBand && code === 'BAND_LOGIN_LOST') await this.clearBandCache('BAND_LOGIN_LOST');
    if (isBand && ['BAND_TARGET_INVALID', 'BAND_WRITE_NOT_ALLOWED'].includes(code)) await this.clearBandCache('BAND_TARGET_INVALID');
    const blocked = isBand ? this.directory.blockedBeforeSend(j.activeTargetKey ?? '') : undefined;
    if (isBand) j.bandBarrierDecisions = this.directory.decisionCodes;
    if (blocked || code === 'BAND_CREATE_REJECTED') { j.publicationUncertain = false; j.creationState = 'none'; }
    if (isBand && /^(BAND_CREATE_REJECTED|BAND_PUBLISHED_READBACK_(MISMATCH|UNAVAILABLE))(?::|$)/.test(code)) j.publicationUncertain = false;
    j.failureCode = blocked ?? (isBand && /^BAND_POST_UNCONFIRMED:/.test(code) ? code : j.publicationUncertain ? isBand ? 'BAND_POST_UNCONFIRMED' : 'BLOG_PUBLISH_UNCONFIRMED' : safeFailureCode(error, 'CHANNEL_FAILED'));
    if (!isBand) j.failureCode = blogOutcomeFailure(j, j.failureCode);
    const execution = isBand ? this.band : this.blog;
    const dialog = blocked || ['BAND_TARGET_INVALID', 'BAND_WRITE_NOT_ALLOWED'].includes(code) ? null : await execution?.dialog().catch(() => null);
    if (dialog) { j.status = 'dialog_paused'; j.dialog = dialog; j.service = isBand ? 'band' : 'naver'; j.message = '서비스 확인창에서 선택해 주세요.'; }
    else if (/^(BAND_LOGIN_LOST|BAND_LOGIN_UNCONFIRMED|LOGIN_OR_EDITOR_LOST)$/.test(code)) {
      j.status = 'login_paused'; j.service = isBand ? 'band' : 'naver'; j.message = '로그인 풀림으로 멈춤';
      await this.emit();

    } else if (code === 'BAND_RESTART_REQUIRED' || code === 'AUTO_RECOVER_CONSENT_REQUIRED') {
      j.status = 'recovery_paused'; j.message = '작성 중인 내용이 달라졌습니다. 버리고 같은 화면에서 처음부터 시작할지 선택해 주세요.';
    } else {
      const result = isBand ? this.result() : j.targetResults!.find(t => t.channel === 'blog');
      if (result && !['draft_saved', 'published'].includes(result.status)) { result.status = 'failed'; result.reason = j.failureCode; }
      // Preserve any known receipt if an error occurred outside the viewer readback.
      if (isBand && result && this.band?.createdReceiptUrl) result.postUrl = this.band.createdReceiptUrl;
      if (result && result.status === 'failed') result.outcome = existingServiceResult({ ...j, targetResults: [result] }) ? 'unconfirmed' : 'failed';
      if ([2, 3].includes(j.step)) for (const target of j.targetResults!) if (target.status === 'running') { target.status = 'failed'; target.reason = j.failureCode; }
      j.status = !isBand && [1, 4, 5].includes(j.step) && j.targets.some(t => t.channel === 'band') ? 'channel_paused' : 'failed';
      j.message = code === 'PHOTO_HOST_NOT_ALLOWED' ? '골투에서 제공하는 주소의 사진만 내려받을 수 있습니다.' : code === 'PHOTO_DOWNLOAD_FAILED' ? '사진을 내려받지 못했습니다. 연결을 확인해 주세요.' : code === 'BAND_PHOTO_LIMIT' ? '관측한 밴드 사진 한도를 넘었습니다. 내용을 넣지 않았습니다. 확인 화면에서 사진 수를 확인해 주세요.' : code.startsWith('BAND_READBACK_MISMATCH') || code.startsWith('BAND_INPUT_MISMATCH') ? '다시 읽은 글자 또는 사진 순서가 달라 게시 전에 멈췄습니다.' : '이 채널의 작업을 마치지 못했습니다. 작성 중인 내용은 그대로 두었습니다.';
    }
    if (blocked) j.message = '앱이 게시 요청을 차단해 게시되지 않았습니다. 이번 게시 승인은 소진됐으며 자동으로 다시 제출하지 않습니다.';
    if (isBand && j.failureCode?.startsWith('BAND_POST_UNCONFIRMED:')) j.message = j.failureCode.endsWith('IDENTITY_READ_FAILED')
      ? '생성 응답에서 글 주소를 얻지 못했고 목록도 읽지 못했습니다. 등록 기록에서 확인해 주세요. 다시 게시하지 않습니다.'
      : j.failureCode.endsWith('IDENTITY_AMBIGUOUS') ? '이번 글과 일치하는 후보가 여러 개라 주소를 확정하지 못했습니다. 등록 기록에서 확인해 주세요. 다시 게시하지 않습니다.'
      : '생성 응답과 목록에서 이번 글을 하나로 확인하지 못했습니다. 등록 기록에서 확인해 주세요. 다시 게시하지 않습니다.';
    if (code.startsWith('BAND_PUBLISHED_READBACK_MISMATCH')) j.message = '게시한 글 주소는 저장했습니다. 다시 읽은 본문·줄바꿈·사진·태그·링크가 계획과 달라 검증에 실패했습니다.';
    if (code === 'BAND_PUBLISHED_READBACK_UNAVAILABLE') j.message = '게시한 글 주소는 저장했습니다. 상세 내용을 끝까지 읽지 못해 검증을 마치지 못했습니다. 다시 게시하지 않습니다.';
    if (code === 'BAND_WRITE_NOT_ALLOWED' || code === 'BAND_COMPOSER_UNAVAILABLE') {
      j.publicationUncertain = false;
      j.message = code === 'BAND_WRITE_NOT_ALLOWED' ? '이 밴드에서 글을 쓸 권한이 없습니다.' : '밴드 글쓰기 화면을 열지 못했습니다.';
    }
    if (code === 'BAND_CREATE_REJECTED') j.message = '밴드가 게시 요청을 거절했습니다. 같은 작업을 자동으로 다시 게시하지 않습니다.';
    if (isBand && code === 'BAND_TARGET_INVALID') {
      j.publicationUncertain = false;
      j.message = '밴드 목록이 바뀌었습니다. 새로고침 후 다시 골라 주세요.';
      const result = this.result(); if (result) result.reason = 'BAND_TARGET_INVALID';
      for (const target of j.targetResults ?? []) if (target !== result && target.status === 'running') { target.status = 'stopped'; target.reason = j.message; }
    }
    const choice = this.directory.choices.find(b => b.key === j.activeTargetKey);
    if (choice) { j.bandPhotoLimit = choice.photoLimit; j.bandLimitObservedAt = choice.observedAt ?? undefined; }
    if (!dialog) await this.capture(isBand, 'failure');
    if (!isBand) await this.services.blog?.recordFailure?.({ jobId: j.id, step: j.step, code: j.failureCode!, evidence: j.evidence ?? '' }).catch(() => {});
    await this.emit();
  }
  async stop() {
    if (!this.job || !['running', 'login_paused', 'recovery_paused', 'dialog_paused'].includes(this.job.status)) return;
    this.log?.line('job', 'wait', { reason: 'USER_STOPPED' });
    this.job.status = 'user_paused'; this.abort.abort(); await this.active; await this.emit();
  }
  async cancel() {
    return traceJob('unfinished_cleanup', this.job?.step === 6 ? 'band' : 'naver', async () => {
    if (!this.job || !['running', 'login_paused', 'user_paused', 'failed', 'channel_paused', 'recovery_paused'].includes(this.job.status) || this.job.publicationUncertain || this.job.activity?.stage === 'submit' || this.job.failureCode === 'BAND_POST_UNCONFIRMED') throw new ApiError('conflict', '저장 또는 게시 결과를 먼저 확인해 주세요.');
    await this.stop();
    const noComposer = ['BAND_TARGET_INVALID','BAND_WRITE_NOT_ALLOWED','BAND_COMPOSER_UNAVAILABLE','BAND_APP_PROMPT_NOT_DISMISSED'].includes(this.job.failureCode ?? '');
    if (this.band && (!noComposer || this.band.hasOwnedComposer && this.job.failureCode !== 'BAND_WRITE_NOT_ALLOWED')) await this.band.discard();
    await this.blog?.close(); await this.work?.cleanup();
    for (const target of this.job.targetResults ?? []) if (!['draft_saved', 'published'].includes(target.status)) target.status = 'stopped';
    this.job.status = 'stopped'; await this.emit();
    });
  }
  async resume() {
    if (this.job?.failureCode === 'BAND_WRITE_NOT_ALLOWED') throw new ApiError('conflict', '이 밴드에서 글을 쓸 권한이 없습니다.');
    if (this.job?.failureCode === 'BAND_TARGET_INVALID') throw new ApiError('conflict', '밴드 목록이 바뀌었습니다. 새로고침 후 다시 골라 주세요.');
    const movingToNextBand = this.job?.step === 6 && !!this.result()?.outcome && this.job.targetResults?.some(target => target.channel === 'band' && target.status === 'running');
    if (!movingToNextBand && this.job && existingServiceResult(this.job) && (this.job.status==='failed' || ['user_paused','login_paused'].includes(this.job.status) && !this.blogSkipped && !this.job.targetResults?.some(t=>t.status==='published'))) throw new ApiError('conflict', '저장 또는 게시 결과는 등록 기록에서 확인해 주세요. 같은 글을 다시 올리지 않습니다.');
    if (bandPostBlocked(this.job?.failureCode)) throw new ApiError('conflict', '같은 작업을 다시 게시하지 않습니다. 등록 기록에서 결과를 확인해 주세요.');
    if (this.job?.publicationUncertain || /^BAND_(POST_UNCONFIRMED|PUBLISHED_READBACK_|CREATE_REJECTED)/.test(this.job?.failureCode ?? '') || this.job?.failureCode?.startsWith('BLOG_PUBLISH_')) throw new ApiError('conflict', '게시됐는지 먼저 확인해 주세요. 같은 작업을 다시 게시하지 않습니다.');
    if (this.serviceLogin.active) throw new ApiError('conflict', '로그인 확인을 먼저 마쳐 주세요.');
    if (!this.job || !['user_paused', 'login_paused', 'failed'].includes(this.job.status) || this.job.completedSteps.includes(7)) throw new ApiError('conflict', '화면의 선택을 먼저 마쳐 주세요.');
    await this.active; this.abort = new AbortController(); await this.hideService(); this.job.status = 'running'; this.job.service = null; this.job.message = '';
    for (const result of this.job.targetResults ?? []) {
      const active = this.job.step <= 3 ? !(this.blogSkipped && result.channel === 'blog') : this.job.step <= 5 ? result.channel === 'blog' : result === this.result();
      if (active && result.status === 'failed') { result.status = 'running'; delete result.reason; }
    }
    this.log = registrationLog(this.job); this.log?.line('job', 'retry'); await this.emit(); this.launch();
  }
  async continueBand() {
    if (this.job?.status !== 'channel_paused') throw new ApiError('conflict', '밴드 진행을 선택할 작업이 없습니다.');
    await this.active;
    // Preparation errors are not skipped. A blog failure before download still prepares the product.
    this.job.step = this.work?.prepared ? 6 : 2;
    this.blog = undefined; this.blogSkipped = true; this.job.status = 'user_paused'; await this.resume();
  }
  async recover(discard: boolean) {
    if (this.job?.status !== 'recovery_paused') throw new ApiError('conflict', '다시 시작할 내용이 없습니다.');
    await this.active;
    if (!discard) { await this.cancel(); return; }
    this.job.status = 'user_paused';
    if (this.job.step === 6) this.band?.allowRestart(); else this.blog?.consentToDiscard();
    delete this.job.failureCode; await this.resume();
  }
  async answerDialog(id: string, accept: boolean) {
    if (this.job?.status !== 'dialog_paused' || this.job.dialog?.id !== id) throw new ApiError('conflict', '확인창이 바뀌었습니다.');
    await (this.job.step === 6 ? this.band : this.blog)?.answerDialog(id, accept);
    if (!accept) this.band?.resetDiscard();
    delete this.job.dialog;
    if (this.discardPending) {
      this.job.status = 'stopped_before_post';
      if (accept) await this.discardBand(); else {
        this.discardPending = false; this.band?.resetDiscard();
        try { await this.emit(); } catch (error) { if (!(error instanceof RecordError)) throw error; }
      }
    } else { this.job.status = 'user_paused'; await this.emit(); }
  }
  async showBand(key: string) {
    if (!this.band || this.job?.activeTargetKey !== key || !['stopped_before_post', 'failed', 'running'].includes(this.result()?.status ?? '')) throw new ApiError('invalid', '현재 작업의 밴드 작성기만 열 수 있습니다.');
    await this.band.show();
  }
  async checkBand() {
    if (this.job?.status !== 'stopped_before_post' || !this.band) return;
    try {
      await this.directory.guard(false);
      const url = await this.band.detectPublished();
      if (!url) { this.job.message = '게시 전 멈춤 · 게시된 새 글 주소는 확인되지 않았습니다.'; await this.emit(); return; }
      this.result()!.status = 'published'; this.result()!.postUrl = url; await this.nextBand();
    } catch (error) { await this.fail(error); }
  }
  async discardBand() {
    return traceJob('unfinished_cleanup', 'band', async () => {
    if (this.result()?.status === 'published') throw new ApiError('conflict', '이미 게시한 글은 작성 취소로 지울 수 없습니다. 등록 기록을 확인해 주세요.');
    if (!this.job || this.job.step !== 6 || !['stopped_before_post', 'record_failed', 'failed', 'user_paused', 'recovery_paused'].includes(this.job.status) || !this.band) throw new ApiError('conflict', '버릴 작성기가 없습니다.');
    try {
      this.discardPending = true; await this.band.discard(); this.discardPending = false;
      this.result()!.status = 'stopped'; await this.nextBand();
    } catch (error) { await this.fail(error); }
    });
  }
  private async nextBand() {
    await this.band?.hide(); this.bandIndex++; this.band = undefined;
    this.job!.status = 'user_paused'; this.job!.message = ''; await this.emit(); await this.resume();
  }
  async checkBandLogin() { return this.serviceLogin.check('band'); }
  async checkLogin() { return this.serviceLogin.check('naver'); }
  async showService(service: Service) {
    if (this.job && !['draft_saved', 'draft_unverified', 'published', 'stopped', 'login_paused'].includes(this.job.status)) throw new ApiError('conflict', '로그인으로 멈춘 작업에서만 로그인 화면을 열 수 있습니다.');
    if (service !== 'ai') await this.serviceLogin.show(service);
  }
  async hideService() { await this.serviceLogin.cancel(); await this.directory.surface?.hide(); await this.blog?.hide(); }
  async showDraft(title: string) { if (this.job?.title !== title || !this.job.targetResults?.some(t => t.channel === 'blog' && t.status === 'draft_saved')) throw new ApiError('invalid', '이번 실행의 임시글만 열 수 있습니다.'); await this.blog?.show(); }
  dispose() { this.disposed = true; this.bandCache?.dispose(); this.bandListeners.clear(); this.abort.abort(); this.serviceLogin.dispose(); void (this.active ?? Promise.resolve()).then(() => this.work?.cleanup()).catch(() => {}); }
  blogExecution() { return this.blog; }
}
