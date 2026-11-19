import { describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '@goltou/api-client';
import { AppCore, MemoryTokenStore } from '../src/app';
import { AppUpdater, type UpdateMemory } from '../src/app-update';
import { FakeRegistrationRunner } from '../src/runner';
import type { Job, AppRequest } from '../src/protocol';
describe('update commands share registration boundary', () => {
  it('suppresses checks/notice in dialog pause and starts the deferred manual check when notified final', async () => {
    const tokens = new MemoryTokenStore(); const api = createFakeApi();
    const { token } = await api.request('/auto/login', { loginId: 'manager', password: 'demo', device: { kind: 'fixture', model: 'fixture', appVersion: '1.0.4' } });
    await tokens.write(token);
    let memory: UpdateMemory = {};
    const latest = vi.fn(async () => ({ ready: true as const, version: '1.0.5 (9)', code: 9, date: '2026-11-20', size: 1, sha256: 'a'.repeat(64), url: 'auto_app/get/synthetic', expiresIn: 900 }));
    const updater = new AppUpdater({ latest, store: { read: async () => memory, write: async v => { memory = v; } },
      port: { info: async () => ({ name: '1.0.4', code: 8 }), download: async () => {}, cancel: async () => {}, install: async () => 'launched', settings: async () => {} } });
    let notify!: (job: Job) => void;
    const app = new AppCore(api, tokens, (checkpoint, onJob) => {
      notify = onJob; return new FakeRegistrationRunner(() => ({ tickMs: 10, loginAt: null, failAt: null }), checkpoint, onJob);
    }, undefined, { updater, device: async () => ({ kind: 'fixture', model: 'fixture', appVersion: '1.0.4' }) });
    const command = (command: 'update.check' | 'update.home') => app.handle({ id: 1, type: 'app', command, input: {} } as AppRequest);
    try {
      await app.initialize(); await command('update.check'); expect(app.snapshot().update?.notice).toBe(true);
      const job: Job = { id: 1, productNo: 1, title: '합성 작업', mode: 'draft', status: 'dialog_paused', step: 4, current: 0, total: 1, completedSteps: [], targets: [], service: null, message: '' };
      notify(job); expect(app.snapshot().update).toMatchObject({ notice: false, sheet: false });
      await command('update.check'); expect(latest).toHaveBeenCalledTimes(1);
      notify({ ...job, status: 'stopped' });
      await vi.waitFor(() => expect(latest).toHaveBeenCalledTimes(2));
      expect(app.snapshot().update).toMatchObject({ notice: true, sheet: true });
    } finally { app.dispose(); }
  });
});
