import type { BlogProgress } from '@goltou/sites';
import type { Job } from './protocol';

/** Upload samples exclude text input, download, pauses and draft readback. */
export function updateInputProgress(job: Job, value: BlogProgress): void {
  if (value.ownRecoveryDiscarded) job.ownRecoveryDiscarded = true;
  if (value.activity) {
    if (value.activity.stage === 'submit' && value.activity.submission === 'publish') job.publicationUncertain = true;
    const activity = { ...value.activity, at: Date.now() };
    job.activity = activity;
    job.activityLog ??= [];
    // One boundary per plan item. Long Band paragraphs report their completed
    // prefix repeatedly; retaining each copy would grow every snapshot quadratically.
    const previous = job.activityLog.findIndex(e => e.channel === activity.channel && e.stage === activity.stage && e.phase === activity.phase && e.blockIndex === activity.blockIndex && e.photoIndex === activity.photoIndex && e.verification === activity.verification);
    if (previous < 0) job.activityLog.push(activity);
    else if (activity.phase !== 'finish') job.activityLog[previous] = activity;
  }
  job.current = value.photos; job.total = value.totalPhotos;
  job.characters = value.characters; job.totalCharacters = value.totalCharacters;
  if (value.photoUploadMilliseconds === undefined) delete job.photoUploadMilliseconds;
  else job.photoUploadMilliseconds = value.photoUploadMilliseconds;
  if (value.photoUploadSamples === undefined) delete job.photoUploadSamples;
  else job.photoUploadSamples = value.photoUploadSamples;
  delete job.secondsLeft;
  if ((value.photoUploadSamples ?? 0) >= 3 && Number.isFinite(value.photoUploadMilliseconds)) {
    const perPhoto = value.photoUploadMilliseconds! / value.photoUploadSamples! / 1000;
    job.secondsLeft = Math.ceil(Math.max(0, value.totalPhotos - value.photos) * perPhoto + Math.max(0, value.totalCharacters - value.characters) * 0.06);
  }
  job.message = `사진 ${value.photos}/${value.totalPhotos} · 글자 ${Math.min(100, Math.round(value.characters / Math.max(1, value.totalCharacters) * 100))}%`;
}
