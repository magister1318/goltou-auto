import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { NavigationPolicy, SurfaceHost } from '@goltou/surface';
import type { CdpConnection } from '@goltou/surface/cdp';
import type { ServiceLoginController } from '../src/service-login';

it('release variant checks a fresh Band redirect and opens both real login routes with native navigation rules', async () => {
  const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
  if (!executablePath) throw Error('LOCAL_CHROMIUM_REQUIRED');
  await mkdir('tmp', { recursive: true });
  const directory = await mkdtemp(path.resolve('tmp/release-connection-'));
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ['--disable-background-networking', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND'] });
  let controller: ServiceLoginController | undefined;
  try {
    const compiled = path.join(directory, 'connection.cjs');
    await build({ stdin: { contents: `export { ServiceLoginController } from './packages/core/src/service-login';
      export { CdpSurface } from './packages/surface/src/cdp';
      export { configureTrace } from './packages/surface/src/telemetry';
      export { JobLogStore } from './packages/core/src/job-logs';
      export { matchesNavigation } from './packages/surface/src';`, resolveDir: process.cwd() },
      outfile: compiled, bundle: true, platform: 'node', target: 'node18', format: 'cjs', minifySyntax: true,
      external: ['bufferutil', 'utf-8-validate'], define: { __GOLTOU_DEBUG__: 'false' } });
    const release = createRequire(import.meta.url)(compiled) as {
      ServiceLoginController: typeof ServiceLoginController;
      CdpSurface: typeof import('@goltou/surface/cdp').CdpSurface;
      matchesNavigation: typeof import('@goltou/surface').matchesNavigation;
      configureTrace: typeof import('@goltou/surface/telemetry').configureTrace;
      JobLogStore: typeof import('../src/job-logs').JobLogStore;
    };
    const visits: string[] = [], blocked: string[] = [], shown: string[] = [];
    const host: SurfaceHost = {
      async create(session) {
        const context = await browser.newContext();
        const page = await context.newPage();
        let policy: NavigationPolicy | undefined;
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (!['band.us', 'www.band.us', 'auth.band.us', 'nid.naver.com'].includes(url.hostname)) { await route.abort(); return; }
          if (route.request().isNavigationRequest() && page.mainFrame() === route.request().frame()) {
            visits.push(url.hostname + url.pathname);
            if (!policy || !release.matchesNavigation(url.href, [...policy.allowed, ...policy.landing])) {
              blocked.push(url.hostname + url.pathname); await route.abort(); return;
            }
          }
          if (url.hostname === 'band.us') {
            await route.fulfill({ contentType: 'text/html', body: '<script>location.replace("https://www.band.us/")</script>' }); return;
          }
          if (url.hostname === 'www.band.us' && url.pathname === '/') {
            await route.fulfill({ contentType: 'text/html', body: '<script>location.replace("/about/kr/intro")</script>' }); return;
          }
          if (url.hostname === 'www.band.us' && url.pathname === '/about/kr/intro') {
            await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<a href="https://auth.band.us/login">로그인</a>' }); return;
          }
          await route.fulfill({ contentType: 'text/html', body: '<input type="text"><input type="password">' });
        });
        const cdp = await context.newCDPSession(page);
        const shim = { send: (method: string, params: object) => cdp.send(method as never, params as never),
          on: (method: string, fn: (p: Record<string, unknown>) => void) => { cdp.on(method as never, fn); return () => cdp.off(method as never, fn); },
          close: () => { void cdp.detach().catch(() => {}); }, isOpen: true };
        return new release.CdpSurface(session, shim as unknown as CdpConnection, {
          restrictNavigation: async value => { policy = value; },
          setVisible: async value => {
            if (value) { expect(release.matchesNavigation(page.url(), policy!.allowed)).toBe(true); shown.push(new URL(page.url()).hostname + new URL(page.url()).pathname); }
          }, close: async () => { await context.close(); },
        }, 0);
      }, destroy: async surface => { await surface.close(); }, clearSession: async () => { throw Error('DATA_CLEAR_FORBIDDEN'); },
    };
    controller = new release.ServiceLoginController(host, { loadMs: 4000, signalMs: 1000, pollMs: 100 });
    const logs = new release.JobLogStore(path.join(directory, 'logs')); release.configureTrace(logs);
    expect(await controller.check('band'), JSON.stringify({ logs: logs.list(), visits, blocked })).toBe('expired');
    expect(visits).toContain('www.band.us/about/kr/intro');
    await controller.show('band');
    expect(shown).toEqual(['auth.band.us/login']);
    await controller.cancel();
    await controller.show('naver');
    expect(shown).toEqual(['auth.band.us/login', 'nid.naver.com/nidlogin.login']);
    await controller.cancel();
    expect(blocked).toEqual([]);
  } finally {
    controller?.dispose();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
