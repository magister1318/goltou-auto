import { traceSteps, traceReasons, traceSelectors } from './telemetry-catalog';

export type JobKind = 'blog_draft' | 'blog_publish' | 'blog_delete' | 'unfinished_cleanup' | 'band_post' | 'band_delete' | 'login_check' | 'band_list';
export type LogSite = 'naver' | 'band' | 'app';
export type TraceStep = typeof traceSteps[number];
export type ReasonCode = typeof traceReasons[number];
export type TraceEvent = 'start' | 'ok' | 'fail' | 'retry' | 'skip' | 'wait' | 'blocked_expected';
/** Classify only known collection routes, never a generic unknown/service request. */
export function expectedTelemetryRequest(request: Pick<import('./index').GuardedRequest, 'url' | 'method'>) {
  try {
    const u = new URL(request.url);
    return request.method === 'POST' && u.protocol === 'https:' &&
      (u.hostname === 'nlog.band.us' && u.pathname === '/event' ||
       /(?:^|\.)google-analytics\.com$/.test(u.hostname) && /^\/(?:g\/)?collect$/.test(u.pathname) ||
       /(?:^|\.)ingest(?:\.us)?\.sentry\.io$/.test(u.hostname) && /^\/api\/\d+\/envelope\/$/.test(u.pathname));
  } catch { return false; }
}
export type JobResult = 'succeeded' | 'failed' | 'stopped' | 'uncertain';
export interface TraceCounts {
  step?: number; paragraphIndex?: number; paragraphTotal?: number; photoIndex?: number; photoTotal?: number;
  bytes?: number; runs?: number; attempt?: number; expected?: number; observed?: number; status?: number;
  rows?: number; columns?: number; cells?: number;
  lineBreaks?: number; hashtags?: number; links?: number;
}
export interface TraceDetail {
  reason?: ReasonCode; counts?: TraceCounts;
  check?: 'table' | 'title' | 'paragraphs' | 'prices' | 'departures' | 'golf_courses' | 'text' | 'photos' | 'photo_order' | 'photo_ratio' | 'links' | 'hashtags' | 'line_breaks' | 'identity' | 'focus' | 'record' | 'alert_kind' | 'delete_notice' | 'same_post' | 'missing_read' | 'feed_location' | 'bold' | 'visibility' | 'stability';
  dialog?: 'alert' | 'confirm';
  selector?: typeof traceSelectors[number];
  operation?: typeof traceOperations[number];
  network?: { method: 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'other'; host: string; path: string;
    contentType: string; queryFields: readonly string[]; bodyFields: readonly string[]; decision: 'allowed' | 'blocked' };
  navigation?: { host: string; path: string };
}
export const traceOperations = ['surface.create', 'surface.destroy', 'surface.dialog', 'surface.dialog.answer', 'surface.visible', 'surface.navigation', 'profile.clear', 'app.inputState', 'app.jobState', 'logs.export', 'logs.environment', 'session.read', 'session.write', 'session.device', 'Page.navigate', 'Page.enable', 'Runtime.evaluate', 'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'DOM.setFileInputFiles', 'Fetch.continueRequest', 'Fetch.failRequest', 'Fetch.getResponseBody', 'Network.getRequestPostData', 'other'] as const;
/** Ephemeral request metadata goes through a bounded name-only projection first. */
export function requestTrace(request: import('./index').GuardedRequest, allowed: boolean): TraceDetail {
  let host = '', path = '', queryFields: string[] = [], bodyFields: string[] = [];
  try { const u = new URL(request.url); host = u.hostname; path = u.pathname; queryFields = [...u.searchParams.keys()]; } catch { /* No raw URL on malformed requests. */ }
  const contentType = (request.contentType ?? '').split(';')[0] ?? '';
  try {
    if (request.postDataComplete && request.postData) {
      if (contentType === 'application/x-www-form-urlencoded') bodyFields = [...new URLSearchParams(request.postData).keys()];
      else if (contentType === 'application/json') { const value: unknown = JSON.parse(request.postData); if (value && typeof value === 'object' && !Array.isArray(value)) bodyFields = Object.keys(value); }
      else if (contentType === 'multipart/form-data') bodyFields = [...request.postData.matchAll(/content-disposition:[^\r\n]*\bname="([^"]+)"/gi)].map(match => match[1]!);
    }
  } catch { /* No body on parse failures. */ }
  return { network: { method: request.method as NonNullable<TraceDetail['network']>['method'], host, path, contentType, queryFields, bodyFields, decision: allowed ? 'allowed' : 'blocked' } };
}
export interface TraceJob {
  readonly id: string;
  readonly decisionReason: ReasonCode | undefined;
  line(step: TraceStep, event: TraceEvent, detail?: TraceDetail, duration?: number): void;
  end(result: JobResult, reason?: ReasonCode): void;
}
export interface TraceProvider {
  begin(kind: JobKind, site: LogSite): TraceJob;
  current(): TraceJob | undefined;
  run<T>(job: TraceJob, work: () => T): T;
  bind<T extends (...args: never[]) => unknown>(work: T): T;
}
let provider: TraceProvider | undefined;
export function configureTrace(value: TraceProvider | undefined) { provider = value; }
export function currentTrace() { return provider?.current(); }
export function beginTrace(kind: JobKind, site: LogSite) { return provider?.begin(kind, site); }
export function inTrace<T>(job: TraceJob | undefined, work: () => T): T { return job && provider ? provider.run(job, work) : work(); }
export function bindTrace<T extends (...args: never[]) => unknown>(work: T): T { return provider?.bind(work) ?? work; }
export function reasonCode(value: unknown): ReasonCode {
  const code = value instanceof Error ? value.message : value;
  if (typeof code === 'string' && code.startsWith('CDP_TIMEOUT ')) return 'OBSERVATION_TIMEOUT';
  if (typeof code === 'string' && code.startsWith('NATIVE_TIMEOUT ')) return 'OBSERVATION_TIMEOUT';
  if (typeof code === 'string' && code.startsWith('CONTROL_NOT_FOUND:')) return 'CONTROL_NOT_FOUND';
  if (typeof code === 'string' && /^(BAND_POST_BLOCKED|BAND_READBACK_MISMATCH|BLOG_READBACK_MISMATCH|BLOG_FORMATTING_[A-Z_]+|RECORD_FAILED):/.test(code)) {
    const [prefix, suffix] = code.split(':');
    if (prefix === 'BAND_POST_BLOCKED' && traceReasons.includes(suffix as ReasonCode)) return suffix as ReasonCode;
    if (prefix === 'RECORD_FAILED') return 'RECORD_FAILED';
    return 'VERIFICATION_MISMATCH';
  }
  return traceReasons.includes(code as ReasonCode) ? code as ReasonCode : 'UNEXPECTED_FAILURE';
}
export function trace(step: TraceStep, event: TraceEvent, detail?: TraceDetail, duration?: number) { provider?.current()?.line(step, event, detail, duration); }
export async function traceStep<T>(step: TraceStep, work: () => Promise<T>): Promise<T> {
  const started = Date.now(); trace(step, 'start');
  try { const result = await work(); trace(step, 'ok', undefined, Date.now() - started); return result; }
  catch (error) { const control = error && typeof error === 'object' && 'control' in error ? error.control : undefined; const selector = traceSelectors.find(value => value === control); trace(step, 'fail', { reason: reasonCode(error), ...(selector ? { selector } : {}) }, Date.now() - started); throw error; }
}
export async function traceJob<T>(kind: JobKind, site: LogSite, work: () => Promise<T>, result?: (value: T) => { result: JobResult; reason?: ReasonCode }): Promise<T> {
  const job = beginTrace(kind, site);
  return inTrace(job, async () => {
    try { const value = await work(); const end = result?.(value); job?.end(end?.result ?? 'succeeded', end?.reason); return value; }
    catch (error) { job?.end('failed', reasonCode(error)); throw error; }
  });
}
