import { existingServiceResult } from './job-safety';
import { retainBlogOutcome, blogOutcomeFailure, retainPublishedReadback } from './blog-outcome';
import { registrationLog, registrationAttempt } from './registration-log';
import { inTrace, trace, traceJob, reasonCode, type TraceJob } from '@goltou/surface/telemetry';
import { ApiError } from '@goltou/api-client';
import { safeFailureCode, type BlogExecution } from '@goltou/sites';
import { ServiceLoginController } from './service-login';
import type { Job, JobInput } from './protocol';
import type { Checkpoint, RegistrationRunner, RegistrationStart } from './runner';
import type { PreparationWork } from './preparation';
import { createBlogExecution, type BlogServices } from './blog';
import { updateInputProgress } from './input-progress';
import { RecordError, RecordingCheckpoint } from './record-checkpoint';
import { markDraftUnverified } from './draft-unverified';
import { markBlogFormattingFailure } from './blog-formatting-failure';

/** Android's real blog runner. Band remains outside WP5 and cannot be reported as saved. */
export class BlogRegistrationRunner implements RegistrationRunner {
  job: Job | null = null;
  readonly serviceLogin: ServiceLoginController;
  private serial = 0;
  private log: TraceJob | undefined;
  private work: PreparationWork | undefined;
  private execution: BlogExecution | undefined;
  private abort = new AbortController();
  private active: Promise<void> | undefined;
  private disposed = false;
  private saves = 0;
  private readonly recording: RecordingCheckpoint;
  private traceForTarget: RegistrationStart['traceForTarget'];
  constructor(private readonly services: BlogServices, checkpoint: Checkpoint, private readonly notify: (job: Job) => void) {
    this.recording = new RecordingCheckpoint(checkpoint, notify);
    this.serviceLogin = new ServiceLoginController(services.host);
    if (services.localPublish && (!services.editorUrl || new URL(services.editorUrl).hostname !== '127.0.0.1')) throw new Error('LOCAL_EDITOR_REQUIRED');
  }
  async start(input: JobInput, title: string, photos: number, work?: PreparationWork, context?: RegistrationStart) {
    this.traceForTarget = context?.traceForTarget;
    this.log = this.registrationLog(input);
    return inTrace(this.log, async () => {
    try {
    if (this.serviceLogin.active) throw new ApiError('conflict', '로그인 확인을 먼저 마쳐 주세요.');
    if (this.job && !['draft_saved', 'draft_unverified', 'published'].includes(this.job.status) &&
      !(context?.retry && this.job.status === 'failed' && !existingServiceResult(this.job))) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
    if (input.targets.some(t => t.channel !== 'blog')) throw new ApiError('invalid', '현재 실제 등록은 블로그 한 곳만 지원합니다. 밴드를 꺼 주세요.');
    if (input.targets.length !== 1 || !work) throw new ApiError('invalid', '블로그 입력 준비가 필요합니다.');
    if (!this.services.localPublish && !this.services.publishEnabled && (input.mode !== 'draft' || !title.startsWith('[골투오토 실험]'))) throw new ApiError('invalid', '실제 네이버 발행 설정을 확인해 주세요.');
    if (input.mode === 'publish' && input.publishConfirmed !== true) throw new ApiError('invalid', '이 작업의 발행 선택이 필요합니다.');
    await this.active;
    await this.execution?.close();
    if (context?.retry) await this.work?.cleanup();
    this.execution = undefined; this.work = work; this.abort = new AbortController();
    this.job = { creationState: 'none', startedAt: Date.now(), id: ++this.serial, productNo: input.productNo, title, mode: input.mode, blogVisibility: input.blogVisibility ?? 'public', targets: input.targets, targetResults: input.targets.map(t => ({ ...t, status: 'running' })), status: 'running', step: 1, current: 0, total: photos, completedSteps: [], service: null, message: '' };
    try { await this.emit(); this.launch(); } catch (error) { this.log?.end('failed', reasonCode(error)); if (!(error instanceof RecordError)) throw error; }
    } catch (error) { this.log?.end('failed', reasonCode(error)); throw error; }
    });
  }
  private async emit() { if (this.job) await this.recording.emit(this.job); }
  private registrationLog(input: Pick<JobInput, 'targets' | 'mode'>) {
    const target = input.targets[0];
    return (target && this.traceForTarget?.(target)) ?? registrationLog(input);
  }
  async retryRecord() {
    await this.active; if (!this.job) return;
    this.log = registrationLog(this.job); this.log?.line('runner.record', 'retry');
    await registrationAttempt(this.log, () => this.recording.retry(this.job!), () => this.job);
  }
  private launch() { this.active = registrationAttempt(this.log, () => this.run(), () => this.job).catch(error => { if (error instanceof RecordError) return; if (this.job) { this.job.status = 'failed'; this.job.message = '작업을 마치지 못했습니다.'; this.notify(structuredClone(this.job)); } }).finally(() => { this.active = undefined; }); }
  async stop() {
    if (!this.job || !['running', 'login_paused', 'dialog_paused', 'recovery_paused'].includes(this.job.status)) return;
    this.log?.line('job', 'wait', { reason: 'USER_STOPPED' });
    this.job.status = 'user_paused'; this.abort.abort(); await this.active; await this.emit();
  }
  async resume() {
    if (this.job && existingServiceResult(this.job)) throw new ApiError('conflict', '저장 또는 발행 결과는 등록 기록에서 확인해 주세요. 같은 글을 다시 올리지 않습니다.');
    if (this.serviceLogin.active) throw new ApiError('conflict', '로그인 확인을 먼저 마쳐 주세요.');
    if (!this.job || !['user_paused', 'login_paused', 'failed'].includes(this.job.status)) throw new ApiError('conflict', '먼저 화면의 선택을 마쳐 주세요.');
    await this.execution?.hide(); this.abort = new AbortController(); this.job.status = 'running'; this.job.message = ''; this.job.service = null;
    for (const result of this.job.targetResults ?? []) if (result.status === 'failed') { result.status = 'running'; delete result.reason; }
    this.log = this.registrationLog(this.job); this.log?.line('job', 'retry'); await inTrace(this.log, () => this.emit()); this.launch();
  }
  async recover(discard: boolean) {
    if (this.job?.status !== 'recovery_paused') throw new ApiError('conflict', '자동복구 안내가 없습니다.');
    await this.active;
    if (!discard) {
      return traceJob('unfinished_cleanup', 'naver', async () => {
      await this.execution?.close(); await this.work?.cleanup();
      for (const result of this.job!.targetResults ?? []) if (!['draft_saved', 'published'].includes(result.status)) result.status = 'stopped';
      this.job!.status = 'stopped'; delete this.job!.failureCode; this.job!.message = '옮기기를 중단했습니다.';
      await this.emit(); return;
      });
    }
    this.job.status = 'user_paused';
    this.execution?.consentToDiscard(); delete this.job.failureCode; await this.resume();
  }
  async answerDialog(id: string, accept: boolean) {
    if (this.job?.status !== 'dialog_paused' || this.job.dialog?.id !== id) throw new ApiError('conflict', '확인창이 바뀌었습니다.');
    await this.execution?.answerDialog(id, accept); delete this.job.dialog; this.job.status = 'user_paused'; await this.emit();
  }
  async showDraft(title: string) {
    if (!this.execution || !this.job?.completedSteps.includes(5) || this.job.title !== title) throw new ApiError('invalid', '이번 실행에서 확인한 임시글만 열 수 있습니다.');
    await this.execution.show();
  }
  async checkLogin() {
    return this.serviceLogin.check('naver');
  }
  async showService(service: import('./protocol').Service) {
    if (service !== 'naver') return;
    if (this.job && !['draft_saved', 'draft_unverified', 'published', 'stopped', 'login_paused'].includes(this.job.status)) throw new ApiError('conflict', '로그인으로 멈춘 작업에서만 로그인 화면을 열 수 있습니다.');
    await this.serviceLogin.show('naver');
  }
  async hideService() { await this.serviceLogin.cancel(); await this.execution?.hide(); }
  private async run() {
    const job = this.job!;
    const check = () => { this.abort.signal.throwIfAborted(); if (this.disposed) throw new Error('RUNNER_DISPOSED'); };
    try {
      while (job.step <= 7) {
        const phase = (['runner.ready', 'runner.download', 'runner.arrange', 'runner.blog_write', 'runner.blog_save', 'runner.band_write', 'runner.record'] as const)[job.step - 1]!;
        const phaseStarted = Date.now();
        trace(phase, 'start', { counts: { step: job.step } });
        check();
        if (job.step === 1) {
          const preview = this.work!.preview;
          if (!preview) throw new Error('PREPARATION_REQUIRED');
          this.execution ??= createBlogExecution(preview.blog, [], this.services, { ...this.hooks(check), mode: job.mode, visibility: job.blogVisibility ?? 'public' });
          await this.execution.ensureReady();
        }
        if (job.step === 2) await this.work!.download(this.abort.signal, n => { job.current = n; job.message = `사진 ${n} / ${job.total}`; this.notify(structuredClone(job)); });
        if (job.step === 3) await this.work!.arrange();
        if (job.step === 4) {
          const prepared = this.work!.prepared;
          if (!prepared) throw new Error('PREPARATION_REQUIRED');
          if (!this.execution) throw new Error('PREPARATION_REQUIRED');
          this.execution.files = prepared.files;
          await this.execution.write();
          trace('job.checkpoint', 'ok', { checkpoint: 'photos_uploaded' });
        }
        if (job.step === 5) {
          await this.execution!.saveAndVerify();
          if (this.execution!.draftIdentity) job.blogDraftIdentity = this.execution!.draftIdentity;
          if (job.mode === 'publish') {
            job.postUrl = await this.execution!.publish().catch(error =>
              retainPublishedReadback(job.targetResults![0]!, this.execution!.publishedPost?.url, error));
            job.publicationUncertain = false; job.creationState = 'published';
          }
          job.blogReadbackTimings = [...this.execution!.readbackTimings];
          job.blogIdentitySources = [...this.execution!.publishedIdentitySources];
          job.targetResults![0]!.status = job.mode === 'draft' ? 'draft_saved' : 'published';
          job.targetResults![0]!.outcome = 'ok';
          if (job.postUrl) job.targetResults![0]!.postUrl = job.postUrl;
          job.tableModes = [...this.execution!.tableModes]; job.linkCard = this.execution!.linkCard;
        }
        if (job.step === 7) { await this.execution!.close(); await this.work!.cleanup(); }
        trace(phase, 'ok', { counts: { step: job.step } }, Date.now() - phaseStarted);
        check(); job.completedSteps.push(job.step);
        if (job.step === 7) { job.status = job.mode === 'draft' ? 'draft_saved' : 'published'; job.message = job.mode === 'draft' ? '새 편집기에서 임시글을 다시 열어 원문 대조를 마쳤습니다.' : job.targetResults?.[0]?.readbackNotes ? '발행했습니다. 상세 결과를 확인해 주세요.' : '발행된 글에서 원문 대조를 마쳤습니다.'; job.secondsLeft = 0; await this.emit(); return; }
        job.step++; job.current = 0; delete job.secondsLeft; job.message = job.step === 6 ? '밴드 선택 없음' : ''; await this.emit();
      }
    } catch (error) {
      trace('job', 'fail', { reason: reasonCode(error), counts: { step: job.step } });
      if (error instanceof RecordError) return;
      if (this.abort.signal.aborted || this.disposed) return;
      retainBlogOutcome(job, this.execution, error);
      if (markBlogFormattingFailure(job, error)) { await this.emit(); return; }
      const code = error instanceof Error ? error.message : 'BLOG_FAILED';
      if (code === 'BLOG_DRAFT_SAVED_UNVERIFIED') {
        markDraftUnverified(job); await this.emit(); return;
      }
      const pendingDialog = await this.execution?.dialog().catch(() => null);
      // Only controlled error codes are persisted; never page text, IDs, URLs or dialog contents.
      job.message = safeFailureCode(error, 'BLOG_FAILED');
      if (pendingDialog) { job.status = 'dialog_paused'; job.dialog = pendingDialog; job.message = 'USER_DIALOG_REQUIRED'; }
      else if (code === 'LOGIN_OR_EDITOR_LOST') { job.status = 'login_paused'; job.service = 'naver'; await this.emit(); }
      else if (code === 'AUTO_RECOVER_CONSENT_REQUIRED') job.status = 'recovery_paused';
      else if (code === 'USER_DIALOG_REQUIRED') { job.status = 'dialog_paused'; const dialog = await this.execution?.dialog(); if (dialog) job.dialog = dialog; }
      else job.status = 'failed';
      job.failureCode = blogOutcomeFailure(job, job.publicationUncertain ? 'BLOG_PUBLISH_UNCONFIRMED' : safeFailureCode(error, 'BLOG_FAILED'));
      if (job.status === 'failed' && job.targetResults?.[0]?.status === 'running') { job.targetResults[0].status = 'failed'; job.targetResults[0].reason = job.failureCode; job.targetResults[0].outcome = existingServiceResult(job) ? 'unconfirmed' : 'failed'; }
      job.message = code === 'PHOTO_HOST_NOT_ALLOWED' ? '골투에서 제공하는 주소의 사진만 내려받을 수 있습니다.' : code === 'PHOTO_DOWNLOAD_FAILED' ? '사진을 내려받지 못했습니다. 연결을 확인해 주세요.' : code === 'LOGIN_OR_EDITOR_LOST' ? '로그인 풀림으로 멈춤' : job.status === 'dialog_paused' ? '네이버 확인창의 선택을 기다립니다.' : job.status === 'recovery_paused' ? '작성 중인 글을 버리고 새로 시작할지 선택해 주세요.' : code === 'DRAFT_IDENTITY_AMBIGUOUS' ? '같은 제목의 임시글이 여러 개여서 멈췄습니다.' : code.startsWith('BLOG_READBACK_MISMATCH') ? '다시 읽은 글이 원문과 달라 완료하지 못했습니다.' : ['TABLE_DIMENSIONS_UNSTABLE','TABLE_CLEANUP_UNCONFIRMED'].includes(code) ? '표 배치를 확인할 수 없어 멈췄습니다.' : code === 'CURSOR_POSITION_UNCONFIRMED' ? '사진을 넣을 커서 위치를 확인하지 못했습니다.' : code === 'DRAFT_SAVE_LIMIT' ? '이번 실행의 임시저장 한도에 도달했습니다.' : '편집기 상태를 확인하지 못해 멈췄습니다. 작성 중인 글은 그대로 두었습니다.';
      if (this.execution?.surface && this.services.capture) {
        try { const evidence = await this.services.capture(this.execution.surface, `wp5-job-${job.id}-step-${job.step}`); job.evidence = typeof evidence.file === 'string' ? evidence.file : 'unavailable'; }
        catch { job.evidence = 'unavailable'; }
      }
      await this.services.recordFailure?.({ jobId: job.id, step: job.step, code: job.failureCode, evidence: job.evidence ?? 'unavailable' }).catch(() => {});
      await this.emit();
    }
  }
  private hooks(check: () => void) {
    return {
      check,
      beforeSave: () => { if (++this.saves > (this.services.draftSaveLimit ?? 3)) throw new Error('DRAFT_SAVE_LIMIT'); },
      progress: (value: import('@goltou/sites').BlogProgress) => {
        const job = this.job!;
        updateInputProgress(job, value);
        this.notify(structuredClone(job));
      },
    };
  }
  dispose() { this.disposed = true; this.abort.abort(); this.serviceLogin.dispose(); void (this.active ?? Promise.resolve()).then(() => this.work?.cleanup()).catch(() => {}); }
  blogExecution() { return this.execution; }
}
