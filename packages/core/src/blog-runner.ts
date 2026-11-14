import { ApiError } from '@goltou/api-client';
import { loginState, safeFailureCode, type BlogExecution } from '@goltou/sites';
import type { Job, JobInput } from './protocol';
import type { Checkpoint, RegistrationRunner } from './runner';
import type { PreparationWork } from './preparation';
import { createBlogExecution, type BlogServices } from './blog';
import { updateInputProgress } from './input-progress';
import { RecordError, RecordingCheckpoint } from './record-checkpoint';

/** Android's real blog runner. Band remains outside WP5 and cannot be reported as saved. */
export class BlogRegistrationRunner implements RegistrationRunner {
  job: Job | null = null;
  private serial = 0;
  private work: PreparationWork | undefined;
  private execution: BlogExecution | undefined;
  private abort = new AbortController();
  private active: Promise<void> | undefined;
  private disposed = false;
  private saves = 0;
  private readonly recording: RecordingCheckpoint;
  constructor(private readonly services: BlogServices, checkpoint: Checkpoint, private readonly notify: (job: Job) => void) {
    this.recording = new RecordingCheckpoint(checkpoint, notify);
    if (services.localPublish && (!services.editorUrl || new URL(services.editorUrl).hostname !== '127.0.0.1')) throw new Error('LOCAL_EDITOR_REQUIRED');
  }
  async start(input: JobInput, title: string, photos: number, work?: PreparationWork) {
    if (this.job && !['draft_saved', 'published'].includes(this.job.status)) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
    if (input.targets.some(t => t.channel !== 'blog')) throw new ApiError('invalid', '현재 실제 등록은 블로그 한 곳만 지원합니다. 밴드를 꺼 주세요.');
    if (input.targets.length !== 1 || !work) throw new ApiError('invalid', '블로그 입력 준비가 필요합니다.');
    if (!this.services.localPublish && !this.services.publishEnabled && (input.mode !== 'draft' || !title.startsWith('[골투오토 실험]'))) throw new ApiError('invalid', '실제 네이버 발행 설정을 확인해 주세요.');
    if (input.mode === 'publish' && input.publishConfirmed !== true) throw new ApiError('invalid', '이 작업의 발행 선택이 필요합니다.');
    await this.execution?.close();
    this.execution = undefined; this.work = work; this.abort = new AbortController();
    this.job = { id: ++this.serial, productNo: input.productNo, title, mode: input.mode, blogVisibility: input.blogVisibility ?? 'public', targets: input.targets, targetResults: input.targets.map(t => ({ ...t, status: 'running' })), status: 'running', step: 1, current: 0, total: photos, completedSteps: [], service: null, message: '' };
    try { await this.emit(); this.launch(); } catch (error) { if (!(error instanceof RecordError)) throw error; }
  }
  private async emit() { if (this.job) await this.recording.emit(this.job); }
  async retryRecord() { await this.active; if (this.job) await this.recording.retry(this.job); }
  private launch() { this.active = this.run().catch(error => { if (error instanceof RecordError) return; if (this.job) { this.job.status = 'failed'; this.job.message = '작업을 마치지 못했습니다.'; this.notify(structuredClone(this.job)); } }).finally(() => { this.active = undefined; }); }
  async stop() {
    if (!this.job || !['running', 'login_paused', 'dialog_paused', 'recovery_paused'].includes(this.job.status)) return;
    this.job.status = 'user_paused'; this.abort.abort(); await this.active; await this.emit();
  }
  async resume() {
    if (!this.job || !['user_paused', 'login_paused', 'failed'].includes(this.job.status)) throw new ApiError('conflict', '먼저 화면의 선택을 마쳐 주세요.');
    await this.execution?.hide(); this.abort = new AbortController(); this.job.status = 'running'; this.job.message = ''; this.job.service = null;
    for (const result of this.job.targetResults ?? []) if (result.status === 'failed') { result.status = 'running'; delete result.reason; }
    await this.emit(); this.launch();
  }
  async recover(discard: boolean) {
    if (this.job?.status !== 'recovery_paused') throw new ApiError('conflict', '자동복구 안내가 없습니다.');
    this.job.status = 'user_paused';
    if (discard) { this.execution?.consentToDiscard(); await this.resume(); } else await this.emit();
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
    if (!this.execution?.surface) return 'unknown' as const;
    return loginState(this.execution.surface);
  }
  async showService(service: import('./protocol').Service) {
    if (service !== 'naver') return;
    if (!this.execution?.surface) throw new ApiError('invalid', '등록을 시작하면 네이버 로그인 상태를 확인합니다.');
    await this.execution.show();
  }
  async hideService() { await this.execution?.hide(); }
  private async run() {
    const job = this.job!;
    const check = () => { this.abort.signal.throwIfAborted(); if (this.disposed) throw new Error('RUNNER_DISPOSED'); };
    try {
      while (job.step <= 7) {
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
        }
        if (job.step === 5) {
          await this.execution!.saveAndVerify();
          if (job.mode === 'publish') job.postUrl = await this.execution!.publish();
          job.blogReadbackTimings = [...this.execution!.readbackTimings];
          job.blogIdentitySources = [...this.execution!.publishedIdentitySources];
          job.targetResults![0]!.status = job.mode === 'draft' ? 'draft_saved' : 'published';
          if (job.postUrl) job.targetResults![0]!.postUrl = job.postUrl;
          job.tableModes = [...this.execution!.tableModes]; job.linkCard = this.execution!.linkCard;
        }
        if (job.step === 7) await this.work!.cleanup();
        check(); job.completedSteps.push(job.step);
        if (job.step === 7) { job.status = job.mode === 'draft' ? 'draft_saved' : 'published'; job.message = job.mode === 'draft' ? '새 편집기에서 임시글을 다시 열어 원문 대조를 마쳤습니다.' : '발행된 글에서 원문 대조를 마쳤습니다.'; job.secondsLeft = 0; await this.emit(); return; }
        job.step++; job.current = 0; delete job.secondsLeft; job.message = job.step === 6 ? '밴드 선택 없음' : ''; await this.emit();
      }
    } catch (error) {
      if (error instanceof RecordError) return;
      if (this.abort.signal.aborted || this.disposed) return;
      const code = error instanceof Error ? error.message : 'BLOG_FAILED';
      const pendingDialog = await this.execution?.dialog().catch(() => null);
      // Only controlled error codes are persisted; never page text, IDs, URLs or dialog contents.
      job.message = safeFailureCode(error, 'BLOG_FAILED');
      if (pendingDialog) { job.status = 'dialog_paused'; job.dialog = pendingDialog; job.message = 'USER_DIALOG_REQUIRED'; }
      else if (code === 'LOGIN_OR_EDITOR_LOST') { job.status = 'login_paused'; job.service = 'naver'; await this.execution?.show(); }
      else if (code === 'AUTO_RECOVER_CONSENT_REQUIRED') job.status = 'recovery_paused';
      else if (code === 'USER_DIALOG_REQUIRED') { job.status = 'dialog_paused'; const dialog = await this.execution?.dialog(); if (dialog) job.dialog = dialog; }
      else job.status = 'failed';
      job.failureCode = safeFailureCode(error, 'BLOG_FAILED');
      if (job.status === 'failed' && job.targetResults?.[0]?.status === 'running') { job.targetResults[0].status = 'failed'; job.targetResults[0].reason = job.failureCode; }
      job.message = code === 'PHOTO_HOST_NOT_ALLOWED' ? '골투에서 제공하는 주소의 사진만 내려받을 수 있습니다.' : code === 'PHOTO_DOWNLOAD_FAILED' ? '사진을 내려받지 못했습니다. 연결을 확인해 주세요.' : code === 'LOGIN_OR_EDITOR_LOST' ? '로그인 풀림으로 멈춤' : job.status === 'dialog_paused' ? '네이버 확인창의 선택을 기다립니다.' : job.status === 'recovery_paused' ? '작성 중인 글을 버리고 새로 시작할지 선택해 주세요.' : code === 'DRAFT_IDENTITY_AMBIGUOUS' ? '같은 제목의 임시글이 여러 개여서 멈췄습니다.' : code.startsWith('BLOG_READBACK_MISMATCH') ? '다시 읽은 글이 원문과 달라 완료하지 못했습니다.' : code === 'TABLE_DIMENSIONS_UNSTABLE' ? '표 배치를 확인할 수 없어 멈췄습니다.' : code === 'CURSOR_POSITION_UNCONFIRMED' ? '사진을 넣을 커서 위치를 확인하지 못했습니다.' : code === 'DRAFT_SAVE_LIMIT' ? '이번 실행의 임시저장 한도에 도달했습니다.' : '편집기 상태를 확인하지 못해 멈췄습니다. 작성 중인 글은 그대로 두었습니다.';
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
  dispose() { this.disposed = true; this.abort.abort(); void (this.active ?? Promise.resolve()).then(() => this.work?.cleanup()).catch(() => {}); }
  blogExecution() { return this.execution; }
}
