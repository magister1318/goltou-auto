import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createFakeApi, defaultMyText, fakeAccounts, type ApiClient, type ApiRoutes } from '@goltou/api-client';
import type { SurfaceHost } from '@goltou/surface';
import { configureTrace, inTrace, trace } from '@goltou/surface/telemetry';
import { AppCore, MemoryTokenStore } from '../src/app';
import { ChannelRegistrationRunner } from '../src/band-runner';
import { fillMyText, parseContents, productTags, runText } from '../src/convert';
import { JobLogStore } from '../src/job-logs';
import { uploadFailedPostLog } from '../src/failed-log-upload';
import { migratePreferences, MemoryPreferencesStore } from '../src/preferences';
import type { AppRequest, Commands, JobInput } from '../src/protocol';
import { makePreview } from '../src/preparation';

const site = vi.hoisted(() => ({ events: [] as string[], attempts: new Map<string, number>() }));
vi.mock('../src/blog', async original => ({ ...await original<object>(), createBlogExecution: () => ({
  ensureReady: async () => {}, write: async () => {}, saveAndVerify: async () => {}, close: async () => {}, hide: async () => {},
  publish: async () => { site.events.push('blog'); return 'https://example.invalid/blog'; },
  readbackTimings: [], publishedIdentitySources: [], tableModes: [], linkCard: 'off',
}) }));
vi.mock('../src/band', async original => ({ ...await original<object>(), createBandExecution: (_plan: unknown, _files: unknown, _directory: unknown, key: string) => ({
  detectPublished: async () => null,
  write: async () => {
    site.events.push(key);
    site.attempts.set(key, (site.attempts.get(key) ?? 0) + 1);
    if (key === 'travel' && site.attempts.get(key) === 1) throw Error('BAND_PHOTO_LIMIT');
  },
  observe: async () => ({}), dialog: async () => null, hide: async () => {},
  publish: async () => { if (key === 'golf') throw Error('BAND_POST_UNCONFIRMED:IDENTITY_NOT_FOUND'); return 'https://example.invalid/band'; },
}) }));
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  configureTrace(undefined);
  for (const close of cleanup.splice(0).reverse()) await close();
  site.events.length = 0; site.attempts.clear();
});
const token = 'fixture-session';
const host: SurfaceHost = { create: vi.fn(), destroy: vi.fn(), clearSession: vi.fn() };
const productNo = 1235;
const band = (key: string) => ({ key, name: key, channel: 'band' as const });
const options = { polish: false, linkCard: false };
const fakeApi = () => createFakeApi({ token, user: fakeAccounts.manager! });
async function appFixture(api: ApiClient, runtime?: { logs: JobLogStore; preferences: MemoryPreferencesStore }) {
  const tokens = new MemoryTokenStore();
  await tokens.write(token);
  const paused: number[] = [];
  const app = new AppCore(api, tokens, runtime ? (checkpoint, notify) => {
    const runner = new ChannelRegistrationRunner({ band: { host, baseUrl: 'http://127.0.0.1', localPublish: true },
      blog: { host, localPublish: true }, bandPause: async ms => { paused.push(ms); site.events.push('pause'); } }, checkpoint, notify);
    runner.directory.choices = [band('travel'), band('golf'), band('club')].map(({ key, name }) => ({ key, name, photoLimit: null, observedAt: null }));
    const start = runner.start.bind(runner);
    runner.start = async (input, title, files, _work, context) => {
      const preview = makePreview(await api.request('/auto/products/get', { productNo }, token), {});
      await start(input, title, files, { preview, prepared: { preview, files: [] }, download: async () => {}, arrange: async () => {}, cleanup: async () => {} }, context);
    };
    return runner;
  } : undefined, undefined, runtime && { ...runtime, serviceChecks: [], device: async () => ({ kind: 'test', model: 'fixture', appVersion: '1.0.5' }) });
  cleanup.push(() => app.dispose());
  await app.restoreSession();
  const call = <K extends keyof Commands>(command: K, input: Commands[K]['input']) =>
    app.handle({ id: 1, type: 'app', command, input } as AppRequest) as Promise<Commands[K]['output']>;
  return { app, call, paused };
}
async function logsFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'goltou-wp37-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const logs = new JobLogStore(dir);
  configureTrace(logs);
  return logs;
}
const forward = (api: ApiClient, intercept: (route: keyof ApiRoutes, input: unknown) => void | Promise<void>): ApiClient => ({
  async request(route, input, token) { await intercept(route, input); return api.request(route, input, token); },
});
describe('WP37 상품 등록 계약', () => {
  it('keeps preformatted text and HTML nonbreaking spaces', () => {
    const parsed = parseContents('<pre>  첫째\n둘째  </pre><p>한&nbsp;&nbsp;글</p><p>기본  <b>  공백</b><br> 다음</p>');
    expect(parsed.blocks.map(block => block.kind === 'paragraph' && runText(block.runs))).toEqual(['  첫째\n둘째  ', '한  글', '기본 공백\n다음']);
  });
  it('keeps a linked cell’s wording and destination when a photo splits its table', async () => {
    const product = await fakeApi().request('/auto/products/get', { productNo }, token);
    const href = 'https://example.invalid/guide';
    const preview = makePreview({ ...product, departures: [], golfCourses: [],
      images: [{ order: 1, url: 'https://example.invalid/photo' }],
      contentsHtml: `<table><tr><td><a href="${href}">문의</a><img src="https://example.invalid/photo">그대로</td></tr></table>` }, {});
    expect(preview.verification.blog.matches && preview.verification.band.matches).toBe(true);
    expect(preview.blog.steps).toContainEqual(expect.objectContaining({ text: '문의', runs: [{ text: '문의', href }] }));
    expect(preview.band.steps).toContainEqual(expect.objectContaining({ text: `문의 (${href})` }));
  });
  it('builds ordered, sanitized unique tags and appends just one final Band tag line', () => {
    const product = { country: '#베트남!', region: '다낭', golfCourses: ['다낭', '몽고메리 CC', '★'] };
    expect(productTags(product, ['#베트남', '해외-골프', '골투'])).toEqual([
      { text: '베트남', kind: 'country' }, { text: '다낭', kind: 'region' }, { text: '몽고메리CC', kind: 'course' },
      { text: '해외골프', kind: 'word' }, { text: '골투', kind: 'word' },
    ]);
  });
  it('defaults missing personal text from older servers, then saves and reads per-user text', async () => {
    const fake = fakeApi();
    let legacy = true;
    const api: ApiClient = { async request<P extends keyof ApiRoutes>(route: P, input: ApiRoutes[P]['input'], key?: string) {
      const result = await fake.request(route, input, key);
      if (legacy && route === '/auto/me') {
        const { myText: _ignored, ...rest } = result as ApiRoutes['/auto/me']['output'];
        return rest as ApiRoutes[P]['output'];
      }
      return result;
    } };
    const { app, call } = await appFixture(api);
    expect(app.snapshot().myText).toEqual(defaultMyText());
    const preview = await call('preview.prepare', { productNo, options });
    expect(preview.band.steps.filter(step => step.kind === 'text').slice(-2)).toEqual([
      { kind: 'text', role: 'closing', text: '예약·문의는 골투 골프매니저 매니저 으로 편하게 연락 주세요.' },
      { kind: 'text', role: 'hashtags', text: '#태국 #방콕 #방콕CC' },
    ]);
    legacy = false;
    await call('preferences.save', { ...migratePreferences({ polish: false, closing: true, linkCard: false, lastBandKey: 'golf' })! });
    await call('myText.save', { prefix: ' {닉네임} ', closing: '앞 {휴대폰} 뒤', closingOn: false });
    const off = await call('preview.prepare', { productNo, options });
    expect(off.band.steps.find(step => step.kind === 'text' && step.role === 'prefix')).toMatchObject({ text: ' 골프매니저 ' });
    expect(off.band.steps.some(step => step.kind === 'text' && step.role === 'closing')).toBe(false);
    const on = await call('preview.prepare', { productNo, options: { ...options, closing: true } });
    expect(on.tags?.map(tag => tag.kind)).toEqual(['country', 'region', 'course']);
    expect(on.blog.steps.find(step => step.kind === 'text' && step.role === 'closing')).toMatchObject({ text: '앞 뒤' });
    expect(fillMyText('{닉네임} {휴대폰}', { name: '이름', phone: '123' })).toBe('이름 123');
    expect(fillMyText('앞  {휴대폰}  뒤', { name: '이름' })).toBe('앞   뒤');
  });
  it('migrates the previous band key and removes missing bands from the preference', async () => {
    expect(migratePreferences({ polish: false, closing: false, linkCard: false, lastBandKey: 'golf' })?.lastBandKeys).toEqual(['golf']);
    const { call } = await appFixture(fakeApi());
    await call('preferences.save', { polish: false, closing: false, linkCard: false, lastBandKeys: ['golf', 'old', 'travel', 'golf'] });
    await call('bands.list', {});
    expect((await call('preferences.get', {})).lastBandKeys).toEqual(['golf', 'travel']);
  });
  it('uses separate safe logs and records, waits between bands, and retries only a proven failure', async () => {
    const logs = await logsFixture(), preferences = new MemoryPreferencesStore();
    let logAttempts = 0;
    const uploads: ApiRoutes['/auto/posts/log']['input'][] = [];
    const api = forward(fakeApi(), (route, input) => {
      if (route !== '/auto/posts/log') return;
      logAttempts++;
      if (logAttempts === 1) throw new ApiError('server', 'fixture connection error', true);
      uploads.push(input as ApiRoutes['/auto/posts/log']['input']);
    });
    const { app, call, paused } = await appFixture(api, { logs, preferences });
    const input: JobInput = { productNo, mode: 'publish', publishConfirmed: true, targets: [band('travel'), band('golf'), { channel: 'blog', key: 'blog', name: '합성' }, band('club')], options };
    await call('job.start', input);
    await vi.waitFor(() => expect(app.snapshot().job?.completedSteps).toContain(7));
    expect(site.events).toEqual(['blog', 'travel', 'pause', 'golf', 'pause', 'club']);
    expect(paused).toHaveLength(2);
    for (const delay of paused) expect(delay).toBeGreaterThanOrEqual(20000), expect(delay).toBeLessThanOrEqual(40000);
    expect(app.snapshot().job?.targetResults?.map(result => result.outcome)).toEqual(['ok', 'failed', 'unconfirmed', 'ok']);
    expect((await preferences.read()).lastBandKeys).toEqual(['travel', 'golf', 'club']);
    expect(uploads).toHaveLength(2); expect(logAttempts).toBe(3);
    expect(new Set(uploads.map(value => value.postNo)).size).toBe(2);
    expect(uploads[0]?.log).toContain('BAND_PHOTO_LIMIT');
    expect(uploads[1]?.log).toContain('BAND_POST_UNCONFIRMED:IDENTITY_NOT_FOUND');
    expect(JSON.stringify(uploads)).not.toMatch(/fixture-session|방콕|https:/);
    expect(logs.list().filter(log => log.kind === 'band_post').map(log => log.result).sort()).toEqual(['failed', 'succeeded', 'uncertain']);
    await call('job.retryFailed', {});
    await vi.waitFor(() => expect(app.snapshot().job?.targetResults?.map(result => result.outcome)).toEqual(['ok', 'ok', 'unconfirmed', 'ok']));
    expect(site.events.slice(-2)).toEqual(['club', 'travel']);
    expect((await preferences.read()).lastBandKeys).toEqual(['travel', 'golf', 'club']);
    await expect(call('job.retryFailed', {})).rejects.toMatchObject({ code: 'conflict' });
  });
  it('runs the next band after a terminal record write fails and retries only the failed write', async () => {
    const logs = await logsFixture(), preferences = new MemoryPreferencesStore();
    let failedUpdate = 0;
    const api = forward(fakeApi(), (route, input) => {
      if (route === '/auto/posts/update' && (input as ApiRoutes['/auto/posts/update']['input']).failReason === 'BAND_PHOTO_LIMIT' && ++failedUpdate === 1) {
        throw new ApiError('server', 'fixture recording error');
      }
    });
    const { app, call } = await appFixture(api, { logs, preferences });
    await call('job.start', { productNo, mode: 'publish', publishConfirmed: true, targets: [band('travel'), band('club')], options });
    await vi.waitFor(() => expect(app.snapshot().job?.status).toBe('record_failed'));
    expect(site.events).toEqual(['travel', 'pause', 'club']);
    await call('job.retryRecord', {});
    await vi.waitFor(() => expect(app.snapshot().job?.status).toBe('failed'));
    expect(failedUpdate).toBe(2);
    expect(site.events).toEqual(['travel', 'pause', 'club']);
  });
  it('rejects over-limit selections before any record starts', async () => {
    const starts = vi.fn();
    const { call } = await appFixture(forward(fakeApi(), route => { if (route === '/auto/posts/start') starts(); }));
    await expect(call('job.start', { productNo, mode: 'publish', publishConfirmed: true, targets: ['a', 'b', 'c', 'd'].map(band), options })).rejects.toThrow('밴드 하루 한도');
    expect(starts).not.toHaveBeenCalled();
  });
  it('uploads capped code and count lines and quietly ignores absent routes', async () => {
    const logs = await logsFixture(), log = logs.begin('band_post', 'band');
    const missing = vi.fn(() => { throw new ApiError('not_found', 'route missing'); });
    const api = forward(fakeApi(), route => { if (route === '/auto/posts/log') missing(); });
    await inTrace(log, async () => {
      trace('verification', 'fail', { reason: 'READBACK_HREF', counts: { observed: 1 } });
      trace('verification', 'fail', { reason: 'READBACK_NUMBER', counts: { observed: 222 } });
      for(let i=0;i<10;i++) trace('verification', 'wait', { reason:'READBACK_PHOTOS', counts:{ observed:i } });
      trace('verification', 'fail', { reason:'READBACK_NUMBER', counts:{ observed:222 } });
      const tail = logs.uploadTail(log.id, 260);
      expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(260);
      expect(tail).toContain('UPLOAD_TRUNCATED');
      expect(tail.startsWith('{"step":"job","event":"start"')).toBe(true);
      expect(tail).toContain('READBACK_NUMBER'); expect(tail).not.toContain('READBACK_HREF');
      await uploadFailedPostLog(api, 17, tail, token);
    });
    expect(missing).toHaveBeenCalledTimes(1);
    expect(logs.uploadTail(log.id)).toContain('POST_LOG_ROUTE_MISSING');
  });
});
