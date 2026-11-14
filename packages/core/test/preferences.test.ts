import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AppCore } from '../src/app';
import { defaultPreferences, filePreferencesStore } from '../src/preferences';
describe('WP16 preferences survive core and storage recreation', () => {
  it('keeps optional features off initially and restores toggles and the last Band without any network', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'goltou-prefs-'));
    const file = path.join(directory, 'preferences.json');
    const api = { request: vi.fn() };
    const make = () => new AppCore(api, undefined, undefined, undefined, { device: vi.fn(), preferences: filePreferencesStore(file) });
    const first = make();
    try {
      expect(await first.handle({ id: 1, type: 'app', command: 'preferences.get', input: {} })).toEqual(defaultPreferences());
      const value = { polish: true, closing: true, linkCard: true, lastBandKey: 'fixture' };
      await first.handle({ id: 2, type: 'app', command: 'preferences.save', input: value });
      first.dispose();
      const restarted = make();
      try { expect(await restarted.handle({ id: 3, type: 'app', command: 'preferences.get', input: {} })).toEqual(value); }
      finally { restarted.dispose(); }
      expect(api.request).not.toHaveBeenCalled();
    } finally { first.dispose(); await rm(directory, { recursive: true, force: true }); }
  });
});
