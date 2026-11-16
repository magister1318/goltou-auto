import { existsSync } from 'node:fs';
import { JobLogStore } from '../../../packages/core/src/job-logs';
import { configureTrace, trace, reasonCode } from '../../../packages/surface/src/telemetry';
declare const __GOLTOU_COMMIT__: string;
declare const __GOLTOU_VERSION__: string;
// Reference: ../refs/DAF/daf3/apps/mobile/src/core/main.ts (embedded Node startup arguments).
import path from 'node:path';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { AppCore, ChannelRegistrationRunner, goltouPhotoUrl, NativeBridge, startCore, fileMediaStorage, filePolishStrengthStore, type CoreOptions } from '../../../packages/core/src/index';
import { createApiClient } from '../../../packages/api-client/src/index';
import { apiOrigin } from './config';
declare const __GOLTOU_DEBUG__: boolean;
import { AndroidTokenStore } from './session';
import { AiModeClient } from '../../../packages/sites/src/ai-mode';
import { AndroidSurfaceHost } from './host';
import { filePreferencesStore } from '../../../packages/core/src/preferences';
import { fileBandPostAllowance } from '../../../packages/core/src/band-allowance';
import { filePostMetadata } from '../../../packages/core/src/post-metadata';
import { fileBlogTitleStore } from '../../../packages/core/src/blog-title-store';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`MISSING_ARGUMENT ${name}`);
  return value;
}

const native = new NativeBridge();
const host = new AndroidSurfaceHost(native, argument('devtools'));
const ai = new AiModeClient(host);
const logs = new JobLogStore(path.join(path.dirname(argument('data')), 'logs'));
configureTrace(logs);
logs.setEnvironment({ appVersion: __GOLTOU_VERSION__, commit: __GOLTOU_COMMIT__ });
const recordBandBarrierDecision = (code: import('../../../packages/sites/src/index').BandBarrierCode) => trace('barrier', /BLOCK|MISSING|INCOMPLETE|MISMATCH|NOT_ARMED|ALREADY_SENT|BODY_/.test(code) ? 'fail' : 'ok', { reason: reasonCode(code) });
const options: CoreOptions = {
  native, host,
  diagnostics: __GOLTOU_DEBUG__,
  band: { host, recordBarrierDecision: recordBandBarrierDecision, publishEnabled: !__GOLTOU_DEBUG__, ...(__GOLTOU_DEBUG__ ? { publishAllowance: fileBandPostAllowance(path.join(path.dirname(argument('data')), 'one-band-post.allow')) } : {}), ...(__GOLTOU_DEBUG__ ? { capture: (surface: import('../../../packages/surface/src/index').Surface, name: string) => host.capture(surface, name) } : {}) },
  blog: {
    lastTypedTitle: fileBlogTitleStore(path.join(path.dirname(argument('data')), 'last-blog-title.txt')),
    host, publishEnabled: true, ...(__GOLTOU_DEBUG__ ? { draftSaveLimit: 1, capture: (surface: import('../../../packages/surface/src/index').Surface, name: string) => host.capture(surface, name) } : {}),

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
  const runtime: NonNullable<ConstructorParameters<typeof AppCore>[4]> = { logs, exportLogs: async () => { logs.retain(); await native.call('logs.export'); }, ...(__GOLTOU_DEBUG__ && existsSync(path.join(path.dirname(argument('data')), 'band-only-test')) ? { serviceChecks: ['band'] as const } : {}), openExternal: async url => { await native.call('app.openPost', { url }); }, deleteHost: host, postMetadata: filePostMetadata(path.join(path.dirname(argument('data')), 'post-metadata.json')), device: () => native.call<import('../../../packages/api-client/src/index').LoginInput['device']>('session.device'), preferences: filePreferencesStore(path.join(path.dirname(argument('data')), 'preferences.json')), polishStrength: filePolishStrengthStore(path.join(path.dirname(argument('data')), 'polish-strength.txt')), ...(__GOLTOU_DEBUG__ ? { experimentTitle: false, experimentTitleLabel: 'WP14 ' } : {}) };
  runtime.bandDeleteLog = event => {
    trace('delete', /REJECT|BLOCK|FAILED|UNCERTAIN|TIMEOUT|NOT_STARTED/.test(event.code) ? 'fail' : 'ok', { reason: reasonCode(event.code) });
    if (event.checks) {
      const checks = [['alert_kind', event.checks.alert, true], ['delete_notice', event.checks.missingMessage, true], ['same_post', event.checks.samePost, true], ['missing_read', event.checks.missingRead, true], ['feed_location', event.checks.feed, false]] as const;
      for (const [check, observed, expected] of checks) trace('verification', observed === expected ? 'ok' : 'wait', { check, counts: { expected: Number(expected), observed: Number(observed) } });
    }
    for (const status of event.resultCodes ?? []) trace('delete', 'ok', { reason: reasonCode(event.code), counts: { status } });
  };
  runtime.deleteLog = async value => trace('delete', value.pass ? 'ok' : 'fail', { ...(value.pass ? {} : { reason: 'VERIFICATION_MISMATCH' as const }), counts: { step: value.item, expected: value.expected ?? 0, observed: value.actual ?? 0 } });
  const app = new AppCore(createApiClient(apiOrigin, fetch), new AndroidTokenStore(native),
    (checkpoint, notify) => new ChannelRegistrationRunner({ band: options.band!, blog: options.blog! }, checkpoint, notify), options.preparation,
    runtime);
  options.app = app;
  let awake = false;
  app.subscribe(snapshot => { const next = !!snapshot.job && ['running', 'recovery_paused', 'dialog_paused', 'login_paused'].includes(snapshot.job.status); if (next !== awake) { awake = next; void native.call('app.jobState', { running: next }).catch(() => {}); } });
  void native.ready().then(async () => { logs.setEnvironment({ ...await native.call<{ appVersion: string; deviceModel: string; webViewVersion: string }>('logs.environment'), commit: __GOLTOU_COMMIT__ }); app.serviceRuntimeReady(); }).catch(() => {});
  native.onEvent('app.foreground', data => { if (typeof data.backgroundMs === 'number') app.foregrounded(data.backgroundMs); });
  if (__GOLTOU_DEBUG__ && argument('debug') === 'true') {
    // A verified, guarded feed can be reviewed for device evidence. This is
    // display only; the shell consumes touches and never exposes service input.
    runtime.bandDeleteReview = async surface => {
      const u = new URL((await surface.readState()).url);
      if (!surface.restrictNavigation || !surface.onUserHidden || !['band.us', 'www.band.us'].includes(u.hostname) || !/^\/band\/\d+\/post$/.test(u.pathname)) throw Error('BAND_DELETE_REVIEW_REFUSED');
      await surface.restrictNavigation({ allowed: ['band.us', 'www.band.us'].map(hostname => ({ hostname, pathname: u.pathname })), landing: [], fallbackUrl: `https://band.us${u.pathname}` });
      let close!: () => void;
      const hidden = new Promise<void>(resolve => { close = resolve; });
      const unsubscribe = surface.onUserHidden(close);
      const timeout = setTimeout(close, 120000);
      try { await surface.show(); runtime.bandDeleteLog?.({ code: 'REVIEW_OPEN' }); await hidden; }
      finally { clearTimeout(timeout); unsubscribe(); await surface.hide(); runtime.bandDeleteLog?.({ code: 'REVIEW_CLOSED' }); }
    };
    const { Experiments } = await import('../../../packages/core/src/experiments');
    const { auditConversions } = await import('../../../packages/core/src/conversion-audit');
    const { deleteTestPost } = await import('../../../packages/core/src/test-post-delete');
    const { publishProbeShape } = await import('./publish-probe');
    const { publishResponseShape } = await import('./publish-response-shape');
    options.blog!.recordPublishResponse = async response => {
      const shape = publishResponseShape(response);
      const directory = path.join(path.dirname(argument('data')), 'wp14');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'publish-response-shape.json'), JSON.stringify(shape), { mode: 0o600 });
    };
    options.experiments = new Experiments({
      host, directory: argument('data'),
      photoPaths: Array.from({ length: 5 }, (_, i) => path.join(argument('bundle'), 'fixtures', `sample-${i + 1}.png`)),
      info: async () => ({ ...await native.call<Record<string, unknown>>('debug.info'), node: process.version }),
      lifecycle: async mode => { await native.call('debug.lifecycle', { mode }); },
      capture: (surface, name) => host.capture(surface, name),
      verifyBandPublish: async () => {
        if (app.snapshot().job?.status === 'running') throw Error('JOB_RUNNING');
        const { recoverBandPublish } = await import('./band-publish-recovery');
        const ready = async () => { if (!(await native.call<{ ready: boolean }>('app.inputState')).ready) throw Error('DEVICE_CONDITION_LOST'); };
        await ready();
        const token = await new AndroidTokenStore(native).read();
        if (!token) throw Error('BAND_PUBLISH_RECOVERY_REFUSED');
        await recoverBandPublish(path.join(path.dirname(argument('data')), 'wp19', 'band-publish-context.json'), createApiClient(apiOrigin, fetch), token, host, ready);
      },
      inspectRecordedPost: async () => {
        const { inspectRecordedPost } = await import('./publish-recovery');
        const ready = async () => {
          const state = await native.call<{ foreground: boolean; windowFocused: boolean; screenOn: boolean }>('debug.info');
          if (!state.foreground || !state.windowFocused || !state.screenOn) throw new Error('DEVICE_CONDITION_LOST');
        };
        const token = await new AndroidTokenStore(native).read();
        if (!token) throw new Error('BLOG_POST_READ_REFUSED');
        await inspectRecordedPost(path.join(path.dirname(argument('data')), 'wp14', 'record-delete-context.json'), createApiClient(apiOrigin, fetch), token, host, ready);
      },
      verifyPrivatePublish: async () => {
        if (app.snapshot().job?.status === 'running') throw new Error('JOB_RUNNING');
        const { recoverPrivatePublish } = await import('./publish-recovery');
        const ready = async () => {
          const state = await native.call<{ foreground: boolean; windowFocused: boolean; screenOn: boolean }>('debug.info');
          if (!state.foreground || !state.windowFocused || !state.screenOn) throw new Error('DEVICE_CONDITION_LOST');
        };
        await ready();
        const token = await new AndroidTokenStore(native).read();
        if (!token) throw new Error('BLOG_PUBLISH_RECOVERY_REFUSED');
        await recoverPrivatePublish(path.join(path.dirname(argument('data')), 'wp14', 'private-publish-context.json'), createApiClient(apiOrigin, fetch), token, host, ready);
      },
      deleteTestPost: async checkOnly => {
        const { recoverTestPostCleanup, protectCleanupInputs } = await import('./test-post-recovery');
        const ready = async () => {
          const state = await native.call<{ foreground: boolean; windowFocused: boolean; screenOn: boolean }>('debug.info');
          if (!state.foreground || !state.windowFocused || !state.screenOn) throw new Error('DEVICE_CONDITION_LOST');
        };
        await ready();
        if (app.snapshot().job && !checkOnly) return app.cleanupTestPost(async execution => {
          if (!execution.surface) throw new Error('BLOG_TEST_DELETE_REFUSED');
          protectCleanupInputs(execution.surface, ready);
          await deleteTestPost(execution, async value => {
            const directory = path.join(path.dirname(argument('data')), 'wp14');
            await mkdir(directory, { recursive: true });
            await writeFile(path.join(directory, 'cleanup-shape.json'), JSON.stringify(value), { mode: 0o600 });
          });
        });
        const token = await new AndroidTokenStore(native).read();
        if (!token) throw new Error('BLOG_TEST_DELETE_REFUSED');
        await recoverTestPostCleanup(path.join(path.dirname(argument('data')), 'wp14', 'cleanup-context.json'), createApiClient(apiOrigin, fetch), token, host, ready, checkOnly);
      },
      configurePublishProbe: visibility => {
        if (app.snapshot().job?.status === 'running') throw new Error('JOB_RUNNING');
        runtime.experimentTitle = visibility !== 'off';
        runtime.experimentTitleLabel = `WP14 probe-${visibility} `;
        if (visibility === 'off') { delete options.blog!.publishProbe; return; }
        options.blog!.publishProbe = { visibility, record: async (request, proof) => {
          const directory = path.join(path.dirname(argument('data')), 'wp14');
          await mkdir(directory, { recursive: true });
          await writeFile(path.join(directory, `probe-${visibility}.json`), JSON.stringify(publishProbeShape(request, proof), null, 2), { mode: 0o600 });
        } };
      },
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
