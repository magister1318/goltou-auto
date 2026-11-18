import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GuardedRequest, GuardedResponse, Surface, SurfaceHost } from '@goltou/surface';
import { configureTrace } from '@goltou/surface/telemetry';
import { parseBandList } from '../../sites/src/band/directory-list';
import { ChannelRegistrationRunner } from '../src/band-runner';
import { JobLogStore, sanitizeDetail } from '../src/job-logs';

const temp: string[] = [], pages: JSDOM[] = [];
beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }));
afterEach(() => {
  configureTrace(undefined); vi.useRealTimers();
  for (const page of pages.splice(0)) page.window.close();
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const rows = [{ band_no: '987654321', name: '비공개 합성 밴드' }, { band_key: '876543219', band_name: '다른 합성 밴드', can_write_post: true }];
const endpoint = 'https://region-new.band.us/v9.8.7/get_band_list?token=PRIVATE_QUERY';
const legacy = '<div class="_myBandListWrap"><a class="bandCover" href="/band/765432198/post"><span class="bandName">화면 합성 밴드</span></a></div>';

function fixture(html = '<div class="globalMyBandWrap"></div>') {
  const page = new JSDOM(html, { url: 'https://band.us/', runScripts: 'outside-only' }); pages.push(page);
  page.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 1, y: 1, left: 1, top: 1, right: 81, bottom: 41, width: 80, height: 40, toJSON() {} });
  let inspect!: (r: GuardedRequest) => boolean | Promise<boolean>;
  let response!: (r: GuardedResponse) => void;
  let observes!: (r: Pick<GuardedRequest, 'url' | 'method'>) => boolean;
  let blocked!: NonNullable<Parameters<NonNullable<Surface['guardRequests']>>[4]>;
  let onOpen = async () => {};
  const surface = {
    guardRequests: async (...[_rules, guard, reply, observe, denied]: Parameters<NonNullable<Surface['guardRequests']>>) => { inspect = guard; response = reply; observes = observe!; blocked = denied!; },
    open: async () => onOpen(),
    readState: async () => ({ url: page.window.location.href }),
    evaluateReadOnly: async (script: string) => page.window.eval(script),
    readDialog: async () => null,
  } as unknown as Surface;
  const host = { create: async () => surface, destroy: vi.fn(async () => {}) } as unknown as SurfaceHost;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'goltou-band-list-')); temp.push(dir);
  const store = new JobLogStore(dir); configureTrace(store);
  const runner = new ChannelRegistrationRunner({ band: { host } }, async () => {}, () => {});
  const readLines = () => readdirSync(dir).filter(name => /^\d{8}$/.test(name)).flatMap(day => readdirSync(path.join(dir, day)).flatMap(file => readFileSync(path.join(dir, day, file), 'utf8').trim().split('\n').map(line => JSON.parse(line))));
  const reply = (method = 'POST', body = JSON.stringify({ result_code: 1, result_data: { bands: rows } }), url = endpoint, status = 200) => {
    expect(observes({ method, url })).toBe(true); response({ method, url, body, status });
  };
  return { runner, host, page, store, readLines, reply, setOpen: (work: () => Promise<void>) => { onOpen = work; },
    inspect: (r: GuardedRequest) => inspect(r), blocked: (r: GuardedRequest | undefined, code: Parameters<typeof blocked>[1]) => blocked(r, code),
    observes: (method: string, url = endpoint) => observes({ method, url }) };
}
async function settle<T>(work: Promise<T>) {
  // Attach both outcomes before advancing fake time, including expected failures.
  const outcome = work.then(value => ({ value }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(16000);
  return outcome;
}

describe('Band membership observation and scoped request barrier', () => {
  it.each(['GET', 'POST'])('returns API rows within the DOM wait when home never renders tiles (%s)', async method => {
    const f = fixture(method === 'GET' ? '' : '<div class="globalMyBandWrap"></div>');
    f.setOpen(async () => {
      expect(await f.inspect({ method, url: endpoint })).toBe(true);
      f.reply(method);
    });
    const start = Date.now(), result = await settle(f.runner.listBands());
    expect(result).toEqual({ value: rows.map(r => ({ key: r.band_no ?? r.band_key, name: r.name ?? r.band_name, photoLimit: null, observedAt: null })) });
    expect(Date.now() - start).toBeLessThan(17000);
    expect(f.readLines().find(l => l.step === 'band.list.result')).toMatchObject({ reason: 'BAND_LIST_API_ONLY', bandList: { source: 'API', home: method !== 'GET', tileCount: 0, apiCaptured: true, apiRows: 2 } });
    expect(f.store.list()[0]).toMatchObject({ kind: 'band_list', result: 'succeeded', reason: 'BAND_LIST_API_ONLY' });
    expect(f.observes(method)).toBe(false);
  });
  it('prefers working DOM tiles even when API capture is available', async () => {
    const f = fixture(legacy); f.setOpen(async () => { f.reply(); });
    expect(await f.runner.listBands()).toEqual([{ key: '765432198', name: '화면 합성 밴드', photoLimit: null, observedAt: null }]);
    expect(f.store.list()[0]?.reason).toBe('BAND_LIST_DOM');
    expect(f.readLines().find(l => l.step === 'band.list.result').bandList).toMatchObject({ legacy: true, source: 'DOM', apiRows: 2, tileCount: 1 });
  });
  it('uses a late API response in the same wait and omits only explicitly denied memberships', async () => {
    const f = fixture();
    f.setOpen(async () => { setTimeout(() => f.reply('POST', JSON.stringify({ result_code: 1, result_data: { bands: [
      ...rows, { band_no: '123456789', name: '권한 없음', can_write_post: false },
    ] } })), 14000); });
    expect(await settle(f.runner.listBands())).toMatchObject({ value: [
      { key: '987654321' }, { key: '876543219' },
    ] });
    expect(f.readLines().find(l => l.step === 'band.list.result').bandList).toMatchObject({ apiCaptured: true, apiRows: 3, source: 'API' });
  });
  it('does not use an unsuccessful API response as list evidence', async () => {
    const f = fixture(); f.setOpen(async () => { f.reply('POST', JSON.stringify({ bands: rows }), endpoint, 403); });
    expect(await settle(f.runner.listBands())).toMatchObject({ error: new Error('BAND_LIST_EMPTY') });
    expect(f.readLines().find(l => l.step === 'band.list.api')).toMatchObject({ reason: 'BAND_LIST_API_INVALID', bandList: { apiCaptured: false, apiRows: 0 } });
  });
  it('allows the read-style POST needed to render tiles only during list, then restores the original barrier', async () => {
    const f = fixture(''); const read = { method: 'POST', url: 'https://api-new.band.us/v2.0.0/get_my_profile' };
    await f.runner.directory.getSurface(); expect(await f.inspect(read)).toBe(false);
    f.setOpen(async () => { if (await f.inspect(read)) f.page.window.document.body.innerHTML = legacy; });
    expect(await f.runner.listBands()).toHaveLength(1);
    expect(await f.inspect(read)).toBe(false);
    expect(await f.inspect({ method: 'POST', url: endpoint })).toBe(false);
    expect(await f.inspect({ method: 'POST', url: 'https://api-kr.band.us/v2.3.0/get_band_list' })).toBe(true);
  });
  it('allows only trusted read-style POSTs, and rejects create/delete/write candidates throughout list', async () => {
    const f = fixture(legacy);
    f.setOpen(async () => {
      for (const segment of ['get_my_profile', 'check_member', 'is_member', 'read_bands', 'sync_profile', 'batch']) expect(await f.inspect({ method: 'POST', url: `https://band.us/v2.0.0/${segment}` })).toBe(true);
      for (const route of ['/v2.0.2/create_post', '/v9.8.7/create_post', '/v9/band/post/create', '/band-post-create', '/v2.0.0/delete_post', '/v2.0.0/update_post', '/v2.0.0/get_profile/create_post', '/create_post/get_profile']) {
        expect(await f.inspect({ method: 'POST', url: `https://api-kr.band.us${route}?band_no=987654321` })).toBe(false);
      }
      for (const url of ['http://api-kr.band.us/v2/get_profile', 'https://band.us.evil.invalid/v2/get_profile', 'https://other.invalid/get_profile']) expect(await f.inspect({ method: 'POST', url })).toBe(false);
      for (const method of ['PUT', 'PATCH', 'DELETE']) expect(await f.inspect({ method, url: endpoint })).toBe(false);
      f.page.window.document.body.innerHTML += '<textarea class="_postTextArea"></textarea>';
      expect(await f.inspect({ method: 'POST', url: 'https://api-kr.band.us/v2/get_profile' })).toBe(false);
      f.page.window.document.querySelector('textarea')!.remove();
    });
    expect(await f.runner.listBands()).toHaveLength(1);
    expect(f.runner.directory.decisionCodes).not.toContain('CREATE_ALLOWED');
  });
  it('does not activate the wider barrier with an existing composer or armed submit', async () => {
    const f = fixture('<textarea class="_postTextArea"></textarea>');
    await expect(f.runner.listBands()).rejects.toThrow('BAND_COMPOSER_ACTIVE');
    expect(f.host.destroy).not.toHaveBeenCalled();
    f.page.window.document.body.innerHTML = legacy; f.runner.directory.arm('987654321');
    await expect(f.runner.listBands()).rejects.toThrow('BAND_COMPOSER_ACTIVE');
    expect(await f.inspect({ method: 'POST', url: 'https://api-kr.band.us/v2/get_profile' })).toBe(false);
  });
  it.each([
    { html: '', reason: 'BAND_HOME_UNRECOGNIZED' },
    { html: '<div class="globalMyBandWrap"></div>', reason: 'BAND_LIST_EMPTY' },
    { html: '<input type="password">', reason: 'BAND_LOGIN_LOST' },
  ])('records a specific final failure: $reason', async ({ html, reason }) => {
    const f = fixture(html); const outcome = await settle(f.runner.listBands());
    expect(outcome).toMatchObject({ error: new Error(reason) });
    expect(f.store.list()[0]).toMatchObject({ result: 'failed', reason });
    expect(f.readLines().find(l => l.step === 'band.list.result')).toMatchObject({ reason, bandList: { source: 'none', apiCaptured: false, apiRows: 0 } });
    expect(await f.inspect({ method: 'POST', url: 'https://api-kr.band.us/v2/get_profile' })).toBe(false);
  });
  it('never reuses stale API capture after a later read or after login is lost', async () => {
    const f = fixture(); f.setOpen(async () => { f.reply(); });
    expect(await settle(f.runner.listBands())).toHaveProperty('value');
    f.setOpen(async () => {});
    expect(await settle(f.runner.listBands())).toMatchObject({ error: new Error('BAND_LIST_EMPTY') });
    f.setOpen(async () => { f.reply(); f.page.reconfigure({ url: 'https://auth.band.us/login?token=PRIVATE_QUERY' }); });
    expect(await settle(f.runner.listBands())).toMatchObject({ error: new Error('BAND_LOGIN_LOST') });
  });
  it('persists only counts, markers, method, masked locations and reason codes, also on a reused surface', async () => {
    const f = fixture(legacy); await f.runner.directory.getSurface();
    f.setOpen(async () => {
      f.reply();
      const denied = { method: 'POST', url: 'https://new-api.band.us/v9.8.7/delete_post/987654321?token=PRIVATE_QUERY#SECRET_FRAGMENT' };
      expect(await f.inspect(denied)).toBe(false); f.blocked(denied, 'INSPECTOR_DENIED');
      f.blocked({ method: 'POST', url: 'https://new-api.band.us/v9.8.7/update_post/876543219?secret=PRIVATE_QUERY' }, 'STATIC_BLOCK');
      f.blocked({ method: 'GET', url: 'https://new-api.band.us/v9.8.7/get_post/876543219?secret=PRIVATE_QUERY' }, 'STATIC_BLOCK');
      f.page.reconfigure({ url: 'https://band.us/band/765432198/post?private=PRIVATE_QUERY' });
    });
    await f.runner.listBands();
    const lines = f.readLines(), output = JSON.stringify(lines);
    for (const secret of ['비공개 합성 밴드', '다른 합성 밴드', '화면 합성 밴드', '987654321', '876543219', '765432198', 'PRIVATE_QUERY', 'SECRET_FRAGMENT', '?token=', '?secret=', '?private=']) expect(output).not.toContain(secret);
    expect(lines.filter(l => l.step === 'band.list.request')).toEqual([
      expect.objectContaining({ reason: 'ROUTE_BLOCKED', connection: { host: 'new-api.band.us', path: '/v9.8.7/delete_post/{n}' }, bandList: { method: 'POST' } }),
      expect.objectContaining({ reason: 'SURFACE_STATIC_BLOCK', connection: { host: 'new-api.band.us', path: '/v9.8.7/update_post/{n}' }, bandList: { method: 'POST' } }),
      expect.objectContaining({ reason: 'SURFACE_STATIC_BLOCK', connection: { host: 'new-api.band.us', path: '/v9.8.7/get_post/{n}' }, bandList: { method: 'GET' } }),
    ]);
    expect(lines.find(l => l.step === 'band.list.result').connection).toEqual({ host: 'band.us', path: '/band/{n}/post' });
    expect(new JobLogStore(f.store.directory).list()[0]?.reason).toBe('BAND_LIST_DOM');
  });
  it('reconstructs list diagnostics from fixed fields even for a hostile caller', () => {
    expect(sanitizeDetail({ bandList: { legacy: true, home: 'PRIVATE_NAME', source: 'PRIVATE_NAME', method: 'PRIVATE_NAME', tileCount: -1, apiRows: 2, band_no: '987654321', names: ['PRIVATE_NAME'] } } as never)).toEqual({ bandList: { legacy: true, method: 'other', apiRows: 2 } });
  });
  it('keeps each rejection code with its own request when requests arrive concurrently', async () => {
    const f = fixture(legacy);
    f.setOpen(async () => {
      expect(await Promise.all([
        f.inspect({ method: 'POST', url: 'https://api-kr.band.us/v2.0.0/delete_post' }),
        f.inspect({ method: 'DELETE', url: endpoint }),
      ])).toEqual([false, false]);
    });
    await f.runner.listBands();
    expect(f.readLines().filter(l => l.step === 'band.list.request').map(l => [l.bandList.method, l.reason])).toEqual([
      ['POST', 'ROUTE_BLOCKED'], ['DELETE', 'METHOD_BLOCKED'],
    ]);
  });
});

describe('ephemeral membership payload parsing', () => {
  it('reads nested membership identities, deduplicates, and keeps unknown permission', () => {
    expect(parseBandList(JSON.stringify({ result_code: 1, result_data: { band_list: [
      ...rows, { band: { band_no: 123456789, name: '중첩' }, can_write_post: false }, { band_no: '987654321', name: '비공개 합성 밴드' },
    ] } }))).toEqual([
      { key: '987654321', name: '비공개 합성 밴드' }, { key: '876543219', name: '다른 합성 밴드', writable: true }, { key: '123456789', name: '중첩', writable: false },
    ]);
  });
  it.each(['broken', '{"result_code":0,"result_data":{"bands":[]}}', '{"errors":[]}', '{"result_data":{"unexpected":true}}'])('rejects invalid or failed payloads: %s', body => expect(parseBandList(body)).toBeUndefined());
  it('recognizes an explicit empty list', () => expect(parseBandList('{"result_code":1,"result_data":{"bands":[]}}')).toEqual([]));
});
