import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError, type ApiClient, type Channel } from '@goltou/api-client';
import type { TraceJob } from '@goltou/surface/telemetry';
import type { JobLogStore, LogNotice } from './job-logs';
import { postTraceKind, tracePayload } from './post-trace-payload';

interface PendingTrace { jobId: string; postNo: number; channel: Channel; owner: string; targetHash: string; at: number }
const partialAfter = 3 * 60 * 1000;
const maxAge = 7 * 86400000;
const validHash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{12}$/.test(value);

export class PostTraceQueue {
  private readonly file: string;
  private pending: PendingTrace[];
  private readonly busy = new Set<string>();
  private readonly requested = new Set<string>();
  private readonly duePartial = new Set<string>();
  private readonly unsubscribe: () => void;

  constructor(private readonly logs: JobLogStore, private readonly api: ApiClient,
    private readonly session: () => Promise<{ userNo: number; token: string } | undefined>, private readonly now = Date.now) {
    this.file = path.join(logs.directory, 'post-traces.json');
    this.pending = this.load();
    this.unsubscribe = logs.subscribe(notice => this.onLog(notice));
  }
  dispose() { this.unsubscribe(); }

  track(log: TraceJob, postNo: number, channel: Channel, userNo: number, target: string) {
    const kind = this.logs.runningKind(log.id);
    if (!kind || !postTraceKind(kind) || !Number.isSafeInteger(postNo) || postNo < 1 || this.pending.some(entry => entry.jobId === log.id)) return;
    this.logs.run(log, () => this.logs.associate(String(postNo)));
    this.pending.push({ jobId: log.id, postNo, channel, owner: this.owner(userNo),
      targetHash: this.logs.identity(`target:${channel}:${target}`), at: this.now() });
    this.save();
  }
  private owner(userNo: number) { return this.logs.identity(`trace-owner:${userNo}`); }
  private load(): PendingTrace[] {
    try {
      const entries: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (Array.isArray(entries)) return entries.filter(entry => entry && typeof entry.jobId === 'string' &&
        /^[A-Za-z0-9_-]{1,64}$/.test(entry.jobId) && Number.isSafeInteger(entry.postNo) && entry.postNo > 0 &&
        ['blog', 'band'].includes(entry.channel) && validHash(entry.owner) && validHash(entry.targetHash) && Number.isSafeInteger(entry.at))
        .map(({ jobId, postNo, channel, owner, targetHash, at }) => ({ jobId, postNo, channel, owner, targetHash, at }));
    } catch { /* A missing or malformed index cannot authorize uploads. */ }
    return [];
  }
  private save() {
    this.pending = this.pending.filter(entry => entry.at >= this.now() - maxAge).slice(-20);
    const temp = this.file + '.tmp';
    writeFileSync(temp, JSON.stringify(this.pending), { mode: 0o600 });
    const fd = openSync(temp, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.file);
  }
  retry() {
    if (!this.pending.length) return;
    this.save();
    for (const entry of this.pending) this.schedule(entry, true);
  }
  private onLog({ jobId, checkpoint }: LogNotice) {
    const entry = this.pending.find(value => value.jobId === jobId);
    if (!entry) return;
    if (checkpoint) {
      if (this.now() - entry.at < partialAfter) return;
      this.duePartial.add(jobId);
    }
    this.schedule(entry);
  }
  private schedule(entry: PendingTrace, retry = false) {
    const { jobId } = entry;
    if (this.busy.has(jobId)) {
      if (!retry) this.requested.add(jobId);
      return;
    }
    this.busy.add(jobId);
    void this.send(entry, retry).catch(() => {
      try { this.logs.logUpload(jobId, 'fail', 'POST_LOG_UPLOAD_FAILED', 0); } catch { /* The diagnostic store can be unavailable. */ }
    }).finally(() => {
      this.busy.delete(jobId);
      if (this.requested.delete(jobId) && this.pending.includes(entry)) this.schedule(entry);
    });
  }
  private async send(entry: PendingTrace, retry: boolean) {
    const session = await this.session();
    const { jobId, postNo, channel, targetHash } = entry;
    if (!session || this.owner(session.userNo) !== entry.owner || !this.pending.includes(entry)) return;
    const data = tracePayload(this.logs, jobId, postNo, channel, targetHash);
    if (!data) { this.remove(entry); return; }
    if (data.phase === 'partial' && !this.duePartial.delete(jobId)) return;
    const bytes = Buffer.byteLength(data.log);
    if (retry) this.logs.logUpload(jobId, 'retry', 'POST_LOG_UPLOAD', bytes);
    try {
      try { await this.api.request('/auto/posts/trace', data, session.token); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'not_found') throw error;
        this.logs.logUpload(jobId, 'retry', 'POST_LOG_ROUTE_MISSING', bytes);
        await this.api.request('/auto/posts/log', { postNo, log: data.log }, session.token);
      }
    } catch {
      if (data.phase === 'partial') this.duePartial.add(jobId);
      this.logs.logUpload(jobId, 'fail', 'POST_LOG_UPLOAD_FAILED', bytes);
      return;
    }
    if (data.phase === 'final') this.remove(entry);
    this.logs.logUpload(jobId, 'ok', 'POST_LOG_UPLOAD', bytes);
  }
  private remove(entry: PendingTrace) {
    this.duePartial.delete(entry.jobId);
    this.pending = this.pending.filter(value => value !== entry);
    this.save();
  }
}
