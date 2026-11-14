import type { BlogProgress } from '@goltou/sites';
import type { Verification } from './verify';
export function verificationProgress(channel: 'blog' | 'band', comparison: Verification, last: BlogProgress, progress: (value: BlogProgress) => void) {
  const groups = { title: ['title'], body: ['text', 'characters', 'paragraphs', 'paragraphCount'], photos: ['photos'], facts: ['prices', 'departures', 'golfCourses'], tags: ['text'] } as const;
  for (const verification of Object.keys(groups) as (keyof typeof groups)[]) {
    progress({ ...last, activity: { channel, stage: 'verify', phase: 'start', verification } });
    if (comparison.differences.some(d => (groups[verification] as readonly string[]).includes(d.field))) return;
    progress({ ...last, activity: { channel, stage: 'verify', phase: 'finish', verification } });
  }
}
