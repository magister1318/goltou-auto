// Reference: ../refs/DAF/daf3/apps/mobile/src/core/main.ts (embedded Node startup arguments).
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { AppCore, MemoryTokenStore, ChannelRegistrationRunner, NativeBridge, startCore, fileMediaStorage, type CoreOptions } from '../../../packages/core/src/index';
import { createFakeApi, fakeAccounts } from '../../../packages/api-client/src/index';
import { aiModeTransport } from '../../../packages/sites/src/ai-mode';
import { AndroidSurfaceHost } from './host';
import { Experiments } from '../../../packages/core/src/experiments';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`MISSING_ARGUMENT ${name}`);
  return value;
}

const native = new NativeBridge();
const host = new AndroidSurfaceHost(native, argument('devtools'));
const experiments = argument('debug') === 'true' ? new Experiments({
  host, directory: argument('data'),
  photoPaths: Array.from({ length: 5 }, (_, i) => path.join(argument('bundle'), 'fixtures', `sample-${i + 1}.png`)),
  info: async () => ({ ...await native.call<Record<string, unknown>>('debug.info'), node: process.version, coreUptimeMs: Math.round(process.uptime() * 1000), unicodeNumberProperties: (() => { try { return new RegExp('\\p{N}', 'u').test('18'); } catch { return false; } })() }),
  lifecycle: async mode => { await native.call('debug.lifecycle', { mode }); },
  capture: (surface, name) => host.capture(surface, name),
}) : undefined;
const options: CoreOptions = {
  native, host, ...(experiments ? { experiments } : {}),
  band: { host, capture: (surface, name) => host.capture(surface, name) },
  blog: {
    host, capture: (surface, name) => host.capture(surface, name),
    recordFailure: async failure => {
      const directory = path.join(path.dirname(argument('data')), 'wp5');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `job-${failure.jobId}-step-${failure.step}.json`), JSON.stringify({ at: new Date().toISOString(), ...failure }));
    },
  },
  preparation: {
    polish: aiModeTransport(host),
    media: {
      storage: fileMediaStorage(path.join(path.dirname(argument('data')), 'wp4-media')),
      // The current app API is still synthetic. Its API URLs map only to bundled example bytes.
      // Real HTTP downloading is covered against a local server; no Goltou endpoint is configured.
      fetcher: async (url, init) => {
        init.signal.throwIfAborted();
        const match = /^https:\/\/example\.invalid\/images\/\d+\/([0-4])\.png$/.exec(url);
        if (!match) throw new Error('SYNTHETIC_PHOTO_REQUIRED');
        const bytes = await readFile(path.join(argument('bundle'), 'fixtures', `sample-${Number(match[1]) + 1}.png`));
        return { ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
      },
    },
  },
  port: Number(argument('port')), token: argument('token'), uiDir: path.join(argument('bundle'), 'ui'),
};
async function start() {
  // Explicit debug-only fixture: no /auto/login, credential input or Goltou network call.
  // Real service profiles are neither read here nor modified.
  if (argument('debug') === 'true' && argument('verification-fixture') === 'true') {
    const token = randomUUID();
    const tokens = new MemoryTokenStore(); await tokens.write(token);
    const title = argument('verification-title');
    const app = new AppCore(createFakeApi({ token, user: fakeAccounts.manager!, ...(title.startsWith('[골투오토 실험]') && title.length <= 160 ? { productTitle: title } : {}) }), tokens,
      (checkpoint, notify) => new ChannelRegistrationRunner({ band: options.band!, blog: options.blog! }, checkpoint, notify), options.preparation);
    await app.restoreSession(); options.app = app;
  }
  return startCore(options);
}
void start().then(() => console.log('골투오토 코어 준비됨')).catch(error => {
  console.error('코어 시작 실패', error);
  // Keep the embedded runtime alive; the shell reports a health-check timeout.
  setInterval(() => {}, 60000);
});
