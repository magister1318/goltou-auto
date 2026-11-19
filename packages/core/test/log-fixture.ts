import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import { JobLogStore } from '../src/job-logs';
import { tracePayload } from '../src/post-trace-payload';
import { configureTrace, traceJob, type JobKind, type TraceProvider, type TraceStep } from '@goltou/surface/telemetry';

/** A durable boundary is written, then that boundary fails before any action. */
export function faultedLog(directory: string, failAt: TraceStep) {
  const store = new JobLogStore(path.join(directory, 'fault-logs')); let injected = false;
  const provider: TraceProvider = {
    current: () => store.current(), run: (job, work) => store.run(job, work), bind: work => store.bind(work),
    begin: (kind, site) => {
      const job = store.begin(kind, site);
      return { id: job.id, get decisionReason() { return job.decisionReason; }, end: (result, reason) => job.end(result, reason),
        line: (step, event, detail, duration) => { job.line(step, event, detail, duration); if (!injected && step === failAt && event === 'start') { injected = true; throw Error('LOG_WRITE_FAILED'); } } };
    },
  };
  configureTrace(provider); return { store, injected: () => injected, reset: () => configureTrace(undefined) };
}
export const runnerLogSteps = ['runner.ready', 'runner.download', 'runner.arrange', 'runner.blog_write', 'runner.blog_save', 'runner.band_write', 'runner.record'] as const;

export async function loggedFixture<T>(directory: string, kind: JobKind, work: () => Promise<T>, expectedSteps: string[], ownsRoot = false) {
  const store = new JobLogStore(path.join(directory, 'job-logs')); configureTrace(store);
  try {
    const result = ownsRoot ? await work() : await traceJob(kind, kind.startsWith('blog') ? 'naver' : 'band', work);
    const day = readdirSync(store.directory).find(name => /^\d{8}$/.test(name))!;
    const file = readdirSync(path.join(store.directory, day)).find(name => name.endsWith('.jsonl'))!;
    const lines = readFileSync(path.join(store.directory, day, file), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const terminal = lines.filter(line => line.step === 'terminal'); expect(terminal).toHaveLength(1); expect(terminal[0].result).toBe('succeeded');
    const starts = lines.filter(line => line.event === 'start' && expectedSteps.includes(line.step)).map(line => line.step);
    expect(starts).toEqual(expectedSteps);
    const channel = kind.startsWith('blog') ? 'blog' : 'band';
    const payload = tracePayload(store, terminal[0].jobId, 1, channel, store.identity('fixture'));
    return { result, lines, payload };
  } finally { configureTrace(undefined); }
}
