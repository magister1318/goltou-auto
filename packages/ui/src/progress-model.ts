import type { Job } from '@goltou/core/protocol';
import type { InputPlan } from '@goltou/core';

export const finite = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? value! : fallback;
export const activeNow = (job: Job, now: number) => Math.min(now, job.pausedAt ?? now) - finite(job.pausedMilliseconds);
export function photoDuration(job: Job) {
  return finite(job.photoUploadMilliseconds) > 0 && finite(job.photoUploadSamples) > 0
    ? Math.max(300, job.photoUploadMilliseconds! / job.photoUploadSamples!) : 4500;
}
export function textOf(step: InputPlan['steps'][number]) {
  return step.kind === 'text' ? step.text : step.kind === 'table' ? step.rows.map(row => row.join(' | ')).join('\n') : '';
}
export function animatedFraction(event: NonNullable<Job['activity']>, now: number, duration = 3000) {
  const observed = Math.max(0, Math.min(1, finite(event.fraction)));
  return event.phase === 'finish' ? 1 : Math.min(.94, observed + (1 - observed) * .85 * (1 - Math.exp(-Math.max(0, now - event.at) / duration)));
}
// The budgets reserve space for saving and reopening. Within writing, text
// length and individual measured photo times determine the share of real work.
export function writingWork(job: Job, now: number, plan?: InputPlan) {
  const a = job.activity;
  const log = job.activityLog?.filter(e => e.channel === a?.channel) ?? [];
  let total = 0, complete = 0, photoStart = 0;
  for (const [index, step] of (plan?.steps ?? []).entries()) {
    if (step.kind === 'break') continue;
    if (step.kind === 'photos') {
      for (let n = 0; n < step.urls.length; n++) {
        const photoIndex = photoStart + n;
        const done = log.some(e => e.stage === 'write' && e.blockKind === 'photos' && e.photoIndex === photoIndex && e.phase === 'finish');
        const current = a?.stage === 'write' && a.blockKind === 'photos' && a.photoIndex === photoIndex;
        const weight = photoDuration(job) / 1000;
        total += weight; complete += weight * (done ? 1 : current ? animatedFraction(a, now, photoDuration(job)) : 0);
      }
      photoStart += step.urls.length;
    } else {
      const done = log.some(e => e.stage === 'write' && e.blockIndex === index && e.phase === 'finish');
      const current = a?.stage === 'write' && a.blockIndex === index;
      const weight = .4 + Array.from(textOf(step)).length * .06;
      total += weight; complete += weight * (done ? 1 : current ? animatedFraction(a, now, weight * 1000) : 0);
    }
  }
  const fallback = ((a?.blockIndex ?? 0) + (a ? animatedFraction(a, now) : 0)) / Math.max(1, a?.blockTotal ?? 1);
  return { fraction: total ? complete / total : fallback, remaining: Math.max(0, total - complete) };
}
export function progressFraction(job: Job, now: number, previous = 0, plan?: InputPlan) {
  const a = job.activity;
  const clock = activeNow(job, now);
  const age = Math.max(0, clock - finite(job.startedAt, clock));
  const stageAge = Math.max(0, now - finite(a?.at, now) - (job.pausedAt === undefined ? 0 : now - job.pausedAt));
  const creep = (duration: number) => 1 - Math.exp(-stageAge / duration);
  let local: number;
  if (job.step === 1 || (job.step === 6 && a?.stage === 'open')) {
    const start = a?.opening === 'empty' ? .04 : a?.opening === 'editor' ? .02 : .002;
    local = start + (.059 - start) * (1 - Math.exp(-age / 12000));
  } else if (job.step === 2) local = .06 + .025 * Math.min(.99, (job.current + .5 * creep(4000)) / Math.max(1, job.total));
  else if (job.step === 3) local = .085 + .014 * creep(2000);
  else if (job.step === 4 || job.step === 6 && a?.stage === 'write') local = .1 + .72 * writingWork(job, now, plan).fraction;
  else if (job.step === 7) local = .98 + .005 * creep(2500);
  else {
    const submitted = job.activityLog?.find(e => e.channel === a?.channel && e.stage === 'submit');
    const verified = new Set(job.activityLog?.filter(e => e.channel === a?.channel && e.stage === 'verify' && e.phase === 'finish').map(e => e.verification)).size;
    local = submitted ? .86 + .12 * (1 - Math.exp(-Math.max(0, (job.pausedAt ?? now) - submitted.at) / 12000)) : .82 + .04 * (verified / 5 + (1 - verified / 5) * .8 * creep(5000));
  }
  const channels = job.targets.some(t => t.channel === 'blog') && job.targets.some(t => t.channel === 'band') ? 2 : 1;
  const base = (job.step === 7 ? .98 : ((a?.channel === 'band' ? channels - 1 : 0) + local) / channels);
  return Math.max(finite(previous), Math.min(.985, finite(base)));
}
export function remainingSeconds(job: Job, now: number, plan?: InputPlan) {
  const a = job.activity;
  const work = writingWork(job, now, plan).remaining;
  if (job.step === 7) return 2;
  if (job.step === 5 || job.step === 6 && a?.stage !== 'write' && a?.stage !== 'open') return 5;
  return Math.max(5, Math.round((work + (job.step < 4 ? 8 : 0) + 18) / 5) * 5);
}
