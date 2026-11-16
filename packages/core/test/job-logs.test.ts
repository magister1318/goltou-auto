import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobLogStore } from '../src/job-logs';
import { configureTrace, trace, traceJob, traceStep, type JobKind, type TraceDetail, type TraceStep } from '@goltou/surface/telemetry';

const directories: string[] = [];
afterEach(() => { configureTrace(undefined); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(limits?: { days: number; bytes: number }, now?: () => number) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'goltou-job-logs-')); directories.push(dir);
  const store = new JobLogStore(dir, limits, now); configureTrace(store);
  const files = () => readdirSync(dir).filter(name => /^\d{8}$/.test(name)).flatMap(day => readdirSync(path.join(dir, day)).map(file => path.join(dir, day, file)));
  const lines = () => files().flatMap(file => readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)));
  return { dir, store, files, lines };
}
describe('permanent local job logs', () => {
  it('reconstructs the complete output from whitelisted fields, including hostile runtime callers', () => {
    const f = fixture();
    const secrets = ['password=p@ss-secret', 'Bearer eyJ.secret.token', 'session_cookie=secret', 'auth-header-secret', 'private-account-name', 'private-band-name', 'private-product-title', 'private-photo-content', '999888777666', 'PRIVATE_SECRET'];
    const poison = Object.fromEntries(secrets.map(value => [value, value]));
    const job = f.store.begin('band_post', 'band');
    for (const secret of secrets) {
      f.store.setEnvironment({ appVersion: secret, commit: secret, deviceModel: secret, webViewVersion: secret });
      job.line('barrier', 'fail', {
        ...poison, reason: secret, operation: secret, dialog: secret, selector: secret, check: secret,
        counts: { ...poison, expected: secret, observed: 3, bytes: Infinity },
        navigation: { host: secret, path: '/' + secret },
        network: { method: secret, host: secret, path: '/' + secret, contentType: secret, queryFields: [secret], bodyFields: [secret], decision: secret },
      } as unknown as TraceDetail);
    }
    job.end('failed', 'UNEXPECTED_FAILURE');
    for (const secret of secrets) f.store.begin('band_post', 'band').end('failed', secret as never);
    const output = f.files().map(file => readFileSync(file, 'utf8')).join('') + readFileSync(path.join(f.dir, 'index.json'), 'utf8');
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(f.lines()[1]).toMatchObject({ counts: { observed: 3 }, reason: 'UNEXPECTED_FAILURE', network: { decision: 'blocked', bodyFields: ['[other]'] } });
    expect(output).not.toContain('Infinity');
    expect(() => job.line('private-title' as TraceStep, 'ok')).not.toThrow(); // terminal jobs cannot emit anything
    const next = f.store.begin('login_check', 'naver');
    expect(() => next.line('private-title' as TraceStep, 'ok')).toThrow('INVALID_LOG_EVENT'); next.end('succeeded');
  });
  it('contains only request field names and normalized routes, with trusted environment metadata', () => {
    const f = fixture(); f.store.setEnvironment({ appVersion: '1.2.3', commit: 'abc123456789', webViewVersion: '142.0.7444.171', deviceModel: 'SM-S928N' });
    const job = f.store.begin('band_delete', 'band');
    job.line('barrier', 'ok', { reason: 'REQUEST_ALLOWED', navigation: { host: 'band.us', path: '/band/123456/post/78910' },
      network: { method: 'POST', host: 'api-kr.band.us', path: '/v1.5.0/delete_post', contentType: 'application/x-www-form-urlencoded', queryFields: ['version', 'token'], bodyFields: ['band_no', 'post_no'], decision: 'allowed' } });
    job.end('succeeded');
    expect(f.lines()[0].environment).toMatchObject({ deviceModel: 'SM-S928N', commit: 'abc123456789' });
    expect(f.lines()[1].navigation.path).toBe('/band/[id]/post/[id]');
    expect(JSON.stringify(f.lines()[1])).not.toMatch(/123456|78910/);
  });
  it('flushes each appended line before returning and preserves exactly one terminal', () => {
    const f = fixture(), job = f.store.begin('blog_draft', 'naver');
    job.line('runner.ready', 'start'); expect(f.lines().at(-1).step).toBe('runner.ready');
    job.end('uncertain', 'UNCERTAIN'); job.end('succeeded'); job.line('runner.record', 'ok');
    expect(f.lines().filter(line => line.step === 'terminal')).toHaveLength(1);
    expect(f.lines().at(-1)).toMatchObject({ step: 'terminal', result: 'uncertain', reason: 'UNCERTAIN' });
  });
  it('recovers a process-killed job and a partial final write once, without losing prior lines', () => {
    const f = fixture(), job = f.store.begin('band_post', 'band'); job.line('runner.band_write', 'start');
    appendFileSync(f.files()[0]!, '{"torn":');
    const restarted = new JobLogStore(f.dir);
    expect(restarted.list()[0]).toMatchObject({ result: 'stopped', reason: 'INTERRUPTED' });
    expect(f.lines().at(-1)).toMatchObject({ recovery: 'interrupted', step: 'terminal', result: 'stopped' });
    new JobLogStore(f.dir); expect(f.lines().filter(line => line.step === 'terminal')).toHaveLength(1);
    expect(f.lines().some(line => line.step === 'runner.band_write')).toBe(true);
  });
  it('recovers even a kill between file creation and the first completed line', () => {
    const f = fixture(); f.store.begin('band_post', 'band'); truncateSync(f.files()[0]!, 0);
    expect(new JobLogStore(f.dir).list()[0]).toMatchObject({ kind: 'band_post', result: 'stopped', reason: 'INTERRUPTED' });
    expect(f.lines().filter(line => line.step === 'terminal')).toHaveLength(1);
  });
  it('retains the actual runner failure phase when rebuilding the index after restart', () => {
    const f = fixture(), job = f.store.begin('band_post', 'band');
    job.line('job', 'fail', { reason: 'BAND_POST_UNCONFIRMED', counts: { step: 6 } }); job.end('uncertain', 'BAND_POST_UNCONFIRMED');
    expect(f.store.list()[0]?.failedStep).toBe('runner.band_write');
    expect(new JobLogStore(f.dir).list()[0]).toMatchObject({ failedStep: 'runner.band_write', result: 'uncertain', reason: 'BAND_POST_UNCONFIRMED' });
  });
  it('expires oldest completed jobs at either the day or byte limit and preserves active trails', () => {
    let now = Date.UTC(2026, 0, 1); const f = fixture({ days: 30, bytes: 2200 }, () => now);
    f.store.begin('blog_draft', 'naver').end('succeeded'); now += 31 * 86400000;
    f.store.begin('band_post', 'band').end('succeeded'); expect(f.store.list()).toHaveLength(1);
    const active = f.store.begin('band_delete', 'band');
    for (let n = 0; n < 10; n++) { now++; f.store.begin('login_check', 'band').end('succeeded'); }
    expect(f.store.list().some(row => row.jobId === active.id)).toBe(true);
    expect(f.store.list().length).toBeLessThan(11);
  });
  it.each([false, true])('stops before exceeding the byte limit, reserving a terminal line (submission=%s)', started => {
    const f = fixture({ days: 30, bytes: 5000 }), job = f.store.begin('band_post', 'band');
    if (started) job.line('sites.band.plan.BandExecution.publish', 'start');
    expect(() => { for (let i = 0; i < 100; i++) job.line('input.progress', 'wait', { counts: { attempt: i } }); }).toThrow('LOG_STORAGE_LIMIT');
    const terminals = f.lines().filter(line => line.step === 'terminal'); expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ reason: 'LOG_STORAGE_LIMIT', result: started ? 'uncertain' : 'failed' });
    const bytes = f.files().reduce((sum, file) => sum + readFileSync(file).length, 0) + readFileSync(path.join(f.dir, 'index.json')).length + 32;
    expect(bytes).toBeLessThanOrEqual(5000);
  });
  it('keeps asynchronous jobs separate and uses salted correlation without retaining the identity', async () => {
    const f = fixture(); const identity = 'private-post-12345';
    await Promise.all([traceJob('band_post', 'band', async () => { await Promise.resolve(); f.store.associate(identity); trace('runner.band_write', 'ok'); }), traceJob('login_check', 'naver', async () => { await Promise.resolve(); trace('runner.ready', 'ok'); })]);
    expect(f.store.forRecord(identity)?.kind).toBe('band_post');
    expect(JSON.stringify(f.lines())).not.toContain(identity);
    expect(new JobLogStore(f.dir).forRecord(identity)?.result).toBe('succeeded');
    expect(f.lines().filter(line => line.step === 'terminal')).toHaveLength(2);
    const other = fixture(); expect(other.store.identity(identity)).not.toBe(f.store.identity(identity));
  });
});

const sequences: Record<JobKind, TraceStep[]> = {
  blog_draft: ['runner.ready', 'runner.download', 'runner.arrange', 'runner.blog_write', 'runner.blog_save', 'runner.record'],
  blog_publish: ['runner.ready', 'runner.download', 'runner.arrange', 'runner.blog_write', 'runner.blog_save', 'runner.record'],
  blog_delete: ['core.post-delete.removeRecordedBlogPost', 'delete', 'verification', 'runner.record'],
  unfinished_cleanup: ['cleanup', 'verification'], band_post: ['runner.ready', 'runner.download', 'runner.arrange', 'runner.band_write', 'verification', 'runner.record'],
  band_delete: ['core.post-delete.removeRecordedBandPost', 'delete', 'verification', 'runner.record'],
  login_check: ['core.service-login.ServiceLoginController.load', 'core.service-login.ServiceLoginController.signal'], band_list: ['sites.band.plan.BandDirectory.list'],
};
describe('all job kinds and injected step failures', () => {
  for (const [kind, steps] of Object.entries(sequences) as [JobKind, TraceStep[]][]) {
    for (const failAt of [-1, ...steps.map((_, i) => i)]) {
      it(`${kind}: ordered steps, failure ${failAt}, one terminal`, async () => {
        const f = fixture();
        const run = traceJob(kind, kind.startsWith('blog') ? 'naver' : kind.startsWith('band') ? 'band' : 'app', async () => {
          for (const [index, step] of steps.entries()) await traceStep(step, async () => { if (index === failAt) throw Error('VERIFICATION_MISMATCH'); });
        });
        if (failAt >= 0) await expect(run).rejects.toThrow('VERIFICATION_MISMATCH'); else await run;
        expect(f.lines().filter(line => line.event === 'start' && line.step !== 'job').map(line => line.step)).toEqual(failAt < 0 ? steps : steps.slice(0, failAt + 1));
        const terminal = f.lines().filter(line => line.step === 'terminal'); expect(terminal).toHaveLength(1);
        expect(terminal[0].result).toBe(failAt < 0 ? 'succeeded' : 'failed');
      });
    }
  }
});
