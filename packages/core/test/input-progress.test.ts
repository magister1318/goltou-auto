import { expect, it } from 'vitest';
import type { Job } from '../src/protocol';
import { updateInputProgress } from '../src/input-progress';

it('waits for three completed upload samples and estimates from measured upload time, excluding pauses and readback', () => {
  const job = {} as Job;
  const progress = { characters: 40, totalCharacters: 140, photos: 2, totalPhotos: 36, photoUploadSamples: 2, photoUploadMilliseconds: 4000 };
  updateInputProgress(job, progress);
  expect(job.secondsLeft).toBeUndefined();
  updateInputProgress(job, { ...progress, photos: 3, photoUploadSamples: 3, photoUploadMilliseconds: 9000 });
  expect(job.secondsLeft).toBe(105); // 33 photos * 3 sec + 100 characters * 60 ms
  expect(job.message).toBe('사진 3/36 · 글자 29%');
  updateInputProgress(job, { ...progress, photos: 4, photoUploadSamples: 4, photoUploadMilliseconds: 10000 });
  expect(job.secondsLeft).toBe(86);
  updateInputProgress(job, { ...progress, photos: 36, characters: 143, photoUploadSamples: 36, photoUploadMilliseconds: 90000 });
  expect(job.secondsLeft).toBe(0);
  updateInputProgress(job, { characters: 0, totalCharacters: 140, photos: 0, totalPhotos: 36 });
  expect(job.secondsLeft).toBeUndefined();
});
