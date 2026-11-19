import type { Channel, PostTrace, PostTraceKind, PostTraceResult } from '@goltou/api-client';
import type { TraceDetail } from '@goltou/surface/telemetry';
import type { JobLogStore, UploadLogLine } from './job-logs';

export const traceLogLimit = 512 * 1024;
const summaryLimit = 64 * 1024;
const sourceSteps = {
  'band.photo.detail_api': 'api', 'band.photo.cached_feed': 'cached_feed',
  'band.photo.recovery_feed': 'recovery_feed', 'band.photo.detail_dom': 'dom',
} as const;
export function postTraceKind(kind: string): PostTraceKind | undefined {
  switch (kind) {
    case 'blog_draft': case 'blog_publish': case 'band_post': case 'blog_delete': case 'band_delete': case 'record': return kind;
  }
}

function ordinary(line: UploadLogLine) {
  return !line.check && !line.choice && line.event !== 'fail' && line.event !== 'decision' &&
    (/^(?:cdp|native|barrier|poll|input\.progress|surface\.cdp\.)/.test(line.step) ||
      line.step === 'sites.dom.waitFor' && line.selector === 'BAND_UPLOAD_SLOTS');
}

function compactLog(lines: UploadLogLine[], limit: number) {
  const entries = lines.map(line => {
    const json = JSON.stringify(line) + '\n';
    return { line, json, bytes: Buffer.byteLength(json), keep: true };
  });
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  let droppedLines = 0;
  const drop = (entry: typeof entries[number]) => {
    entry.keep = false;
    bytes -= entry.bytes;
    droppedLines++;
  };
  if (bytes > limit) {
    // Group repeated transport/polls first, preserving the first elapsed time and the last observation.
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) if (ordinary(entry.line)) {
      const { t: _t, duration: _duration, counts: _counts, ...key } = entry.line;
      const id = JSON.stringify({ ...key, ...(entry.line.network && entry.line.counts?.status !== undefined ? { status: entry.line.counts.status } : {}) });
      const group = groups.get(id);
      if (group) group.push(entry); else groups.set(id, [entry]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const first = group[0]!;
      const last = group.at(-1)!.line;
      const json = JSON.stringify({ ...first.line, count: group.length, lastT: last.t,
        lastCounts: last.counts, duration: group.reduce((sum, entry) => sum + entry.line.duration, 0) }) + '\n';
      const size = Buffer.byteLength(json);
      bytes += size - first.bytes;
      first.bytes = size; first.json = json;
      for (const entry of group.slice(1)) drop(entry);
    }
    for (const entry of entries) {
      if (bytes <= limit) break;
      if (entry.keep && ordinary(entry.line)) drop(entry);
    }
    // Keep decisions, failures and comparisons ahead of ordinary progress; prefer the final observations.
    for (const entry of entries) {
      if (bytes <= limit) break;
      if (entry.keep && !entry.line.check && entry.line.event !== 'decision' && entry.line.event !== 'fail' &&
          entry.line.step !== 'job' && entry.line.step !== 'terminal') drop(entry);
    }
    // A job can produce more protected rows than the contract permits. Keep the latest
    // copy of repeated evidence before dropping older distinct evidence as a last resort.
    const seen = new Set<string>();
    for (const entry of [...entries].reverse()) {
      if (bytes <= limit) break;
      if (!entry.keep) continue;
      const { t: _t, duration: _duration, ...key } = entry.line;
      const id = JSON.stringify(key);
      if (seen.has(id)) drop(entry); else seen.add(id);
    }
    for (const entry of entries) {
      if (bytes <= limit) break;
      if (entry.keep && entry.line.step !== 'terminal') drop(entry);
    }
    for (const entry of entries) {
      if (bytes <= limit) break;
      if (entry.keep) drop(entry);
    }
  }
  return { log: entries.filter(entry => entry.keep).map(entry => entry.json).join(''), truncated: droppedLines > 0, droppedLines };
}

function summarize(lines: UploadLogLine[]) {
  type Check = NonNullable<TraceDetail['check']>;
  const checks = new Map<Check, { check: Check; expected: number | null; observed: number | null; result: 'ok' | 'fail'; reason: string }>();
  const attempts: { source: NonNullable<TraceDetail['photoSource']>; result: 'ok' | 'fail' | 'skip'; reason: string }[] = [];
  const timings = new Map<UploadLogLine['step'], number>();
  let used: NonNullable<TraceDetail['photoSource']> | null = null;
  let lastStep: UploadLogLine['step'] = 'job';
  for (const line of lines) {
    if (line.step !== 'terminal' && line.step !== 'runner.log_upload') lastStep = line.step;
    if (line.check && (line.event === 'ok' || line.event === 'fail')) {
      checks.set(line.check, { check: line.check, expected: line.counts?.expected ?? null, observed: line.counts?.observed ?? null,
        result: line.event, reason: line.reason ?? '' });
    }
    if (line.step === 'band.photo.selected' && line.photoSource) used = line.photoSource;
    const source = sourceSteps[line.step as keyof typeof sourceSteps];
    if (source && (line.event === 'ok' || line.event === 'fail' || line.event === 'skip')) {
      attempts.push({ source, result: line.event, reason: line.reason ?? '' });
    }
    if (line.duration > 0 && (line.event === 'ok' || line.event === 'fail') && line.step !== 'terminal' && line.step !== 'verification')
      timings.set(line.step, (timings.get(line.step) ?? 0) + line.duration);
  }
  return { lastStep, checks: [...checks.values()], photos: { used, attempts: attempts.slice(-128) },
    timings: [...timings].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([step, milliseconds]) => ({ step, milliseconds })) };
}

export function tracePayload(store: JobLogStore, jobId: string, postNo: number, channel: Channel, targetHash: string, limit = traceLogLimit): PostTrace | undefined {
  const data = store.readTrace(jobId);
  const kind = data && postTraceKind(data.kind);
  if (!data || !kind) return;
  const phase = data.endedAt === null ? 'partial' : 'final';
  const reason = data.last === 'succeeded' || phase === 'partial' ? '' : data.reason ?? '';
  const result: PostTraceResult = phase === 'partial' ? 'running' : reason === 'USER_STOPPED' ? 'stopped'
    : reason === 'INTERRUPTED' || data.last === 'uncertain' ? 'incomplete'
    : data.last === 'succeeded' ? 'success' : data.last === 'failed' ? 'failed'
    : ['USER_DIALOG_REQUIRED', 'LOGIN_REQUIRED', 'BAND_LOGIN_LOST', 'BAND_LOGIN_UNCONFIRMED', 'LOGIN_OR_EDITOR_LOST', 'BAND_RESTART_REQUIRED', 'AUTO_RECOVER_CONSENT_REQUIRED'].includes(reason) ? 'paused' : 'stopped';
  const summary = { kind, channel, targetHash, appVersion: data.appVersion, result, reason, ...summarize(data.lines) };
  while (Buffer.byteLength(JSON.stringify(summary)) > summaryLimit && summary.photos.attempts.length) summary.photos.attempts.shift();
  return { postNo, jobId, kind, channel, phase, appVersion: data.appVersion, device: data.device,
    startedAt: new Date(data.at).toISOString(), endedAt: data.endedAt === null ? null : new Date(data.endedAt).toISOString(),
    result, reason, summary, ...compactLog(data.lines, limit) };
}
