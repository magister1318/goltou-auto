import { trace, type ReasonCode, type TraceDetail } from '@goltou/surface/telemetry';
import { sleep } from './dom';

export interface ReadbackClass {
  check: NonNullable<TraceDetail['check']>;
  reason: ReasonCode;
  expected: number;
  observed: number;
  present: boolean;
}
/** Presence gates settling, not correctness. Exact content is compared by the
 * caller only after two consecutive identical LIVE snapshots. At the deadline
 * return the final snapshot and its stability proof without comparing content.
 * Never settle early on a stable but incomplete page. No service writes. */
export async function settledReadback<T>(options: {
  read(): Promise<T | null>;
  classes(value: T | null): ReadbackClass[];
  check(): void;
  timeoutMs: number;
  intervalMs?: number;
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
}): Promise<{ value: T | null; stable: boolean; classes: ReadbackClass[] }> {
  const now = options.now ?? Date.now, pause = options.pause ?? sleep;
  const started = now(); let previous: string | undefined;
  for (;;) {
    options.check();
    const value = await options.read();
    options.check();
    const classes = options.classes(value), signature = JSON.stringify(value);
    const stable = value !== null && signature === previous;
    const elapsed = now() - started;
    const done = stable && classes.every(item => item.present);
    for (const item of classes) trace('verification', done ? 'ok' : 'wait', {
      check: item.check, reason: item.reason,
      counts: { expected: item.expected, observed: item.observed },
    }, elapsed);
    trace('verification',done?'ok':'wait',{check:'stability',reason:'READBACK_STABILITY',counts:{expected:2,observed:stable?2:1}},elapsed);
    if (done) return { value, stable, classes };
    if (elapsed >= options.timeoutMs) {
      for (const item of classes) if (!item.present) trace('verification', 'fail', {
        check: item.check, reason: item.reason, counts: { expected: item.expected, observed: item.observed },
      });
      if (!stable) trace('verification', 'fail', {
        check: 'stability', reason: 'READBACK_STABILITY', counts: { expected: 2, observed: value === null ? 0 : 1 },
      });
      return { value, stable, classes };
    }
    previous = signature;
    await pause(Math.min(options.intervalMs ?? 750, Math.max(0, options.timeoutMs - (now() - started))));
  }
}
