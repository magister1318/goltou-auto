import { expect, it } from 'vitest';
import { createFakeApi, fakeAccounts, type ApiClient, type ApiRoutes, type PostUpdate } from '@goltou/api-client';
import { AppCore, MemoryTokenStore } from '../src/app';
import type { AppRequest, Job } from '../src/protocol';
import type { RegistrationRunner } from '../src/runner';
import { fixtureProduct } from './fixtures/catalog';

it.each([false, true])('persists a Band receipt through the real app checkpoint before verification, including later mismatch=%s', async mismatch => {
  const token = 'synthetic', fake = createFakeApi({ token, user: fakeAccounts.manager! }), updates: PostUpdate[] = [];
  const api: ApiClient = { request: async <P extends keyof ApiRoutes>(route: P, input: ApiRoutes[P]['input'], bearer?: string): Promise<ApiRoutes[P]['output']> => {
    if (route === '/auto/products/get') return fixtureProduct('<p>합성 본문</p>', 0) as ApiRoutes[P]['output'];
    if (route === '/auto/posts/start') return { postNo: 91 } as ApiRoutes[P]['output'];
    if (route === '/auto/posts/update') { updates.push(structuredClone(input as PostUpdate)); return {} as ApiRoutes[P]['output']; }
    return fake.request(route, input, bearer);
  } };
  const tokens = new MemoryTokenStore(); await tokens.write(token);
  let finish!: () => Promise<void>;
  const url = 'https://band.us/band/111/post/9001';
  const app = new AppCore(api, tokens, checkpoint => {
    let current: Job | null = null;
    const runner: RegistrationRunner = { get job() { return current; }, stop: async () => {}, resume: async () => {}, dispose() {},
      start: async (input, title) => {
        const job: Job = { id: 1, startedAt: 1700000000000, productNo: input.productNo, title, mode: 'publish', targets: input.targets,
          targetResults: [{ ...input.targets[0]!, status: 'running', postUrl: url }], status: 'running', step: 6, current: 0, total: 0, completedSteps: [], service: null, message: '', publicationUncertain: true };
        current = job; await checkpoint(job);
        finish = async () => {
          job.publicationUncertain = false; job.status = mismatch ? 'failed' : 'published';
          job.targetResults![0]!.status = mismatch ? 'failed' : 'published';
          if (mismatch) { job.failureCode = 'BAND_PUBLISHED_READBACK_MISMATCH'; job.targetResults![0]!.reason = job.failureCode; }
          await checkpoint(job);
        };
      },
    }; return runner;
  });
  try {
    await app.restoreSession();
    await app.handle({ id: 1, type: 'app', command: 'job.start', input: { productNo: 4, mode: 'publish', publishConfirmed: true, targets: [{ channel: 'band', key: '111', name: '합성' }], options: { polish: false, closing: false, linkCard: false } } } as AppRequest);
    expect(updates.at(-1)).toMatchObject({ postNo: 91, status: 'running', postUrl: url });
    await finish();
    expect(updates.at(-1)).toMatchObject({ postNo: 91, status: mismatch ? 'failed' : 'published', postUrl: url, failReason: mismatch ? 'BAND_PUBLISHED_READBACK_MISMATCH' : '' });
  } finally { app.dispose(); }
});
