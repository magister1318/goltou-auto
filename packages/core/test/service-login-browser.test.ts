import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import type { SurfaceHost } from '@goltou/surface';
import { CdpConnection, CdpSurface } from '@goltou/surface/cdp';
import { ServiceLoginController, type LoginUpdate } from '../src/service-login';

const executablePath = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
describe.runIf(Boolean(executablePath))('WP15 browser authentication fixtures (no real service traffic)', () => {
  it.each(['naver', 'band'] as const)('loads %s, detects a simulated post-login redirect and auto-hides with read-only indicators', async service => {
    const browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--disable-background-networking', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
    cleanup.push(() => browser.close());
    const context = await browser.newContext();
    let authenticated = false, shown = false, shows = 0, hides = 0, blocked = 0;
    const requests: string[] = [], expressions: string[] = [];
    await context.route('**/*', async route => {
      requests.push(route.request().url());
      const url = new URL(route.request().url());
      if (!['m.blog.naver.com', 'nid.naver.com', 'band.us', 'auth.band.us'].includes(url.hostname)) { blocked++; await route.abort(); return; }
      if (url.hostname === 'm.blog.naver.com' || url.hostname === 'band.us' || url.pathname === '/user2/help/myInfoV2') {
        if (authenticated) { await route.fulfill({ contentType: 'text/html', body: '<a href="/logout">로그아웃</a><div class="globalMyBandWrap"></div>' }); return; }
      }
      await route.fulfill({ contentType: 'text/html', body: '<input type="text" value="PRIVATE"><input type="password" value="PRIVATE"><button id="finish" onclick="location.href=\'' + (service === 'naver' ? 'https://m.blog.naver.com/' : 'https://band.us/') + '\'">인증 완료 fixture</button>' });
    });
    let page: Awaited<ReturnType<typeof context.newPage>>;
    const host: SurfaceHost = {
      async create(session) {
        page = await context.newPage(); const cdp = await context.newCDPSession(page);
        const shim = { send: async (method: string, params: object) => {
          if (method === 'Runtime.evaluate') { const p = params as { expression: string; throwOnSideEffect: boolean }; expressions.push(p.expression); expect(p.throwOnSideEffect).toBe(true); }
          return cdp.send(method as never, params as never);
        }, on: (method: string, fn: (p: Record<string, unknown>) => void) => { cdp.on(method as never, fn); return () => cdp.off(method as never, fn); }, close: () => { void cdp.detach().catch(() => {}); }, isOpen: true };
        return new CdpSurface(session, shim as unknown as CdpConnection, {
          // Native enforcement is covered by NavigationPolicyTest; this fixture tests controller/CDP/readers.
          restrictNavigation: async () => {},
          setVisible: async value => { shown = value; if (value) shows++; else hides++; }, close: async () => { await page.close(); },
        }, 0);
      }, destroy: async s => { await s.close(); }, clearSession: async () => { throw Error('PROFILE_CLEAR_FORBIDDEN'); },
    };
    const controller = new ServiceLoginController(host, { pollMs: 100, signalMs: 1500, loadMs: 4000 });
    cleanup.push(async () => controller.dispose());
    const updates: LoginUpdate[] = []; controller.subscribe(u => updates.push(u));
    await controller.show(service); expect(shown).toBe(true); expect(shows).toBe(1);
    authenticated = true;
    // This click stands in for the service completing authentication, without entering any credential.
    await page!.locator('#finish').click();
    await expect.poll(() => updates.at(-1)?.state).toBe('confirmed');
    expect(shown).toBe(false); expect(hides).toBe(1); expect(controller.active).toBe(false);
    await controller.show(service); expect(shows).toBe(1); expect(updates.at(-1)).toMatchObject({ state: 'confirmed', visible: false });
    expect(blocked).toBe(0); expect(requests.length).toBeGreaterThan(2);
    expect(expressions.join(' ')).not.toMatch(/document\.cookie|\.value|localStorage|sessionStorage/);
  }, 15000);
});
