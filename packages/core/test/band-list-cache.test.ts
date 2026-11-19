import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { BandExecution } from '@goltou/sites';
import type { Surface, SurfaceHost } from '@goltou/surface';
import { configureTrace, inTrace } from '@goltou/surface/telemetry';
import { ChannelRegistrationRunner } from '../src/band-runner';
import { bandListMaxAge, fileBandListStore, type BandListStore, type SavedBandList, type BandListResult } from '../src/band-list-cache';
import { JobLogStore, sanitizeDetail } from '../src/job-logs';
import { fileLocalDataTransfer } from '../src/local-data-transfer';
import { AppCore, MemoryTokenStore } from '../src/app';
import { createFakeApi } from '@goltou/api-client';
import type { PreparationWork } from '../src/preparation';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); configureTrace(undefined); for (const close of cleanups.splice(0).reverse()) await close(); });
const raw = [{ key: '987654321', name: '비공개 캐시 이름' }, { key: '876543219', name: '다른 캐시 이름' }];
const choices = raw.map(r => ({ ...r, photoLimit: null, observedAt: null }));
function memory(value: SavedBandList | null = { savedAt: Date.now(), rows: raw }): BandListStore {
  let saved = structuredClone(value);
  return { read: vi.fn(async () => structuredClone(saved)), write: vi.fn(async v => { saved = structuredClone(v); }) };
}
function fixture(store = memory()) {
  const page = new JSDOM('<div class="_myBandListWrap"></div>', { url: 'https://band.us/', runScripts: 'outside-only' });
  cleanups.push(() => page.window.close());
  page.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 1, y: 1, left: 1, top: 1, right: 101, bottom: 41, width: 100, height: 40, toJSON() {} });
  const surface = { session: 'band', guardRequests: vi.fn(async () => {}), restrictNavigation: vi.fn(async () => {}),
    readState: vi.fn(async () => ({ url: page.window.location.href, loading: false })),
    evaluateReadOnly: vi.fn(async script => page.window.eval(script)), readDialog: vi.fn(async () => null),
    open: vi.fn(async options => { page.reconfigure({ url: options.url }); }), close: vi.fn(async () => {}),
    click: vi.fn(async () => {}), typeText: vi.fn(async () => {}), pressKey: vi.fn(async () => {}), attachFiles: vi.fn(async () => {}),
  } as unknown as Surface;
  const host = { create: vi.fn(async () => surface), destroy: vi.fn(async () => {}), clearSession: vi.fn(async () => {}) } as SurfaceHost;
  const runner = new ChannelRegistrationRunner({ band: { host, listStore: store, publishEnabled: true } }, async () => {}, () => {});
  cleanups.push(() => runner.dispose());
  return { runner, host, surface, page, store };
}
function hold<T>() { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function until(check: () => boolean) { for (let n = 0; n < 300 && !check(); n++) await new Promise(r => setTimeout(r, 10)); expect(check()).toBe(true); }
const work = (): PreparationWork => ({ preview: { band: { channel: 'band', steps: [] }, blog: { channel: 'blog', steps: [] } }, download: vi.fn(async () => {}), arrange: vi.fn(async () => {}), prepared: { files: [] }, cleanup: vi.fn(async () => {}) } as unknown as PreparationWork);
const input = { productNo: 1, mode: 'publish' as const, publishConfirmed: true, targets: raw.map(r => ({ channel: 'band' as const, ...r })), options: { polish: false, closing: false, linkCard: false } };

describe('WP35 app-private Band list cache', () => {
  it('keeps a valid cached composer usable when its submit button is temporarily disabled for empty text or photo upload', async () => {
    const f = fixture(); await f.runner.listBands();
    f.page.reconfigure({ url: 'https://band.us/band/987654321/post' });
    for (const state of ['', '<div class="uploadProgress">사진 업로드 중</div>']) {
      f.page.window.document.body.innerHTML = '<textarea class="_postTextArea"></textarea><button class="_btnPostWrite" disabled>게시</button>' + state;
      await expect(f.runner.directory.guardTarget('987654321')).resolves.toBeUndefined();
    }
    expect(await f.store.read()).not.toBeNull();
  });
  it('opens and verifies a valid cached target through the runner without listing or submitting a post', async () => {
    const f = fixture(); await f.runner.listBands();
    Object.defineProperty(f.runner.directory, 'localPublish', { value: true }); // Synthetic surface only; bypass feed transport wait.
    const list = vi.spyOn(f.runner.directory, 'list');
    vi.mocked(f.surface.open).mockImplementation(async options => {
      f.page.reconfigure({ url: options.url });
      f.page.window.document.body.innerHTML = '<button class="_btnPostWrite">글쓰기</button>';
    });
    vi.mocked(f.surface.click).mockImplementation(async () => {
      f.page.window.document.body.innerHTML = '<textarea class="_postTextArea"></textarea><button class="_btnPostWrite" disabled>게시</button>';
    });
    await f.runner.start({ ...input, mode: 'draft', targets: [input.targets[0]!] }, '합성 시험', 0, work());
    await until(() => f.runner.job?.status !== 'running');
    expect(f.runner.job?.status).toBe('stopped_before_post');
    expect(f.surface.click).toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
    expect(f.runner.directory.decisionCodes).not.toContain('CREATE_ALLOWED');
    expect(await f.store.read()).not.toBeNull();
  });
  it('reads BAND when no cache exists and refresh=true bypasses a fresh cache', async () => {
    const f = fixture(memory(null));
    f.page.window.document.body.innerHTML = '<div class="_myBandListWrap"><a class="bandCover" href="/band/987654321/post"><span class="bandName">비공개 캐시 이름</span></a></div>';
    const value = await f.runner.listBands();
    expect(value).toMatchObject({ source: 'band', stale: false, savedAt: expect.any(Number), rows: [choices[0]] });
    expect(f.host.create).toHaveBeenCalledOnce(); expect(f.surface.open).toHaveBeenCalledOnce();
    expect(await f.store.read()).toMatchObject({ rows: [raw[0]] });
    f.runner.directory.observeLimit(raw[0]!.key, 24);
    expect(await f.runner.listBands({ refresh: true })).toMatchObject({ source: 'band', rows: [{ photoLimit: 24, observedAt: expect.any(String) }] }); expect(f.surface.open).toHaveBeenCalledTimes(2);
  });
  it.each([-1, 0, 1])('uses the exact 24-hour boundary (offset %s milliseconds)', async offset => {
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
    const f = fixture(memory({ savedAt: now - bandListMaxAge - offset, rows: raw }));
    const read = hold<typeof choices>(), list = vi.spyOn(f.runner.directory, 'list').mockReturnValue(read.promise);
    // Date was frozen before constructing the runner, which captures its clock.
    expect(await f.runner.listBands()).toMatchObject({ stale: offset >= 0 });
    expect(list).toHaveBeenCalledTimes(offset >= 0 ? 1 : 0);
    read.resolve(choices); await new Promise(r => setTimeout(r, 5)); vi.restoreAllMocks();
  });
  it('persists only list rows/time across restart; fresh lists need no BAND surface and seed start validation', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'goltou-cache-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'band-list-cache.json');
    const first = fixture(fileBandListStore(file));
    vi.spyOn(first.runner.directory, 'list').mockImplementation(async () => { first.runner.directory.choices = choices; return choices; });
    expect(await first.runner.listBands()).toMatchObject({ source: 'band', stale: false, rows: choices });
    first.runner.dispose();
    const f = fixture(fileBandListStore(file));
    expect(await f.runner.listBands()).toMatchObject({ source: 'cache', stale: false, rows: choices });
    expect(f.host.create).not.toHaveBeenCalled();
    expect(f.runner.directory.choices).toEqual(choices);
    f.runner.directory.observeLimit(raw[0]!.key, 30);
    await f.runner.listBands(); expect(f.runner.directory.choices[0]?.photoLimit).toBe(30);
    const download = hold<void>(), preparation = work(); preparation.download = async () => download.promise;
    await expect(f.runner.start(input, '합성 시험', 0, preparation)).resolves.toBeUndefined();
    expect(f.runner.job?.status).toBe('running'); expect(f.host.create).not.toHaveBeenCalled();
    f.runner.dispose(); download.resolve();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ savedAt: expect.any(Number), rows: raw });
    expect(await fileLocalDataTransfer(dir).export()).not.toMatch(/캐시 이름|987654321|band-list-cache/);
  });
  it('returns stale rows immediately, shares exactly one background read, and sends refreshed rows to subscribers', async () => {
    const f = fixture(memory({ savedAt: Date.now() - bandListMaxAge, rows: raw }));
    const read = hold<typeof choices>(), updates: BandListResult[] = [];
    f.runner.subscribeBands(value => updates.push(value));
    const list = vi.spyOn(f.runner.directory, 'list').mockImplementation(async () => read.promise);
    const first = await f.runner.listBands();
    expect(first).toMatchObject({ rows: choices, source: 'cache', stale: true, refreshing: true });
    expect(await f.runner.listBands()).toMatchObject({ source: 'cache', stale: true });
    expect(list).toHaveBeenCalledTimes(1);
    const refreshed = [{ ...choices[0]!, name: '바뀐 합성 이름' }]; read.resolve(refreshed);
    await until(() => updates.some(v => v.source === 'band'));
    expect(updates.at(-1)).toMatchObject({ rows: refreshed, source: 'band', stale: false, refreshing: false });
    expect(await f.store.read()).toEqual({ savedAt: expect.any(Number), rows: [{ key: raw[0]!.key, name: '바뀐 합성 이름' }] });
  });
  it('refresh=true always reads BAND and failure preserves the saved rows, timestamp and observed limits', async () => {
    const store = memory(), saved = await store.read(), f = fixture(store);
    await f.runner.listBands(); f.runner.directory.observeLimit(raw[0]!.key, 24);
    const list = vi.spyOn(f.runner.directory, 'list').mockImplementation(async () => { f.runner.directory.choices = []; throw Error('BAND_LIST_EMPTY'); });
    expect(await f.runner.listBands({ refresh: true })).toMatchObject({ rows: [{ ...choices[0], photoLimit: 24, observedAt: expect.any(String) }, choices[1]], source: 'cache', savedAt: saved!.savedAt, stale: false, failure: 'BAND_LIST_EMPTY' });
    expect(await f.store.read()).toEqual(saved); expect(list).toHaveBeenCalledOnce();
    expect(await f.runner.listBands()).toMatchObject({ source: 'cache', failure: 'BAND_LIST_EMPTY' }); expect(list).toHaveBeenCalledOnce();
  });
  it('does not repeatedly auto-refresh the same stale list after failure, but permits an explicit retry', async () => {
    const f = fixture(memory({ savedAt: Date.now() - bandListMaxAge - 1, rows: raw }));
    const updates: BandListResult[] = []; f.runner.subscribeBands(v => updates.push(v));
    const list = vi.spyOn(f.runner.directory, 'list').mockRejectedValue(Error('BAND_LIST_EMPTY'));
    await f.runner.listBands(); await until(() => updates.some(v => v.failure));
    await f.runner.listBands(); expect(list).toHaveBeenCalledOnce();
    await f.runner.listBands({ refresh: true }); expect(list).toHaveBeenCalledTimes(2);
  });
  it('clears the persistent cache and choices on BAND_LOGIN_LOST', async () => {
    const f = fixture(); await f.runner.listBands();
    vi.spyOn(f.runner.directory, 'list').mockRejectedValue(Error('BAND_LOGIN_LOST'));
    await expect(f.runner.listBands({ refresh: true })).rejects.toThrow('BAND_LOGIN_LOST');
    expect(await f.store.read()).toBeNull(); expect(f.runner.directory.choices).toEqual([]);
  });
  it('clears the persistent cache when a routine login check detects BAND logout', async () => {
    const f = fixture(); await f.runner.listBands();
    f.page.window.document.body.innerHTML = '<input type="password">';
    expect(await f.runner.serviceLogin.check('band')).toBe('expired');
    expect(await f.store.read()).toBeNull(); expect(f.runner.directory.choices).toEqual([]);
  });
  it('forwards background completion through AppCore snapshots and the bands.list command', async () => {
    const f = fixture(memory({ savedAt: Date.now() - bandListMaxAge, rows: raw }));
    const api = createFakeApi(), tokens = new MemoryTokenStore();
    const login = await api.request('/auto/login', { loginId: 'manager', password: 'demo', device: { kind: 'web', model: 'fixture', appVersion: '1.0.3' } });
    await tokens.write(login.token);
    const app = new AppCore(api, tokens, () => f.runner, undefined, { device: async () => ({ kind: 'web', model: 'fixture', appVersion: '1.0.3' }), serviceChecks: [] });
    cleanups.push(() => app.dispose()); await app.initialize();
    const read = hold<typeof choices>(); vi.spyOn(f.runner.directory, 'list').mockReturnValue(read.promise);
    const updates: BandListResult[] = []; app.subscribe(v => { if (v.bandList) updates.push(v.bandList); });
    expect(await app.handle({ id: 1, type: 'app', command: 'bands.list', input: {} })).toMatchObject({ source: 'cache', stale: true });
    read.resolve([choices[1]!]); await until(() => updates.some(v => v.source === 'band'));
    expect(app.snapshot().bandList).toMatchObject({ source: 'band', rows: [choices[1]], stale: false });
  });
  it('service reset clears BAND cache before a new account can connect', async () => {
    const f = fixture(), api = createFakeApi(), tokens = new MemoryTokenStore();
    const login = await api.request('/auto/login', { loginId: 'manager', password: 'demo', device: { kind: 'web', model: 'fixture', appVersion: '1.0.3' } });
    await tokens.write(login.token);
    const app = new AppCore(api, tokens, () => f.runner, undefined, { device: async () => ({ kind: 'web', model: 'fixture', appVersion: '1.0.3' }), serviceChecks: [] });
    cleanups.push(() => app.dispose()); await app.initialize(); await f.runner.listBands();
    await app.handle({ id: 1, type: 'app', command: 'service.clear', input: { service: 'band' } });
    expect(await f.store.read()).toBeNull(); expect(f.host.clearSession).toHaveBeenCalledWith('band');
  });
  it('never resurrects a background result when logout/account reset arrives during the read', async () => {
    const f = fixture(memory({ savedAt: Date.now() - bandListMaxAge, rows: raw })), read = hold<typeof choices>();
    vi.spyOn(f.runner.directory, 'list').mockImplementation(async () => { const rows = await read.promise; f.runner.directory.choices = rows; return rows; });
    await f.runner.listBands(); await f.runner.clearBandCache('BAND_ACCOUNT_CHANGED'); read.resolve(choices);
    await until(() => f.runner.directory.choices.length === 0);
    await new Promise(r => setTimeout(r, 10));
    expect(await f.store.read()).toBeNull(); expect(f.runner.directory.choices).toEqual([]);
  });
  it.each(['not-member', 'member-korean', 'not-found', 'permission', 'disabled', 'route', 'dialog'])('fails a single cached target before any input or post and invalidates the cache (%s)', async mode => {
    const f = fixture(); await f.runner.listBands();
    vi.mocked(f.surface.open).mockImplementation(async options => {
      if (mode === 'dialog') { vi.mocked(f.surface.evaluateReadOnly).mockRejectedValue(Error('DIALOG_BLOCKS_RUNTIME')); vi.mocked(f.surface.readState).mockRejectedValue(Error('DIALOG_BLOCKS_RUNTIME')); }
      f.page.reconfigure({ url: mode === 'route' ? 'https://band.us/not_found' : options.url });
      f.page.window.document.body.innerHTML = mode === 'disabled' ? '<button class="_btnPostWrite" disabled>글쓰기</button>' : '<p class="errorPage">' + ({ 'not-member': '가입하지 않은 밴드입니다.', 'member-korean': '이 밴드의 멤버가 아닙니다.', 'not-found': '존재하지 않는 밴드입니다.', permission: '글쓰기 권한이 없습니다.' }[mode] ?? '') + '</p>';
    });
    if (mode === 'dialog') vi.mocked(f.surface.readDialog!).mockResolvedValue({ id: 'denied', kind: 'alert', message: '글쓰기 권한이 없습니다.' });
    await f.runner.start({ ...input, targets: [input.targets[0]!] }, '합성 시험', 0, work());
    await until(() => f.runner.job?.status === 'failed');
    const denied = ['permission', 'disabled', 'dialog'].includes(mode);
    const message = denied ? '이 밴드에서 글을 쓸 권한이 없습니다.' : '밴드 목록이 바뀌었습니다. 새로고침 후 다시 골라 주세요.';
    const failureCode = denied ? 'BAND_WRITE_NOT_ALLOWED' : 'BAND_TARGET_INVALID';
    expect(f.runner.job).toMatchObject({ status: 'failed', failureCode, message, publicationUncertain: false });
    expect(f.runner.job?.targetResults).toMatchObject([{ status: 'failed', reason: failureCode }]);
    expect(await f.store.read()).toBeNull();
    expect(f.surface.open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: 'https://band.us/band/987654321/post' }));
    for (const call of [f.surface.click, f.surface.typeText, f.surface.pressKey, f.surface.attachFiles]) expect(call).not.toHaveBeenCalled();
    expect(f.runner.directory.decisionCodes).not.toContain('CREATE_ALLOWED');
    await expect(f.runner.resume()).rejects.toThrow(message);
    await expect(f.runner.cancel()).resolves.toBeUndefined();
    expect(f.runner.job?.status).toBe('stopped');
  });
  it('logs fixed cache diagnostics and clearing reasons without names, band numbers or queries', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'goltou-cache-logs-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const logs = new JobLogStore(dir); configureTrace(logs);
    const f = fixture(); await f.runner.listBands();
    vi.spyOn(f.runner.directory, 'list').mockRejectedValue(Error('PRIVATE_NAME?token=PRIVATE_QUERY'));
    await f.runner.listBands({ refresh: true }); vi.mocked(f.runner.directory.list).mockResolvedValue(choices); await f.runner.listBands({ refresh: true }); await f.runner.clearBandCache('BAND_ACCOUNT_CHANGED');
    const lines = [];
    for (const day of (await readdir(dir)).filter(n => /^\d{8}$/.test(n))) for (const name of await readdir(path.join(dir, day))) lines.push(...(await readFile(path.join(dir, day, name), 'utf8')).trim().split('\n').map(l => JSON.parse(l)));
    const text = JSON.stringify(lines);
    for (const value of [...raw.flatMap(r => [r.key, r.name]), 'PRIVATE_NAME', 'PRIVATE_QUERY', '?token=']) expect(text).not.toContain(value);
    expect(lines.find(l => l.step === 'band.list.cache' && !l.reason)).toMatchObject({ bandList: { cacheSource: 'cache', cacheAgeMinutes: 0, stale: false, refreshRequested: false, rowCount: 2, cacheCleared: false } });
    expect(lines.find(l => l.reason === 'BAND_ACCOUNT_CHANGED')).toMatchObject({ bandList: { cacheCleared: true, rowCount: 0 } });
    expect(lines.some(l => l.bandList?.refreshRequested)).toBe(true);
    expect(lines.some(l => l.bandList?.cacheSource === 'band')).toBe(true);
    expect(sanitizeDetail({ bandList: { cacheSource: 'PRIVATE_NAME', cacheAgeMinutes: -1, stale: 'PRIVATE_NAME', cacheCleared: true, names: raw } } as never)).toEqual({ bandList: { cacheCleared: true } });
  });
});

it.each(['alternate-composer','timeout','permission-after-click'])('names the fourth Band wait on a band with two spaces (%s)', async mode => {
  const f = fixture();
  const directory = f.runner.directory, band = { key:'987654321', name:'합성 밴드  이름' };
  directory.seedChoices([band]);
  vi.spyOn(directory,'freshFeed').mockReturnValue(true);
  vi.mocked(f.surface.open).mockImplementation(async options=>{
    f.page.reconfigure({ url:options.url + '?private=HIDDEN_QUERY' });
    f.page.window.document.body.innerHTML = '<button class="_btnPostWrite" aria-label="글쓰기"><span>✎</span></button>';
  });
  vi.mocked(f.surface.click).mockImplementation(async (_x,_y,before)=>{
    await before?.();
    if (mode === 'alternate-composer') f.page.window.document.body.innerHTML = '<section class="postWriteSection"><textarea aria-label="본문"></textarea></section>';
    if (mode === 'permission-after-click') f.page.window.document.body.innerHTML = '<div role="alertdialog">이 밴드에서 글쓰기 권한이 없습니다.</div>';
  });
  const folder = await mkdtemp(path.join(os.tmpdir(),'goltou-composer-'));
  cleanups.push(()=>rm(folder,{recursive:true,force:true}));
  const logs = new JobLogStore(folder); configureTrace(logs);
  const record = logs.begin('band_post','band');
  const execution = new BandExecution({channel:'band',steps:[]},[],{
    directory,key:band.key,check(){},verify(){},progress(){},sourceDimensions:async()=>({width:1,height:1}),
  });
  vi.useFakeTimers();
  try {
    const pending = inTrace(record,()=>execution.ensureReady());
    const expectation = mode === 'alternate-composer' ? expect(pending).resolves.toBeUndefined() :
      expect(pending).rejects.toThrow(mode === 'timeout' ? 'BAND_COMPOSER_UNAVAILABLE' : 'BAND_WRITE_NOT_ALLOWED');
    await vi.advanceTimersByTimeAsync(15500);
    await expectation;
  } finally { vi.useRealTimers(); record.end('stopped'); }
  const uploaded = logs.uploadTail(record.id);
  const waits = uploaded.trim().split('\n').map(line=>JSON.parse(line)).filter(line=>line.step==='sites.dom.waitFor');
  expect(waits.filter(line=>line.event==='start').map(line=>line.selector)).toEqual([
    'BAND_SESSION','BAND_FEED','BAND_WRITE_CONTROL','BAND_COMPOSER',
  ]);
  expect(waits.every(line=>line.counts.timeoutMs>0)).toBe(true);
  if (mode === 'timeout') expect(waits.at(-1)).toMatchObject({ selector:'BAND_COMPOSER',reason:'OBSERVATION_TIMEOUT',
    counts:{editables:0,writeButtons:1},navigation:{path:'/band/[id]/post'} });
  expect(uploaded).not.toMatch(/HIDDEN_QUERY|합성 밴드|987654321/);
  expect(f.surface.click).toHaveBeenCalledTimes(1);
  expect(f.surface.typeText).not.toHaveBeenCalled();
});

it.each(['covered', 'hidden', 'no-label', 'outside-viewport', 'feed-timeout', 'covered-before-press'])('names and diagnoses a Band opening failure (%s)', async mode => {
  const f = fixture();
  const directory = f.runner.directory, key = '987654321';
  directory.seedChoices([{ key, name: '합성 이름' }]);
  vi.spyOn(directory, 'freshFeed').mockReturnValue(mode !== 'feed-timeout');
  vi.mocked(f.surface.open).mockImplementation(async options => {
    f.page.reconfigure({ url: options.url + '?private=HIDDEN_QUERY' });
    const aria = mode === 'no-label' ? 'PRIVATE_LABEL' : '글쓰기';
    f.page.window.document.body.innerHTML = `<button class="uFloatingButton _btnPostWrite" aria-label="${aria}"${mode === 'hidden' ? ' hidden' : ''}>PRIVATE_BODY</button>`;
    if (mode === 'outside-viewport') f.page.window.document.querySelector('button')!.getBoundingClientRect = () =>
      new f.page.window.DOMRect(1, f.page.window.innerHeight + 20, 100, 40);
  });
  const readHit = vi.fn<NonNullable<Surface['readClickTarget']>>();
  f.surface.readClickTarget = readHit.mockImplementation(async (_x, _y, _selector, options) => {
    const attempt = readHit.mock.calls.length;
    if (mode === 'covered-before-press' && attempt === 2) return true;
    const afterHover = mode === 'covered-before-press' && attempt === 3;
    options?.onMiss?.report({ scrollX: -10, scrollY: 250, rejectedHit: {
      tag: afterHover ? 'span' : 'div', classes: ['lyWrap', 'PRIVATE_CLASS'], ariaLabel: 'PRIVATE_LABEL',
      ancestorClasses: ['modalWrap_800', 'PRIVATE_ANCESTOR'],
      rect: Object.assign({ x: -5, y: 50.5, width: 100, height: 40 }, { extra: 'PRIVATE_GEOMETRY' }),
      relation: afterHover ? 'ancestor' : 'unrelated',
    } });
    return false;
  });
  const press = vi.fn();
  vi.mocked(f.surface.click).mockImplementation(async (_x, _y, beforePress) => { await beforePress?.(); press(); });
  const folder = await mkdtemp(path.join(os.tmpdir(), 'goltou-band-write-'));
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  const logs = new JobLogStore(folder); configureTrace(logs);
  const record = logs.begin('band_post', 'band');
  const execution = new BandExecution({ channel: 'band', steps: [] }, [], {
    directory, key, check() {}, verify() {}, progress() {}, sourceDimensions: async () => ({ width: 1, height: 1 }),
  });
  vi.useFakeTimers();
  try {
    const expectation = expect(inTrace(record, () => execution.ensureReady())).rejects.toThrow(
      mode === 'feed-timeout' ? 'OBSERVATION_TIMEOUT' : 'BAND_COMPOSER_UNAVAILABLE',
    );
    await vi.advanceTimersByTimeAsync(20500);
    await expectation;
  } finally { vi.useRealTimers(); record.end('stopped'); }
  const uploaded = logs.uploadTail(record.id);
  const lines = uploaded.trim().split('\n').map(line => JSON.parse(line));
  const failure = lines.find(line => line.event === 'fail' && ['sites.dom.waitFor', 'sites.band.write-control'].includes(line.step));
  if (mode === 'feed-timeout') {
    expect(failure).toMatchObject({ selector: 'BAND_FEED', reason: 'OBSERVATION_TIMEOUT' });
    expect(lines.some(line => line.selector === 'BAND_WRITE_CONTROL')).toBe(false);
  } else {
    const missed = mode === 'covered' || mode === 'covered-before-press';
    expect(failure).toMatchObject({ selector: 'BAND_WRITE_CONTROL', bandWrite: {
      legacyFloating: { matches: mode === 'no-label' ? 0 : 1, visible: ['no-label', 'hidden'].includes(mode) ? 0 : 1,
        inViewport: missed ? 1 : 0, readClickTarget: missed ? 'miss' : 'not_checked',
        ...(missed ? { scrollX: -10, scrollY: 250, candidateRect: { x: 1, y: 1, width: 100, height: 40 },
          rejectedHit: { tag: mode === 'covered-before-press' ? 'span' : 'div', classes: ['lyWrap'], ariaLabel: '[other]',
            ancestorClasses: ['modalWrap_800'],
            rect: { x: -5, y: 50.5, width: 100, height: 40 }, relation: mode === 'covered-before-press' ? 'ancestor' : 'unrelated' } } : {}) },
      legacyText: { matches: 1, textMatches: 0, ariaMatches: mode === 'no-label' ? 0 : 1, readClickTarget: 'not_checked' },
      labelled: { matches: mode === 'no-label' ? 0 : 1 },
    } });
    if (mode !== 'covered-before-press') expect(failure).toMatchObject({ counts: { writeButtons: 1, editables: 0 }, navigation: { path: '/band/[id]/post' } });
    else expect(lines.find(line => line.step === 'sites.band.write-control' && line.event === 'retry')).toMatchObject({ bandWrite: { legacyFloating: { rejectedHit: { tag: 'div' } } } });
  }
  const [day] = (await readdir(folder)).filter(name => /^\d{8}$/.test(name));
  const [file] = await readdir(path.join(folder, day!));
  const local = await readFile(path.join(folder, day!, file!), 'utf8');
  expect(uploaded + local).not.toMatch(/PRIVATE_|HIDDEN_QUERY|합성 이름|987654321/);
  expect(press).not.toHaveBeenCalled();
  expect(f.surface.typeText).not.toHaveBeenCalled();
});
