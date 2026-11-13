import { ApiError } from '@goltou/api-client';
import type { Job, JobInput, Simulation } from './protocol';
import type { PreparationWork } from './preparation';
export interface RegistrationRunner {
  readonly job: Job | null;
  start(input: JobInput, title: string, photos: number, preparation?: PreparationWork): Promise<void>;
  stop(): Promise<void>;
  resume(): Promise<void>;
  dispose(): void;
}
export type Checkpoint = (job: Job) => Promise<void>;
/** Site steps remain simulated. An injected preparation performs real media/body work. */
export class FakeRegistrationRunner implements RegistrationRunner {
  job: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private serial = 0;
  private photos = 5;
  private loginTriggered = false;
  private failureTriggered = false;
  private preparation: PreparationWork | undefined;
  private abort = new AbortController();
  private inFlight: Promise<void> | undefined;
  constructor(private readonly configuration: () => Simulation, private readonly checkpoint: Checkpoint, private readonly notify: (job: Job) => void) {}
  async start(input: JobInput, title: string, photos: number, preparation?: PreparationWork): Promise<void> {
    if (this.job && ['running', 'login_paused', 'user_paused', 'failed'].includes(this.job.status)) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
    this.photos = photos; this.loginTriggered = false; this.failureTriggered = false;
    this.preparation = preparation; this.abort = new AbortController();
    this.job = { id: ++this.serial, productNo: input.productNo, title, mode: input.mode, targets: input.targets, status: 'running', step: 1, current: 0, total: 1, completedSteps: [], service: null, message: '' };
    await this.publish(); this.schedule();
  }
  async stop(): Promise<void> {
    if (!this.job || !['running', 'login_paused'].includes(this.job.status)) return;
    clearTimeout(this.timer); this.job.status = 'user_paused'; this.abort.abort(); await this.inFlight; await this.publish();
  }
  async resume(): Promise<void> {
    if (!this.job || !['user_paused', 'login_paused', 'failed'].includes(this.job.status)) throw new ApiError('conflict', '이어 할 작업이 없습니다.');
    this.abort = new AbortController(); this.job.status = 'running'; this.job.service = null; this.job.message = ''; await this.publish(); this.schedule();
  }
  dispose(): void {
    clearTimeout(this.timer); this.abort.abort();
    void (this.inFlight ?? Promise.resolve()).then(() => this.preparation?.cleanup()).catch(() => {
      if (this.job) { this.job.status = 'failed'; this.job.message = 'PHOTO_CLEANUP_FAILED'; this.notify(structuredClone(this.job)); }
    });
  }
  private schedule(): void { clearTimeout(this.timer); this.timer = setTimeout(() => { this.inFlight = this.tick().finally(() => { this.inFlight = undefined; }); }, this.configuration().tickMs); }
  private async publish(): Promise<void> {
    if (!this.job) return;
    await this.checkpoint(structuredClone(this.job));
    this.notify(structuredClone(this.job));
  }
  private async tick(): Promise<void> {
    const job = this.job; if (!job || job.status !== 'running') return;
    try {
      const config = this.configuration();
      if (this.preparation && [2, 3].includes(job.step) && !job.completedSteps.includes(job.step)) {
        if (job.step === 2) {
          job.message = '사진 원본을 내려받는 중';
          await this.preparation.download(this.abort.signal, n => { job.current = n; this.notify(structuredClone(job)); });
        } else { job.message = '본문 블록과 원문을 대조하는 중'; await this.preparation.arrange(); }
        this.abort.signal.throwIfAborted(); job.current = job.total;
      }
      if (job.current >= Math.min(3, job.total) && config.loginAt === job.step && !this.loginTriggered) {
        this.loginTriggered = true; job.status = 'login_paused'; job.service = job.step >= 6 ? 'band' : 'naver'; await this.publish(); return;
      }
      if (job.current >= Math.min(2, job.total) && config.failAt === job.step && !this.failureTriggered) {
        this.failureTriggered = true; job.status = 'failed'; job.message = '사진 올리기 응답 없음 (가짜 실행)'; await this.publish(); return;
      }
      if (job.current < job.total) job.current++;
      else {
        job.completedSteps.push(job.step);
        if (job.step === 7) { await this.preparation?.cleanup(); job.status = job.mode === 'draft' ? 'draft_saved' : 'published'; }
        else { job.step++; job.current = 0; job.total = [2, 4].includes(job.step) ? this.photos : 1; job.message = job.step >= 4 ? '사이트 입력은 가짜 실행입니다.' : ''; }
      }
      await this.publish();
      if (job.status === 'running') this.schedule();
    } catch (error) {
      if (this.abort.signal.aborted) { if (job.step === 2) job.current = 0; return; }
      let message = error instanceof Error ? error.message : '기록 저장 실패';
      try { await this.preparation?.cleanup(); } catch { message = 'PHOTO_CLEANUP_FAILED'; }
      if ([2, 3].includes(job.step)) { job.step = 2; job.current = 0; job.total = this.photos; job.completedSteps = job.completedSteps.filter(n => n < 2); }
      job.status = 'failed'; job.message = message;
      try { await this.publish(); } catch { this.notify(structuredClone(job)); }
    }
  }
}
