import type { BlogProgress } from '@goltou/sites';
import type { ReadbackIssue } from '@goltou/sites';
export function verificationProgress(channel: 'blog' | 'band', issues: readonly ReadbackIssue[], last: BlogProgress, progress: (value: BlogProgress) => void) {
  const groups = { title: ['title'], body: ['text', 'cursor', 'input', 'href', 'links', 'table'], photos: ['photo', 'photos'], facts: ['number'], tags: ['hashtags'] } as const;
  for (const verification of Object.keys(groups) as (keyof typeof groups)[]) {
    progress({ ...last, activity: { channel, stage: 'verify', phase: 'start', verification } });
    if (issues.some(d => (groups[verification] as readonly string[]).includes(d.field))) return;
    progress({ ...last, activity: { channel, stage: 'verify', phase: 'finish', verification } });
  }
}
