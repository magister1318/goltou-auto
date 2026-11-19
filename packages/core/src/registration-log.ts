import { beginTrace, inTrace, reasonCode, type TraceJob } from '@goltou/surface/telemetry';
import type { Job, JobInput } from './protocol';

export function registrationLog(input: Pick<JobInput, 'targets' | 'mode'>) {
  const band = input.targets[0]?.channel === 'band';
  return beginTrace(band ? 'band_post' : input.mode === 'draft' ? 'blog_draft' : 'blog_publish', band ? 'band' : 'naver');
}
/** One terminal per execution attempt. Explicit resume creates a new attempt. */
export async function registrationAttempt(log: TraceJob | undefined, work: () => Promise<void>, state: () => Job | null) {
  return inTrace(log, async () => {
    try { await work(); }
    catch (error) { log?.end('failed', reasonCode(error)); throw error; }
    finally {
      const job = state();
      if (!job) log?.end('failed', 'NOT_STARTED');
      else if (job.publicationUncertain || job.status === 'draft_unverified') log?.end('uncertain', reasonCode(job.failureCode ?? 'UNCERTAIN'));
      else if (job.targetResults?.some(target => target.readbackNotes?.length)) {
        const target = job.targetResults.find(result => result.readbackNotes?.length);
        log?.end('uncertain', reasonCode(target?.reason ?? 'PUBLISHED_READBACK_INCOMPLETE'));
      }
      else if (['published', 'draft_saved'].includes(job.status)) log?.end('succeeded');
      else if (['failed', 'record_failed', 'channel_paused'].includes(job.status)) log?.end('failed', job.status === 'record_failed' ? 'RECORD_FAILED' : reasonCode(job.failureCode));
      else if (job.status === 'login_paused') log?.end('stopped', 'LOGIN_REQUIRED');
      else if (job.status === 'dialog_paused') log?.end('stopped', 'USER_DIALOG_REQUIRED');
      else if (job.status === 'recovery_paused') log?.end('stopped', reasonCode(job.failureCode ?? 'AUTO_RECOVER_CONSENT_REQUIRED'));
      else log?.end('stopped', job.status === 'stopped_before_post' ? 'STOPPED_BEFORE_POST' : job.status === 'user_paused' ? 'USER_STOPPED' : reasonCode(job.failureCode ?? 'NOT_STARTED'));
    }
  });
}
