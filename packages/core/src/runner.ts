import { ApiError } from '@goltou/api-client';
import type { Job, JobInput, Simulation } from './protocol';
export interface RegistrationRunner {
  readonly job: Job | null;
  start(input: JobInput, title: string, photos: number): Promise<void>;
  stop(): Promise<void>;
  resume(): Promise<void>;
  dispose(): void;
}
export type Checkpoint = (job: Job) => Promise<void>;
/** Deterministic, local-only runner. It never creates a Surface or performs I/O. */
export class FakeRegistrationRunner implements RegistrationRunner {
  job: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private serial = 0;
  private photos = 5;
  private loginTriggered = false;
  private failureTriggered = false;
  constructor(private readonly configuration: () => Simulation, private readonly checkpoint: Checkpoint, private readonly notify: (job: Job) => void) {}
  async start(input: JobInput, title: string, photos: number): Promise<void> {
    if (this.job && ['running', 'login_paused', 'user_paused', 'failed'].includes(this.job.status)) throw new ApiError('conflict', '진행하던 작업을 먼저 마쳐 주세요.');
    this.photos = photos; this.loginTriggered = false; this.failureTriggered = false;
    this.job = { id: ++this.serial, productNo: input.productNo, title, mode: input.mode, targets: input.targets, status: 'running', step: 1, current: 0, total: 1, completedSteps: [], service: null, message: '' };
    await this.publish(); this.schedule();
  }
  async stop(): Promise<void> {
    if (!this.job || !['running', 'login_paused'].includes(this.job.status)) return;
    clearTimeout(this.timer); this.job.status = 'user_paused'; await this.publish();
  }
  async resume(): Promise<void> {
    if (!this.job || !['user_paused', 'login_paused', 'failed'].includes(this.job.status)) throw new ApiError('conflict', '이어 할 작업이 없습니다.');
    this.job.status = 'running'; this.job.service = null; this.job.message = ''; await this.publish(); this.schedule();
  }
  dispose(): void { clearTimeout(this.timer); }
  private schedule(): void { clearTimeout(this.timer); this.timer = setTimeout(() => { void this.tick(); }, this.configuration().tickMs); }
  private async publish(): Promise<void> {
    if (!this.job) return;
    await this.checkpoint(structuredClone(this.job));
    this.notify(structuredClone(this.job));
  }
  private async tick(): Promise<void> {
    const job = this.job; if (!job || job.status !== 'running') return;
    try {
      const config = this.configuration();
      if (job.current >= Math.min(3, job.total) && config.loginAt === job.step && !this.loginTriggered) {
        this.loginTriggered = true; job.status = 'login_paused'; job.service = job.step >= 6 ? 'band' : 'naver'; await this.publish(); return;
      }
      if (job.current >= Math.min(2, job.total) && config.failAt === job.step && !this.failureTriggered) {
        this.failureTriggered = true; job.status = 'failed'; job.message = '사진 올리기 응답 없음 (가짜 실행)'; await this.publish(); return;
      }
      if (job.current < job.total) job.current++;
      else {
        job.completedSteps.push(job.step);
        if (job.step === 7) job.status = job.mode === 'draft' ? 'draft_saved' : 'published';
        else { job.step++; job.current = 0; job.total = [2, 4].includes(job.step) ? this.photos : 1; }
      }
      await this.publish();
      if (job.status === 'running') this.schedule();
    } catch (error) {
      job.status = 'failed'; job.message = error instanceof Error ? error.message : '기록 저장 실패'; this.notify(structuredClone(job));
    }
  }
}
