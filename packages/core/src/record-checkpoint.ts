import { ApiError } from '@goltou/api-client';
import type { Job } from './protocol';
import type { Checkpoint } from './runner';

/** Recording errors never pass through the site's failure/recovery path. */
export class RecordError extends Error {
  readonly code: string;
  constructor(error: unknown, privateText: string[] = []) {
    const code = error instanceof ApiError && ['auth', 'forbidden', 'invalid', 'not_found', 'conflict', 'server'].includes(error.code) ? error.code : 'server';
    const message = error instanceof ApiError ? error.message : '';
    // The API contract supplies a Korean sentence. Reject echoed payloads, URLs,
    // identifiers and credentials; arbitrary transport exceptions are never shown.
    const safe = message.length <= 200 && /[가-힣]/u.test(message) && /^[가-힣\s.,·!?()]+$/u.test(message)
      && !privateText.some(value => value.trim().length >= 2 && message.includes(value.trim()));
    super(safe ? message : '기록을 저장하지 못했습니다. 연결과 등록 기록을 확인해 주세요.');
    this.name = 'RecordError'; this.code = `RECORD_FAILED:${code}`;
  }
}

/** Retains the exact checkpoint, without replaying editor input on record retry. */
export class RecordingCheckpoint {
  private pending: Job | undefined;
  private retrying = false;
  constructor(private readonly checkpoint: Checkpoint, private readonly notify: (job: Job) => void) {}
  async emit(job: Job, retry = false) {
    // Waiting for an owner's choice is not engine work. Keep this clock in the
    // snapshot so a rebuilt screen also excludes the complete pause interval.
    if (job.status === 'running' && job.pausedAt !== undefined) {
      job.pausedMilliseconds = (job.pausedMilliseconds ?? 0) + Math.max(0, Date.now() - job.pausedAt);
      delete job.pausedAt;
    } else if (job.status !== 'running' && !['draft_saved', 'published', 'stopped'].includes(job.status)) {
      job.pausedAt ??= Date.now();
    }
    // A discard confirmation must stay answerable while a record is pending.
    if (this.pending && job.status === 'dialog_paused') { this.notify(structuredClone(job)); return; }
    const snapshot = structuredClone(job);
    if (snapshot.recordFailure) { delete snapshot.recordFailure; if (snapshot.failureCode?.startsWith('RECORD_FAILED:')) delete snapshot.failureCode; }
    try { await this.checkpoint(snapshot, retry); }
    catch (error) {
      const failure = error instanceof RecordError ? error : new RecordError(error, [job.title]);
      this.pending = snapshot;
      job.recordFailure = { status: snapshot.status, message: failure.message };
      job.status = 'record_failed'; job.failureCode = failure.code; job.message = '기록하지 못함';
      this.notify(structuredClone(job));
      throw failure;
    }
    this.pending = undefined;
    if (job.recordFailure) { delete job.recordFailure; if (job.failureCode?.startsWith('RECORD_FAILED:')) delete job.failureCode; }
    this.notify(structuredClone(job));
  }
  async retry(job: Job) {
    if (!this.pending || job.status !== 'record_failed' || this.retrying) throw new ApiError('conflict', '다시 시도할 기록이 없습니다.');
    this.retrying = true;
    const snapshot = structuredClone(this.pending);
    try {
      await this.emit(snapshot, true);
      delete job.recordFailure; delete job.failureCode;
      Object.assign(job, snapshot);
      if (snapshot.status === 'running') { job.status = 'user_paused'; job.message = '기록을 저장했습니다. 이어하기를 눌러 주세요.'; }
      this.notify(structuredClone(job));
    } catch (error) {
      if (!(error instanceof RecordError)) throw error;
      Object.assign(job, snapshot);
    } finally { this.retrying = false; }
  }
}
