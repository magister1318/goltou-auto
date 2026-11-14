import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeApi, fakeAccounts } from '@goltou/api-client';
import { AppCore, MemoryTokenStore } from '../src/app';
import type { AppRequest, Job, JobInput } from '../src/protocol';
import { updateInputProgress } from '../src/input-progress';
const apps: AppCore[] = [];
afterEach(() => apps.splice(0).forEach((app) => app.dispose()));
async function fixture() {
  const api = createFakeApi({
    token: 'fixture-session',
    user: fakeAccounts.manager!,
  });
  const spy = vi.spyOn(api, 'request'),
    openExternal = vi.fn(async () => {});
  const tokens = new MemoryTokenStore();
  await tokens.write('fixture-session');
  const app = new AppCore(api, tokens, undefined, undefined, {
    device: async () => ({ kind: 'fixture', model: '', appVersion: '' }),
    openExternal,
  });
  apps.push(app);
  const call = (command: AppRequest['command'], input: unknown = {}) =>
    app.handle({ type: 'app', id: 1, command, input } as AppRequest);
  await call('session.get');
  spy.mockClear();
  return { app, call, spy, openExternal };
}
describe('WP16 app boundaries', () => {
  it('rejects Band drafts before reading a product or creating any record', async () => {
    const f = await fixture();
    const input: JobInput = {
      productNo: 1234,
      mode: 'draft',
      targets: [{ channel: 'band', key: 'fixture', name: '시험' }],
      options: { polish: false, closing: false, linkCard: false },
    };
    await expect(f.call('job.start', input)).rejects.toThrow(
      '임시저장은 네이버 블로그만',
    );
    expect(f.spy).not.toHaveBeenCalled();
  });
  it('has no command that reveals a job surface', async () => {
    const f = await fixture();
    await expect(f.call('draft.show', { title: '합성' })).rejects.toMatchObject(
      { code: 'invalid' },
    );
    await expect(f.call('band.show', { key: 'fixture' })).rejects.toMatchObject(
      { code: 'invalid' },
    );
  });
  it('opens only HTTPS post destinations through the injected platform capability', async () => {
    const f = await fixture();
    for (const url of [
      'https://blog.naver.com/fixture/1',
      'https://band.us/band/111/post/1001',
    ])
      await f.call('post.open', { url });
    expect(f.openExternal).toHaveBeenCalledTimes(2);
    for (const url of [
      'http://blog.naver.com/fixture/1',
      'https://band.us/login',
      'https://band.us.evil.test/band/111/post/1',
      'file:///private',
      'https://user@blog.naver.com/fixture/1',
    ])
      await expect(f.call('post.open', { url })).rejects.toMatchObject({
        code: 'invalid',
      });
    expect(f.openExternal).toHaveBeenCalledTimes(2);
  });
  it('retains content-free boundaries without unbounded growth from repeated prefix signals', () => {
    const job = { message: '' } as Job;
    for (let n = 0; n < 10000; n++)
      updateInputProgress(job, {
        characters: n,
        totalCharacters: 10000,
        photos: 0,
        totalPhotos: 1,
        activity: {
          channel: 'band',
          stage: 'write',
          phase: 'progress',
          blockIndex: 0,
          blockTotal: 2,
          blockKind: 'title',
          fraction: n / 10000,
        },
      });
    expect(job.activityLog).toHaveLength(1);
    expect(job.activity?.fraction).toBe(0.9999);
    expect(Object.keys(job.activity!)).not.toContain('text');
  });
});
