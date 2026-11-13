import { ApiError } from '@goltou/api-client';
import { loginState, safeFailureCode, BandDirectory, type BandExecution, type BlogExecution, type BandProgress } from '@goltou/sites';
import type { Job, JobInput, Service } from './protocol';
import type { Checkpoint, RegistrationRunner } from './runner';
import type { PreparationWork } from './preparation';
import { createBandExecution, type BandServices } from './band';
import { createBlogExecution, type BlogServices } from './blog';
import { updateInputProgress } from './input-progress';

/** One product, blog first, then exactly one Band composer at a time. */
export class ChannelRegistrationRunner implements RegistrationRunner {
  job: Job | null = null;
  readonly directory: BandDirectory;
  private work: PreparationWork | undefined;
  private blog: BlogExecution | undefined;
  private band: BandExecution | undefined;
  private abort = new AbortController();
  private active: Promise<void> | undefined;
  private disposed = false;
  private serial = 0;
  private saves = 0;
  private bandIndex = 0;
  private discardPending = false;
  private blogSkipped = false;
  constructor(private readonly services: { band: BandServices; blog?: BlogServices }, private readonly checkpoint: Checkpoint, private readonly notify: (job: Job) => void) {
    this.directory = new BandDirectory(services.band.host, services.band.baseUrl, services.band.localPublish);
  }
  async listBands() {
    if (this.active || this.band && !['stopped', 'published'].includes(this.result()?.status ?? '')) throw new ApiError('conflict', '작성 중인 밴드부터 확인하거나 버려 주세요.');
    try { return await this.directory.list(); }
    catch (error) {
      if (error instanceof Error && /BAND_LOGIN_(LOST|UNCONFIRMED)/.test(error.message)) {
        await this.directory.surface?.show(); throw new ApiError('auth', '밴드 로그인 상태를 확인하지 못했습니다. 밴드 화면에서 직접 확인해 주세요.');
      }
      throw error;
    }
  }
  async start(input: JobInput, title: string, photos: number, work?: PreparationWork) {
    if (this.job && !['draft_saved', 'published', 'stopped'].includes(this.job.status) && !this.job.completedSteps.includes(7)) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
    if (!work?.preview || !input.targets.length) throw new ApiError('invalid', '입력 준비가 필요합니다.');
    if (input.mode === 'publish' && !input.publishConfirmed) throw new ApiError('invalid', '이 작업의 발행 확인이 필요합니다.');
    const bands = input.targets.filter(t => t.channel === 'band');
    if (bands.length && input.mode === 'publish' && !this.services.band.localPublish) throw new ApiError('invalid', '실제 밴드 자동 게시가 차단되어 있습니다. 임시저장 방식을 선택해 주세요.');
    if (bands.some(t => !this.directory.choices.some(b => b.key === t.key))) throw new ApiError('invalid', '내 밴드 목록에서 다시 골라 주세요.');
    if (!this.services.band.localPublish && bands.some(t => t.key !== this.directory.choices[0]?.key)) throw new ApiError('invalid', '이번 실기기 확인은 첫 밴드만 허용합니다.');
    const blogs = input.targets.filter(t => t.channel === 'blog');
    if (blogs.length > 1 || blogs.length && !this.services.blog) throw new ApiError('invalid', '블로그 실행 설정을 확인해 주세요.');
    if (blogs.length && !this.services.blog?.localPublish && (input.mode !== 'draft' || !title.startsWith('[골투오토 실험]'))) throw new ApiError('invalid', '실제 네이버는 실험 제목의 임시저장만 허용합니다.');
    this.work = work; this.abort = new AbortController(); this.band = undefined; this.bandIndex = 0; this.discardPending = false; this.blogSkipped = false;
    await this.blog?.close(); this.blog = undefined;
    this.job = { id: ++this.serial, productNo: input.productNo, title, mode: input.mode, targets: structuredClone(input.targets), targetResults: input.targets.map(t => ({ ...t, status: 'running' })), status: 'running', step: 1, current: 0, total: photos, completedSteps: [], service: null, message: '' };
    await this.emit(); this.launch();
  }
  private result() { return this.job?.targetResults?.filter(t => t.channel === 'band')[this.bandIndex]; }
  private async emit() { if (this.job) { await this.checkpoint(structuredClone(this.job)); this.notify(structuredClone(this.job)); } }
  private check = () => { this.abort.signal.throwIfAborted(); if (this.disposed) throw new Error('RUNNER_DISPOSED'); };
  private launch() {
    this.active = this.run().catch(() => { if (this.job) { this.job.status = 'failed'; this.job.message = '기록을 저장하지 못했습니다.'; this.notify(structuredClone(this.job)); } }).finally(() => { this.active = undefined; });
  }
  private progress = (v: BandProgress) => {
    const j = this.job!; updateInputProgress(j, v);
    this.notify(structuredClone(j));
  };
  private async run() {
    const j = this.job!;
    try {
      while (j.step <= 7) {
        this.check();
        if (j.step === 1 && j.targets.some(t => t.channel === 'blog')) {
          this.blog ??= createBlogExecution(this.work!.preview!.blog, [], this.services.blog!, { mode: j.mode, check: this.check, progress: this.progress, beforeSave: () => { if (++this.saves > (this.services.blog?.draftSaveLimit ?? 3)) throw new Error('DRAFT_SAVE_LIMIT'); } });
          await this.blog.ensureReady();
        }
        if (j.step === 2) await this.work!.download(this.abort.signal, n => { j.current = n; this.notify(structuredClone(j)); });
        if (j.step === 3) await this.work!.arrange();
        if (j.step === 4 && this.blog) { this.blog.files = this.work!.prepared!.files; await this.blog.write(); }
        if (j.step === 5 && this.blog) {
          await this.blog.saveAndVerify();
          j.blogReadbackTimings = [...this.blog.readbackTimings];
          const result = j.targetResults!.find(t => t.channel === 'blog')!;
          if (j.mode === 'publish') result.postUrl = await this.blog.publish();
          result.status = j.mode === 'draft' ? 'draft_saved' : 'published';
          j.tableModes = [...this.blog.tableModes]; j.linkCard = this.blog.linkCard;
          await this.capture(false, 'draft-verified');
        }
        if (j.step === 6) {
          const bands = j.targetResults!.filter(t => t.channel === 'band');
          for (; this.bandIndex < bands.length; this.bandIndex++, this.band = undefined) {
            const result = bands[this.bandIndex]!; j.activeTargetKey = result.key;
            if (['published', 'stopped'].includes(result.status)) continue;
            this.band ??= createBandExecution(this.work!.preview!.band, this.work!.prepared!.files, this.directory, result.key, { check: this.check, progress: this.progress });
            const existingPost = await this.band.detectPublished();
            if (existingPost) { result.status = 'published'; result.postUrl = existingPost; await this.emit(); continue; }
            await this.band.write();
            const proof = (await this.band.observe()).photoProof;
            if (proof) j.bandPhotoVerification = { order: 'matched', ratio: proof.ratio, counts: proof.counts, sources: proof.sources, thumbnails: proof.thumbnails };
            const choice = this.directory.choices.find(b => b.key === result.key);
            j.bandPhotoLimit = choice?.photoLimit ?? null; j.bandLimitObservedAt = choice?.observedAt ?? undefined;
            if (j.mode === 'draft') {
              await this.band.stopBeforePost(); result.status = 'stopped_before_post';
              await this.capture(true, 'before-post');
              j.status = 'stopped_before_post'; j.secondsLeft = 0; j.message = '게시 전 멈춤 · 밴드 화면에서 확인하고 게시하거나 버려 주세요.';
              await this.emit(); return;
            }
            result.postUrl = await this.band.publish(); result.status = 'published'; await this.emit();
          }
        }
        if (j.step === 7) await this.work!.cleanup();
        this.check(); if (!j.completedSteps.includes(j.step)) j.completedSteps.push(j.step);
        if (j.step === 7) {
          const results = j.targetResults!;
          j.status = results.some(t => t.status === 'failed') ? 'failed' : results.every(t => t.status === 'stopped') ? 'stopped' : results.some(t => t.status === 'published') ? 'published' : 'draft_saved';
          j.message = '채널별 결과를 등록 기록에 남겼습니다.'; j.secondsLeft = 0; await this.emit(); return;
        }
        j.step++; j.current = 0; delete j.secondsLeft; await this.emit();
      }
    } catch (error) { if (!this.abort.signal.aborted && !this.disposed) await this.fail(error); }
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
    const j = this.job!; const code = error instanceof Error ? error.message : 'BAND_FAILED';
    j.failureCode = safeFailureCode(error, 'CHANNEL_FAILED');
    const isBand = j.step === 6;
    const execution = isBand ? this.band : this.blog;
    const dialog = await execution?.dialog().catch(() => null);
    if (dialog) { j.status = 'dialog_paused'; j.dialog = dialog; j.service = isBand ? 'band' : 'naver'; j.message = '서비스 확인창에서 선택해 주세요.'; }
    else if (/^(BAND_LOGIN_LOST|BAND_LOGIN_UNCONFIRMED|LOGIN_OR_EDITOR_LOST)$/.test(code)) {
      j.status = 'login_paused'; j.service = isBand ? 'band' : 'naver'; j.message = '로그인 풀림으로 멈춤'; await execution?.show();
    } else if (code === 'BAND_RESTART_REQUIRED' || code === 'AUTO_RECOVER_CONSENT_REQUIRED') {
      j.status = 'recovery_paused'; j.message = '작성 중인 내용이 달라졌습니다. 버리고 같은 화면에서 처음부터 시작할지 선택해 주세요.';
    } else {
      const result = isBand ? this.result() : j.targetResults!.find(t => t.channel === 'blog');
      if (result && !['draft_saved', 'published'].includes(result.status)) { result.status = 'failed'; result.reason = j.failureCode; }
      if ([2, 3].includes(j.step)) for (const target of j.targetResults!) if (target.status === 'running') { target.status = 'failed'; target.reason = j.failureCode; }
      j.status = !isBand && [1, 4, 5].includes(j.step) && j.targets.some(t => t.channel === 'band') ? 'channel_paused' : 'failed';
      j.message = code === 'PHOTO_HOST_NOT_ALLOWED' ? '골투에서 제공하는 주소의 사진만 내려받을 수 있습니다.' : code === 'PHOTO_DOWNLOAD_FAILED' ? '사진을 내려받지 못했습니다. 연결을 확인해 주세요.' : code === 'BAND_PHOTO_LIMIT' ? '관측한 밴드 사진 한도를 넘었습니다. 내용을 넣지 않았습니다. 확인 화면에서 사진 수를 확인해 주세요.' : code.startsWith('BAND_READBACK_MISMATCH') || code === 'BAND_INPUT_MISMATCH' ? '다시 읽은 글자 또는 사진 순서가 달라 게시 전에 멈췄습니다.' : '이 채널의 작업을 마치지 못했습니다. 작성 중인 내용은 그대로 두었습니다.';
    }
    const choice = this.directory.choices.find(b => b.key === j.activeTargetKey);
    if (choice) { j.bandPhotoLimit = choice.photoLimit; j.bandLimitObservedAt = choice.observedAt ?? undefined; }
    if (!dialog) await this.capture(isBand, 'failure');
    if (!isBand) await this.services.blog?.recordFailure?.({ jobId: j.id, step: j.step, code: j.failureCode!, evidence: j.evidence ?? '' }).catch(() => {});
    await this.emit();
  }
  async stop() {
    if (!this.job || !['running', 'login_paused', 'recovery_paused', 'dialog_paused'].includes(this.job.status)) return;
    this.job.status = 'user_paused'; this.abort.abort(); await this.active; await this.emit();
  }
  async resume() {
    if (!this.job || !['user_paused', 'login_paused', 'failed'].includes(this.job.status) || this.job.completedSteps.includes(7)) throw new ApiError('conflict', '화면의 선택을 먼저 마쳐 주세요.');
    await this.active; this.abort = new AbortController(); await this.hideService(); this.job.status = 'running'; this.job.service = null; this.job.message = '';
    for (const result of this.job.targetResults ?? []) {
      const active = this.job.step <= 3 ? !(this.blogSkipped && result.channel === 'blog') : this.job.step <= 5 ? result.channel === 'blog' : result === this.result();
      if (active && result.status === 'failed') { result.status = 'running'; delete result.reason; }
    }
    await this.emit(); this.launch();
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
    this.job.status = 'user_paused';
    if (discard) { if (this.job.step === 6) this.band?.allowRestart(); else this.blog?.consentToDiscard(); await this.resume(); } else await this.emit();
  }
  async answerDialog(id: string, accept: boolean) {
    if (this.job?.status !== 'dialog_paused' || this.job.dialog?.id !== id) throw new ApiError('conflict', '확인창이 바뀌었습니다.');
    await (this.job.step === 6 ? this.band : this.blog)?.answerDialog(id, accept);
    if (!accept) this.band?.resetDiscard();
    delete this.job.dialog;
    if (this.discardPending) {
      this.job.status = 'stopped_before_post';
      if (accept) await this.discardBand(); else { this.discardPending = false; this.band?.resetDiscard(); await this.emit(); }
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
    if (!this.job || this.job.step !== 6 || !['stopped_before_post', 'failed', 'user_paused', 'recovery_paused'].includes(this.job.status) || !this.band) throw new ApiError('conflict', '버릴 작성기가 없습니다.');
    try {
      this.discardPending = true; await this.band.discard(); this.discardPending = false;
      this.result()!.status = 'stopped'; await this.nextBand();
    } catch (error) { await this.fail(error); }
  }
  private async nextBand() {
    await this.band?.hide(); this.bandIndex++; this.band = undefined;
    this.job!.status = 'user_paused'; this.job!.message = ''; await this.emit(); await this.resume();
  }
  async checkBandLogin() { try { await this.directory.guard(false); return 'confirmed' as const; } catch (error) { return error instanceof Error && error.message === 'BAND_LOGIN_LOST' ? 'expired' as const : 'unknown' as const; } }
  async checkLogin() { return this.blog?.surface ? loginState(this.blog.surface) : 'unknown' as const; }
  async showService(service: Service) { if (service === 'band') await this.directory.surface?.show(); else if (service === 'naver') await this.blog?.show(); }
  async hideService() { await this.directory.surface?.hide(); await this.blog?.hide(); }
  async showDraft(title: string) { if (this.job?.title !== title || !this.job.targetResults?.some(t => t.channel === 'blog' && t.status === 'draft_saved')) throw new ApiError('invalid', '이번 실행의 임시글만 열 수 있습니다.'); await this.blog?.show(); }
  dispose() { this.disposed = true; this.abort.abort(); void (this.active ?? Promise.resolve()).then(() => this.work?.cleanup()).catch(() => {}); }
}
