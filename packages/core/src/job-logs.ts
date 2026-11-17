import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { JobKind, JobResult, LogSite, ReasonCode, TraceDetail, TraceEvent, TraceJob, TraceProvider, TraceStep } from '@goltou/surface/telemetry';
import { reasonCode, traceOperations } from '@goltou/surface/telemetry';
import { traceSteps, traceSelectors } from '../../surface/src/telemetry-catalog';

const kinds: readonly JobKind[] = ['blog_draft', 'blog_publish', 'blog_delete', 'unfinished_cleanup', 'band_post', 'band_delete', 'login_check', 'band_list'];
const sites: readonly LogSite[] = ['naver', 'band', 'app'];
const events: readonly TraceEvent[] = ['start', 'ok', 'fail', 'retry', 'skip', 'wait', 'blocked_expected'];
const countKeys = ['rows', 'columns', 'cells', 'step', 'paragraphIndex', 'paragraphTotal', 'photoIndex', 'photoTotal', 'bytes', 'runs', 'attempt', 'expected', 'observed', 'status', 'lineBreaks', 'hashtags', 'links'] as const;
const hosts = ['band.us', 'www.band.us', 'api.band.us', 'api-kr.band.us', 'bapi-kr.band.us', 'up.band.us', 'blog.naver.com', 'm.blog.naver.com', 'nid.naver.com', '127.0.0.1'];
const fieldNames = ['version', 'ts', 'band_no', 'post_no', 'band_key', 'post_key', 'body', 'content', 'contents', 'text', 'photos', 'photo_list', 'file', 'fileList', 'attachment', 'attachments', 'data', 'requests', 'url', 'method', 'params', 'access_token', 'token', 'signature', 'key', 'blogId', 'logNo', 'title', 'tags', 'is_public', 'schedule', 'device_type', 'set_band_notice', 'set_major_band_notice', 'set_linked_band_notice', 'copiable_state', 'should_disable_comment', 'band_notice_unset_at', 'photo', 'purpose', 'format', 'locale', 'app_id', 'documentJson', 'documentModel', 'mediaResources', 'populationParams', 'productApiVersion', 'tokenId', 'cpage', 'categoryNo', 'parentCategoryNo', 'viewDate', 'sourceCode', 'currentPage'];
const fixedPaths = ['/RabbitAutoSaveWrite.naver', '/PostDelete.naver', '/v1.5.0/delete_post', '/v2.0.0/batch', '/v2.3.0/get_band_list', '/v2.0.2/create_post', '/v3/upload_photo', '/RabbitWrite.naver', '/RabbitUpdate.naver', '/RabbitTempPostWrite.naver', '/RabbitTempPostUpdate.naver', '/PostWriteForm.naver', '/PostView.naver', '/PostList.naver', '/', '/my/home', '/my', '/login'];
const safeHost = (value: string) => hosts.includes(value) ? value : '[other]';
const safePath = (value: string) => fixedPaths.includes(value) ? value : /^\/band\/\d+\/post\/\d+\/?$/.test(value) ? '/band/[id]/post/[id]' : /^\/band\/\d+(?:\/post)?\/?$/.test(value) ? '/band/[id]/post' : '[other]';
const safeFields = (value: readonly string[]) => Array.isArray(value) ? value.slice(0, 80).map(name => fieldNames.includes(name) ? name : '[other]') : [];
/** Reconstruct every field. Neither spread nor JSON.stringify of caller objects is permitted. */
export function sanitizeDetail(detail: TraceDetail = {}) {
  const out: Record<string, unknown> = {};
  if (detail.reason !== undefined) out.reason = reasonCode(detail.reason);
  if (detail.counts) {
    const counts: Record<string, number> = {};
    for (const key of countKeys) { const n = detail.counts[key]; if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER) counts[key] = n; }
    out.counts = counts;
  }
  if (['table', 'title', 'paragraphs', 'prices', 'departures', 'golf_courses', 'text', 'photos', 'photo_order', 'photo_ratio', 'links', 'hashtags', 'line_breaks', 'identity', 'focus', 'record', 'alert_kind', 'delete_notice', 'same_post', 'missing_read', 'feed_location', 'bold', 'visibility', 'stability'].includes(detail.check ?? '')) out.check = detail.check;
  if (['alert', 'confirm'].includes(detail.dialog ?? '')) out.dialog = detail.dialog;
  if (traceSelectors.includes(detail.selector as typeof traceSelectors[number])) out.selector = detail.selector;
  if (traceOperations.includes(detail.operation as typeof traceOperations[number])) out.operation = detail.operation;
  if (detail.navigation) out.navigation = { host: safeHost(detail.navigation.host), path: safePath(detail.navigation.path) };
  if (detail.network) {
    const n = detail.network;
    out.network = { method: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(n.method) ? n.method : 'other',
      host: safeHost(n.host), path: safePath(n.path), contentType: ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'].includes(n.contentType) ? n.contentType : '[other]',
      queryFields: safeFields(n.queryFields), bodyFields: safeFields(n.bodyFields), decision: n.decision === 'allowed' ? 'allowed' : 'blocked' };
  }
  return out;
}
export interface JobLogRow { jobId: string; at: number; kind: JobKind; site: LogSite; result: JobResult | 'running'; reason?: ReasonCode; failedStep?: TraceStep; recordHash?: string; recordHashes?: string[]; blockedExpected?: number; tableFallback?: boolean; }
interface StoredRow extends JobLogRow { file: string }
export interface LogEnvironment { appVersion?: string; commit?: string; webViewVersion?: string; deviceModel?: string }
const dayMs = 86400000;
function failedStep(step: TraceStep, counts?: TraceDetail['counts']): TraceStep {
  return step === 'job' && counts?.step ? (['runner.ready', 'runner.download', 'runner.arrange', 'runner.blog_write', 'runner.blog_save', 'runner.band_write', 'runner.record'] as const)[counts.step - 1] ?? step : step;
}
export class JobLogStore implements TraceProvider {
  private readonly context = new AsyncLocalStorage<TraceJob>();
  private rows: StoredRow[] = [];
  private salt: Buffer;
  private logBytes = 0;
  private environment: Record<string, string> = {};
  constructor(readonly directory: string, private readonly limits = { days: 30, bytes: 50 * 1024 * 1024 }, private readonly now = Date.now) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const saltFile = path.join(directory, '.salt');
    if (!existsSync(saltFile)) this.durable(saltFile, randomBytes(32), false);
    this.salt = readFileSync(saltFile);
    this.recover(); this.retain();
  }
  setEnvironment(value: LogEnvironment) {
    const clean: Record<string, string> = {};
    if (/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value.appVersion ?? '')) clean.appVersion = value.appVersion!;
    if (/^[a-f0-9]{7,40}$/.test(value.commit ?? '')) clean.commit = value.commit!;
    if (/^\d+(?:\.\d+){1,4}$/.test(value.webViewVersion ?? '')) clean.webViewVersion = value.webViewVersion!;
    if (/^(?:SM-[A-Z0-9]{3,12}|Pixel [0-9]{1,2}(?: Pro|a| XL)?|sdk_gphone64_arm64|emulator)$/.test(value.deviceModel ?? '')) clean.deviceModel = value.deviceModel!;
    this.environment = clean;
  }
  /** Correlation only. Raw identity never enters the record constructor. */
  identity(value: string) { return createHmac('sha256', this.salt).update(value).digest('hex').slice(0, 12); }
  current() { return this.context.getStore(); }
  run<T>(job: TraceJob, work: () => T) { return this.context.run(job, work); }
  bind<T extends (...args: never[]) => unknown>(work: T): T {
    const job = this.current();
    return (job ? (...args: never[]) => this.run(job, () => work(...args)) : work) as T;
  }
  private durable(file: string, value: string | Buffer, append = true) {
    const previous = !append && file.endsWith('.jsonl') && existsSync(file) ? statSync(file).size : 0;
    if (append) appendFileSync(file, value, { mode: 0o600 }); else writeFileSync(file, value, { mode: 0o600 });
    const fd = openSync(file, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
    if (file.endsWith('.jsonl')) this.logBytes += (typeof value === 'string' ? Buffer.byteLength(value) : value.length) - previous;
  }
  private index() {
    const temp = path.join(this.directory, 'index.tmp');
    this.durable(temp, JSON.stringify(this.rows), false); renameSync(temp, path.join(this.directory, 'index.json'));
  }
  list(): JobLogRow[] { return this.rows.slice().reverse().map(({ file: _file, ...row }) => ({ ...row })); }
  associate(recordIdentity: string) {
    const row = this.rows.find(item => item.jobId === this.current()?.id);
    if (row?.result === 'running') {
      const hash = this.identity(recordIdentity); if (row.recordHashes?.includes(hash)) return;
      row.recordHash = hash; row.recordHashes = [...(row.recordHashes ?? []), hash];
      this.durable(path.join(this.directory, row.file), JSON.stringify({ timestamp: this.now(), jobId: row.jobId, site: row.site, kind: row.kind, step: 'runner.record', event: 'ok', duration: 0, recordHash: hash }) + '\n'); this.index();
    }
  }
  forRecord(recordIdentity: string) { const hash = this.identity(recordIdentity); return this.list().find(row => row.recordHash === hash || row.recordHashes?.includes(hash)); }
  /** Proves one acknowledged create for this local record without retaining its URL. */
  creationProof(recordIdentity: string) {
    const hash = this.identity(recordIdentity);
    for (const row of [...this.rows].reverse()) {
      if (row.kind !== 'band_post' || row.result !== 'uncertain' || row.reason !== 'BAND_POST_UNCONFIRMED' || !(row.recordHash === hash || row.recordHashes?.includes(hash))) continue;
      const lines = readFileSync(path.join(this.directory, row.file), 'utf8').trim().split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const creates = lines.filter(line => line.step === 'barrier' && line.reason === 'CREATE_ALLOWED' && !line.network);
      const responses = lines.filter(line => line.step === 'barrier' && line.reason === 'BAND_PUBLISH_RESPONSE_OK');
      if (creates.length === 1 && responses.length === 1) return { startedAt: row.at, acknowledgedAt: responses[0].timestamp as number };
    }
    return undefined;
  }
  begin(kind: JobKind, site: LogSite): TraceJob {
    if (!kinds.includes(kind) || !sites.includes(site)) throw new Error('INVALID_LOG_JOB');
    const at = this.now(), id = randomUUID(), date = new Date(at).toISOString().slice(0, 10).replace(/-/g, '');
    const dir = path.join(this.directory, date); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const row: StoredRow = { at, jobId: id, kind, site, result: 'running', file: `${date}/${at}-${kind}-${id}.jsonl` };
    this.rows.push(row);
    let terminal = false;
    let decisionReason: ReasonCode | undefined;
    let submissionMayHaveStarted = kind === 'band_delete' || kind === 'blog_delete';
    const line = (step: TraceStep, event: TraceEvent, detail?: TraceDetail, duration = 0, end?: JobResult) => {
      if (terminal) return;
      if (!traceSteps.includes(step) || !events.includes(event)) throw new Error('INVALID_LOG_EVENT');
      const data = sanitizeDetail(detail);
      if (step === 'table_fallback' && event === 'ok') row.tableFallback = true;
      if (event === 'blocked_expected' && detail?.network?.decision === 'blocked') row.blockedExpected = (row.blockedExpected ?? 0) + 1;
      if (step.endsWith('.publish') && event === 'start' || detail?.reason === 'ARMED' || detail?.reason === 'CREATE_ALLOWED') submissionMayHaveStarted = true;
      if (event === 'fail' && !detail?.reason) data.reason = 'UNEXPECTED_FAILURE';
      if (step === 'barrier' && event === 'start') decisionReason = undefined;
      else if (['barrier', 'delete'].includes(step) && detail?.reason && !detail.network) decisionReason = reasonCode(detail.reason);
      if (event === 'fail' && step !== 'terminal') {
        row.failedStep = failedStep(step, detail?.counts);
        row.reason = reasonCode(detail?.reason);
      }
      const serialized = JSON.stringify({ timestamp: this.now(), jobId: id, site, kind, step, event,
        duration: Number.isFinite(duration) && duration >= 0 ? duration : 0, ...data,
        ...(step === 'job' && event === 'start' ? { environment: this.environment } : {}), ...(end ? { result: end } : {}) }) + '\n';
      const reserve = step === 'terminal' ? 0 : Math.min(1024, Math.floor(this.limits.bytes / 4));
      const incoming = Buffer.byteLength(serialized) + reserve;
      if (this.logBytes + incoming + Buffer.byteLength(JSON.stringify(this.rows)) + 32 > this.limits.bytes) this.retain(incoming);
      if (step !== 'terminal' && this.logBytes + incoming + Buffer.byteLength(JSON.stringify(this.rows)) + 32 > this.limits.bytes) {
        row.failedStep = step;
        line('terminal', 'fail', { reason: 'LOG_STORAGE_LIMIT' }, this.now() - at, submissionMayHaveStarted ? 'uncertain' : 'failed');
        throw Error('LOG_STORAGE_LIMIT');
      }
      this.durable(path.join(this.directory, row.file), serialized);
      if (end) { terminal = true; row.result = end; if (detail?.reason) row.reason = reasonCode(detail.reason); else if (event === 'fail') row.reason = 'UNEXPECTED_FAILURE'; else delete row.reason; this.index(); this.retain(); }
    };
    const job: TraceJob = { id, get decisionReason() { return decisionReason; }, line, end: (result, reason) => {
      if (!['succeeded', 'failed', 'stopped', 'uncertain'].includes(result)) throw new Error('INVALID_LOG_RESULT');
      line('terminal', result === 'succeeded' ? 'ok' : 'fail', reason ? { reason } : undefined, this.now() - at, result);
    } };
    line('job', 'start'); this.index(); return job;
  }
  private recover() {
    for (const date of readdirSync(this.directory).filter(n => /^\d{8}$/.test(n))) {
      for (const file of readdirSync(path.join(this.directory, date)).filter(n => /^\d+-[a-z_]+-[a-f0-9-]{36}\.jsonl$/.test(n))) {
        const absolute = path.join(this.directory, date, file);
        const raw = readFileSync(absolute);
        const lastNewline = raw.lastIndexOf(10);
        if (lastNewline !== raw.length - 1) truncateSync(absolute, lastNewline + 1);
        const lines = raw.subarray(0, lastNewline + 1).toString('utf8').trim().split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
        let first = lines[0], last = lines.at(-1);
        if (!first) {
          const match = /^(\d+)-([a-z_]+)-([a-f0-9-]{36})\.jsonl$/.exec(file);
          if (match && kinds.includes(match[2] as JobKind) && Number.isSafeInteger(Number(match[1]))) {
            const kind = match[2] as JobKind;
            first = { timestamp: Number(match[1]), jobId: match[3], kind, site: kind.startsWith('blog') ? 'naver' : kind.startsWith('band') ? 'band' : 'app', step: 'job', event: 'start', duration: 0 };
            this.durable(absolute, JSON.stringify(first) + '\n', false); lines.push(first); last = first;
          }
        }
        if (!first || !kinds.includes(first.kind) || !sites.includes(first.site) || !/^[a-f0-9-]{36}$/.test(first.jobId) || !Number.isFinite(first.timestamp)) continue;
        const failure = lines.filter(line => line.event === 'fail' && line.step !== 'terminal').at(-1);
        const row: StoredRow = { at: first.timestamp, jobId: first.jobId, kind: first.kind, site: first.site, file: `${date}/${file}`,
          ...(lines.some(line => line.event === 'blocked_expected' && line.network?.decision === 'blocked') ? { blockedExpected: lines.filter(line => line.event === 'blocked_expected' && line.network?.decision === 'blocked').length } : {}),
          ...(lines.some(line=>line.step==='table_fallback'&&line.event==='ok') ? {tableFallback:true} : {}),
          result: last?.step === 'terminal' && ['succeeded', 'failed', 'stopped', 'uncertain'].includes(last.result) ? last.result : 'stopped',
          ...(failure && traceSteps.includes(failure.step) ? { failedStep: failedStep(failure.step, failure.counts) } : {}) };
        const correlations = lines.filter(line => /^[a-f0-9]{12}$/.test(line.recordHash ?? '')); if (correlations.length) { row.recordHashes = [...new Set<string>(correlations.map(line => line.recordHash))]; row.recordHash = row.recordHashes[0]!; }
        if (last?.step !== 'terminal') {
          row.reason = 'INTERRUPTED'; row.failedStep ??= 'recovery';
          this.durable(absolute, JSON.stringify({ timestamp: this.now(), jobId: row.jobId, site: row.site, kind: row.kind, step: 'terminal', event: 'fail', duration: Math.max(0, this.now() - row.at), reason: 'INTERRUPTED', recovery: 'interrupted', result: 'stopped' }) + '\n');
        } else if (last.reason) row.reason = reasonCode(last.reason);
        this.rows.push(row);
      }
    }
    this.rows.sort((a, b) => a.at - b.at); this.index();
  }
  retain(incoming = 0) {
    let bytes = this.rows.reduce((sum, row) => sum + (existsSync(path.join(this.directory, row.file)) ? statSync(path.join(this.directory, row.file)).size : 0), 0);
    for (const row of [...this.rows]) {
      if (row.result === 'running' || row.at >= this.now() - this.limits.days * dayMs && bytes + incoming + Buffer.byteLength(JSON.stringify(this.rows)) + 32 <= this.limits.bytes) continue;
      const file = path.join(this.directory, row.file);
      if (existsSync(file)) { bytes -= statSync(file).size; unlinkSync(file); }
      this.rows = this.rows.filter(item => item !== row);
    }
    this.logBytes = bytes;
    this.index();
  }
}
