import { latest, type ApiClient } from '../../../packages/api-client/src/index';
import { AppUpdater } from '../../../packages/core/src/app-update';
import { fileUpdateStore } from '../../../packages/core/src/app-update-store';
import type { NativeBridge } from '../../../packages/core/src/native';
import type { JobLogStore } from '../../../packages/core/src/job-logs';
import type { UpdateDiagnostic } from '../../../packages/surface/src/update-diagnostics';
import type { TokenStore } from '../../../packages/core/src/protocol';

export function androidUpdater(native: NativeBridge, api: ApiClient, tokens: TokenStore, logs: JobLogStore, file: string, apiBase: string) {
  const updater = new AppUpdater({ logs, store: fileUpdateStore(file),
    latest: async log => latest(api, await tokens.read() ?? '', log),
    port: {
      info: async () => {
        await native.ready();
        const info = await native.call<{ appVersion: string; versionCode?: number }>('logs.environment');
        if (!Number.isSafeInteger(info.versionCode) || info.versionCode! < 1) throw Error('UPDATE_METADATA_INVALID');
        return { name: info.appVersion, code: info.versionCode! };
      },
      download: async release => { await native.call('update.download', { release, apiBase }, 30 * 60 * 1000); },
      cancel: async () => { await native.call('update.cancel'); },
      install: async () => (await native.call<{ status: 'permission' | 'launched' }>('update.install')).status,
      settings: async () => { await native.call('update.settings'); },
    },
  });
  native.onEvent('update.progress', data => { if (typeof data.bytes === 'number') updater.progress(data.bytes); });
  native.onEvent('update.log', data => {
    // Controller logs and persistent store both project to explicit fixed fields.
    if (data.event === 'installer_result') {
      const log = logs.begin('app_update', 'app');
      log.line('update', 'ok', { update: { event: 'installer_result', status: typeof data.status === 'number' ? data.status : -1 } });
      log.end('succeeded');
    } else updater.diagnostic(data as unknown as UpdateDiagnostic);
  });
  native.onEvent('app.foreground', () => { void updater.resume(); });
  void native.ready().then(() => updater.initialize()).catch(() => {});
  return updater;
}
