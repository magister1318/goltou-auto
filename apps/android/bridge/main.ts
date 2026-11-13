// Reference: ../refs/DAF/daf3/apps/mobile/src/core/main.ts (embedded Node startup arguments).
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { AppCore, ChannelRegistrationRunner, goltouPhotoUrl, NativeBridge, startCore, fileMediaStorage, type CoreOptions } from '../../../packages/core/src/index';
import { createApiClient } from '../../../packages/api-client/src/index';
import { apiOrigin } from './config';
declare const __GOLTOU_DEBUG__: boolean;
import { AndroidTokenStore } from './session';
import { AiModeClient } from '../../../packages/sites/src/ai-mode';
import { AndroidSurfaceHost } from './host';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`MISSING_ARGUMENT ${name}`);
  return value;
}

const native = new NativeBridge();
const host = new AndroidSurfaceHost(native, argument('devtools'));
const ai = new AiModeClient(host);
const options: CoreOptions = {
  native, host,
  band: { host, capture: (surface, name) => host.capture(surface, name) },
  blog: {
    host, ...(__GOLTOU_DEBUG__ ? { draftSaveLimit: 1 } : {}), capture: (surface, name) => host.capture(surface, name),
    recordFailure: async failure => {
      const directory = path.join(path.dirname(argument('data')), 'wp5');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `job-${failure.jobId}-step-${failure.step}.json`), JSON.stringify({ at: new Date().toISOString(), ...failure }));
    },
  },
  preparation: {
    polish: ai.polish, ai,
    media: {
      storage: fileMediaStorage(path.join(path.dirname(argument('data')), 'wp4-media')),
      allowUrl: goltouPhotoUrl,
      fetcher: fetch,
    },
  },
  port: Number(argument('port')), token: argument('token'), uiDir: path.join(argument('bundle'), 'ui'),
};
async function start() {
  const app = new AppCore(createApiClient(apiOrigin, fetch), new AndroidTokenStore(native),
    (checkpoint, notify) => new ChannelRegistrationRunner({ band: options.band!, blog: options.blog! }, checkpoint, notify), options.preparation,
    { device: () => native.call('session.device'), ...(__GOLTOU_DEBUG__ ? { experimentTitle: true } : {}) });
  options.app = app;
  if (__GOLTOU_DEBUG__ && argument('debug') === 'true') {
    const { Experiments } = await import('../../../packages/core/src/experiments');
    const { auditConversions } = await import('../../../packages/core/src/conversion-audit');
    options.experiments = new Experiments({
      host, directory: argument('data'),
      photoPaths: Array.from({ length: 5 }, (_, i) => path.join(argument('bundle'), 'fixtures', `sample-${i + 1}.png`)),
      info: async () => ({ ...await native.call<Record<string, unknown>>('debug.info'), node: process.version }),
      lifecycle: async mode => { await native.call('debug.lifecycle', { mode }); },
      capture: (surface, name) => host.capture(surface, name),
      conversionCheck: check => app.auditProducts((api, token) => auditConversions(api, token, async result => {
        const directory = path.join(path.dirname(argument('data')), 'wp7');
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, 'conversion.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
      }, check)),
    });
  }
  return startCore(options);
}
void start().then(() => console.log('골투오토 코어 준비됨')).catch(error => {
  console.error('코어 시작 실패');
  // Keep the embedded runtime alive; the shell reports a health-check timeout.
  setInterval(() => {}, 60000);
});
