import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, createFakeApi, fakeAccounts, type ApiClient, type PostTrace } from '@goltou/api-client';
import { configureTrace, type TraceDetail } from '@goltou/surface/telemetry';
import { traceSteps } from '../../surface/src/telemetry-catalog';
import { AppCore, MemoryTokenStore } from '../src/app';
import { JobLogStore, sanitizeDetail } from '../src/job-logs';
import { type AppRequest, type Commands } from '../src/protocol';
import { tracePayload } from '../src/post-trace-payload';
import { PostTraceQueue } from '../src/post-trace-queue';

const cleanup: (() => void)[] = [];
afterEach(() => { configureTrace(undefined); for (const close of cleanup.splice(0).reverse()) close(); });
const token = 'synthetic-access-value';
const user = fakeAccounts.manager!;
const session = async () => ({ userNo: user.userNo, token });

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'goltou-post-trace-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  let now = Date.now();
  const time = () => now;
  const logs = new JobLogStore(directory, undefined, time);
  logs.setEnvironment({ appVersion: '1.1.3', deviceModel: 'Pixel 8' });
  configureTrace(logs);
  return { directory, logs, time, advance: (ms: number) => { now += ms; } };
}

function observingApi(handle?: (data: PostTrace) => void) {
  const fake = createFakeApi({ token, user });
  const calls: PostTrace[] = [], legacy: unknown[] = [];
  const api: ApiClient = { async request(route, input, key) {
    if (route === '/auto/posts/trace') {
      const data = input as PostTrace;
      calls.push(data); handle?.(data);
    }
    if (route === '/auto/posts/log') legacy.push(input);
    return fake.request(route, input, key);
  } };
  return { api, calls, legacy };
}

it.each(['success', 'failed', 'stopped'] as const)('uploads a final %s from the application', async result => {
  const { logs } = fixture();
  const { api, calls } = observingApi();
  const tokens = new MemoryTokenStore();
  await tokens.write(token);
  const app = new AppCore(api, tokens, undefined, undefined, { logs, device: vi.fn() });
  cleanup.push(() => app.dispose());
  await app.initialize();
  app.state.simulation = { tickMs: 1, failAt: result === 'failed' ? 1 : null, loginAt: null };
  const call = <K extends keyof Commands>(command: K, input: Commands[K]['input']) => app.handle({ type: 'app', id: 1, command, input } as AppRequest);
  await call('job.start', { productNo: 1234, targets: [{ channel: 'blog', key: 'synthetic-target', name: '합성 대상' }],
    mode: 'draft', options: { polish: false, linkCard: false } });
  if (result === 'stopped') await call('job.stop', {});
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toMatchObject({ phase: 'final', kind: 'blog_draft', channel: 'blog', result, appVersion: '1.1.3', device: 'Pixel 8',
    reason: result === 'success' ? '' : result === 'stopped' ? 'USER_STOPPED' : 'CHANNEL_FAILED',
    summary: { result, targetHash: expect.stringMatching(/^[a-f0-9]{12}$/) } });
  expect(JSON.stringify(calls)).not.toMatch(/synthetic-(?:target|access)/);
});

it('recovers an interrupted job on relaunch and retries failed uploads without crossing accounts', async () => {
  const f = fixture();
  let fail = true;
  const { api, calls, legacy } = observingApi(() => { if (fail) throw new ApiError('server', 'synthetic failure'); });
  const first = new PostTraceQueue(f.logs, api, session, f.time);
  const log = f.logs.begin('blog_draft', 'naver');
  first.track(log, 100, 'blog', user.userNo, 'fixture');
  log.line('verification', 'ok', { check: 'text', counts: { expected: 11, observed: 11 } });
  first.dispose();
  const logs = new JobLogStore(f.directory, undefined, f.time);
  let currentUser = user.userNo + 1;
  const retry = new PostTraceQueue(logs, api, async () => ({ userNo: currentUser, token }), f.time);
  cleanup.push(() => retry.dispose());
  retry.retry();
  await new Promise(resolve => setImmediate(resolve));
  expect(calls).toHaveLength(0);
  currentUser = user.userNo;
  retry.retry();
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toMatchObject({ jobId: log.id, phase: 'final', result: 'incomplete', reason: 'INTERRUPTED' });
  expect(legacy).toEqual([]);
  await vi.waitFor(() => expect(logs.readTrace(log.id)?.lines.at(-1)?.reason).toBe('POST_LOG_UPLOAD_FAILED'));
  retry.dispose();
  fail = false;
  const tokens = new MemoryTokenStore();
  await tokens.write(token);
  const app = new AppCore(api, tokens, undefined, undefined, { logs: new JobLogStore(f.directory), device: vi.fn() });
  cleanup.push(() => app.dispose());
  await app.initialize();
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]?.log).toContain('POST_LOG_UPLOAD_FAILED');
  await vi.waitFor(() => expect(JSON.parse(readFileSync(path.join(f.directory, 'post-traces.json'), 'utf8'))).toEqual([]));
  expect(new JobLogStore(f.directory, undefined, f.time).list()[0]).toMatchObject({ reason: 'INTERRUPTED', result: 'stopped' });
});

it('keeps a local record start failure when the server has never assigned a post number', async () => {
  const { logs } = fixture();
  const { api, calls } = observingApi();
  const unavailable: ApiClient = { request(route, input, key) {
    if (route === '/auto/posts/start') return Promise.reject(new ApiError('server', 'synthetic connection failure'));
    return api.request(route, input, key);
  } };
  const tokens = new MemoryTokenStore();
  await tokens.write(token);
  const app = new AppCore(unavailable, tokens, undefined, undefined, { logs, device: vi.fn() });
  cleanup.push(() => app.dispose());
  await app.initialize();
  await expect(app.handle({ type: 'app', id: 1, command: 'job.start', input: {
    productNo: 1234, targets: [{ channel: 'blog', key: 'synthetic-target', name: '합성 대상' }], mode: 'draft',
    options: { polish: false, linkCard: false },
  } })).rejects.toMatchObject({ code: 'server' });
  expect(logs.list()).toEqual([expect.objectContaining({ kind: 'record', result: 'failed', reason: 'POST_RECORD_START_FAILED' })]);
  expect(calls).toEqual([]);
});

it('starts partial uploads only at qualified milestones and serializes the final under the same ID', async () => {
  const f = fixture();
  const calls: PostTrace[] = [];
  let release: () => void = () => {};
  const queued = new Promise<void>(resolve => { release = resolve; });
  const api = { request: async (route: string, data: PostTrace) => {
    expect(route).toBe('/auto/posts/trace');
    calls.push(data);
    if (data.phase === 'partial') await queued;
    return {};
  } } as ApiClient;
  const queue = new PostTraceQueue(f.logs, api, session, f.time);
  cleanup.push(() => queue.dispose());
  const log = f.logs.begin('blog_draft', 'naver');
  queue.track(log, 100, 'blog', user.userNo, 'fixture');
  log.line('job.checkpoint', 'ok', { checkpoint: 'photos_uploaded' });
  await new Promise(resolve => setImmediate(resolve));
  expect(calls).toHaveLength(0);
  f.advance(180001);
  log.line('job.checkpoint', 'ok', { checkpoint: 'before_submit' });
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toMatchObject({ jobId: log.id, phase: 'partial', result: 'running', endedAt: null });
  log.line('job.checkpoint', 'ok', { checkpoint: 'readback_complete' });
  log.end('succeeded');
  expect(calls).toHaveLength(1);
  release();
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]).toMatchObject({ jobId: log.id, phase: 'final', result: 'success', endedAt: new Date(f.time()).toISOString() });
});

it.each([404, 405, 500])('falls back only for missing route HTTP status %s', async status => {
  const f = fixture(), requests: string[] = [];
  const api = createApiClient('https://example.invalid', async url => {
    requests.push(url.replace('https://example.invalid', ''));
    return url.endsWith('/trace') ? { ok: false, status, json: async () => { throw Error('unsupported'); } }
      : { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) };
  });
  const queue = new PostTraceQueue(f.logs, api, session, f.time);
  cleanup.push(() => queue.dispose());
  const log = f.logs.begin('blog_delete', 'naver');
  queue.track(log, 100, 'blog', user.userNo, 'fixture');
  log.end('succeeded');
  const missing = status === 404 || status === 405;
  await vi.waitFor(() => expect(f.logs.readTrace(log.id)?.lines.at(-1)).toMatchObject({ step: 'runner.log_upload', event: missing ? 'ok' : 'fail' }));
  expect(requests).toEqual(missing ? ['/auto/posts/trace', '/auto/posts/log'] : ['/auto/posts/trace']);
});

it('retains only the latest 20 pending jobs, and expires them after seven days', () => {
  const f = fixture();
  const queue = new PostTraceQueue(f.logs, observingApi().api, session, f.time);
  cleanup.push(() => queue.dispose());
  const ids = Array.from({ length: 21 }, (_, index) => {
    const log = f.logs.begin('blog_draft', 'naver');
    queue.track(log, index + 1, 'blog', user.userNo, 'fixture');
    return log.id;
  });
  const pending = () => JSON.parse(readFileSync(path.join(f.directory, 'post-traces.json'), 'utf8'));
  expect(pending().map((entry: { jobId: string }) => entry.jobId)).toEqual(ids.slice(1));
  f.advance(7 * 86400000 + 1);
  queue.retry();
  expect(pending()).toEqual([]);
});

const detail = {
  reason: 'DOM_ORDER_MISMATCH', counts: { expected: 1, observed: 1 }, check: 'photo_order', dialog: 'confirm',
  selector: 'BLOG_SAVE', operation: 'Runtime.evaluate', navigation: { host: 'band.us', path: '/band/123/post/456' },
  network: { method: 'POST', host: 'api.band.us', path: '/v2.0.2/create_post', contentType: 'application/json',
    queryFields: ['ts'], bodyFields: ['body'], decision: 'allowed' },
  bandList: { source: 'API' }, bandWrite: {}, connection: { host: 'nid.naver.com', path: '/nidlogin.login' },
  update: { event: 'check_auto' }, checkpoint: 'photos_uploaded', photoSource: 'cached_feed', choice: 'fail',
  blogInput: { location: 'marker_readback', phase: 'after_undo', markerLength: 3, observedCharacters: 1,
    startsWithMarker: false, firstCharacters: ['emoji'], emojiCount: 1, inList: true },
  blogTag: { phase: 'after_click', method: 'scrollIntoView', hit: 'SELF', clientHeight: 71, scrollHeight: 156,
    scrollTopBefore: 0, scrollTopAfter: 68.3, chipsBefore: 13, chipsAfter: 13, winYBefore: 0, winYAfter: 0, inputInside: true },
  blogDeleteScroll: { x: 640, y: 450, tag: 'iframe', classes: ['se-component'], iframe: true },
  photoOrder: { index: 1, expected: { host: 'coresos.phinf.naver.net', fileTail: '1234.jpg', hasSizeSuffix: false },
    observed: { host: 'coresos.phinf.naver.net', fileTail: '5678.jpg', hasSizeSuffix: false } },
} satisfies Required<TraceDetail>;

it('projects all registered detail properties for upload and drops repetition before comparisons and failures', () => {
  const f = fixture(), job = f.logs.begin('band_post', 'band');
  const unsafe = 'should-not-serialize';
  job.line('verification', 'fail', { ...detail, secret: unsafe,
    blogDeleteScroll: { ...detail.blogDeleteScroll, classes: ['se-component', unsafe], id: unsafe },
    network: { ...detail.network, queryFields: ['ts', unsafe], path: '/v2.0.2/create_post' } } as TraceDetail);
  for (let i = 0; i < 120; i++) job.line('cdp', 'ok', { operation: 'Runtime.evaluate', counts: { bytes: i } });
  job.end('failed', 'DOM_ORDER_MISMATCH');
  const payload = tracePayload(f.logs, job.id, 101, 'band', f.logs.identity('fixture'), 3300)!;
  expect(payload).toMatchObject({ truncated: true, droppedLines: 119 });
  expect(Buffer.byteLength(payload.log)).toBeLessThanOrEqual(3300);
  const lines = payload.log.trim().split('\n').map(line => JSON.parse(line));
  expect(lines.every(line => Number.isSafeInteger(line.t) && line.t >= 0)).toBe(true);
  const failed = lines.find(line => line.step === 'verification' && line.event === 'fail');
  expect(failed).toMatchObject(sanitizeDetail({ ...detail, network: { ...detail.network, queryFields: ['ts', unsafe] } }));
  expect(Object.keys(failed)).toEqual(expect.arrayContaining(Object.keys(detail)));
  expect(lines).toContainEqual(expect.objectContaining({ step: 'verification', event: 'decision', choice: 'fail',
    counts: detail.counts, blogInput: detail.blogInput, blogTag: detail.blogTag, blogDeleteScroll: detail.blogDeleteScroll }));
  expect(payload.log).not.toContain(unsafe);
});

it('uploads only bounded blog input diagnostics and never accepts arbitrary strings as shape data', () => {
  const raw = 'PRIVATE_EDITOR_TEXT';
  expect(sanitizeDetail({ blogInput: {
    location: 'marker_readback', phase: raw, markerLength: 3, observedCharacters: -1,
    startsWithMarker: raw, firstCharacters: ['digit', raw, 'emoji', 'period'],
    emojiCount: Number.MAX_VALUE, inList: true, text: raw,
  } } as unknown as TraceDetail).blogInput).toEqual({
    location: 'marker_readback', markerLength: 3, firstCharacters: ['digit', 'other', 'emoji'], inList: true,
  });
  expect(sanitizeDetail({ blogInput: { location: raw, markerLength: 3 } } as unknown as TraceDetail)).toEqual({});
});

it('uploads only allowlisted tag diagnostics and filters label, class suffix and input text', () => {
  const raw = 'PRIVATE_TAG_TEXT';
  expect(sanitizeDetail({ blogTag: {
    phase: 'before_click', method: raw, hit: `DIV.set_option_detail__${raw}`, scrollTopBefore: -1, chipsAfter: Number.POSITIVE_INFINITY,
    clientHeight: 71, inputInside: true, winYBefore: 0, winYAfter: raw, wheels: 0, label: raw, input: raw,
  } } as unknown as TraceDetail).blogTag).toEqual({ phase: 'before_click', clientHeight: 71, inputInside: true, winYBefore: 0 });
  expect(sanitizeDetail({ blogTag: { phase: raw, hit: 'INPUT' } } as unknown as TraceDetail)).toEqual({});
});

it('keeps literal trace steps and detail keys covered by the upload projection', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : file.endsWith('.ts') ? [file] : [];
  });
  const keys = Object.keys(sanitizeDetail(detail));
  const missing: string[] = [];
  for (const root of ['packages/core/src', 'packages/sites/src', 'packages/surface/src', 'apps/android/bridge']) {
    for (const file of files(root)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true);
      const inspect = (node: ts.Node) => {
        if (ts.isCallExpression(node) && (/^(trace|traceStep)$/.test(node.expression.getText(source)) ||
            ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'line')) {
          const [step, , value] = node.arguments;
          if (step && ts.isStringLiteralLike(step) && !traceSteps.some(name => name === step.text)) missing.push(`${file}: ${step.text}`);
          if (value && ts.isObjectLiteralExpression(value)) for (const property of value.properties) {
            if ('name' in property && property.name && !keys.includes(property.name.getText(source))) missing.push(`${file}: ${property.name.getText(source)}`);
          }
        }
        ts.forEachChild(node, inspect);
      };
      inspect(source);
    }
  }
  expect(missing).toEqual([]);
});
