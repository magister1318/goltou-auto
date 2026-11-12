// Reference: ../refs/DAF/daf3/apps/mobile/src/core/cdp.ts (private socket target discovery).
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Surface, SurfaceHost, SurfaceSession } from '../../../packages/surface/src/index';
import { CdpConnection, CdpSurface } from '../../../packages/surface/src/cdp/index';
import { NativeBridge } from '../../../packages/core/src/native';

interface Target { url: string; webSocketDebuggerUrl?: string }

function listTargets(socketPath: string): Promise<Target[]> {
  return new Promise((resolve, reject) => {
    const request = http.get({ socketPath, path: '/json/list', headers: { Host: 'localhost' }, timeout: 3000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += String(chunk); });
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('DEVTOOLS_LIST_FAILED');
          resolve(JSON.parse(body) as Target[]);
        } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('DEVTOOLS_LIST_TIMEOUT')));
    request.on('error', reject);
  });
}

export class AndroidSurfaceHost implements SurfaceHost {
  private readonly surfaces = new Map<Surface, string>();
  constructor(private readonly native: NativeBridge, private readonly socketPath: string) {}

  async create(session: SurfaceSession): Promise<Surface> {
    const id = randomUUID();
    const marker = `goltou-${id}`;
    await this.native.call('surface.create', { surface: id, session, marker });
    try {
      const deadline = Date.now() + 10000;
      let endpoint: string | undefined;
      while (!endpoint && Date.now() < deadline) {
        endpoint = (await listTargets(this.socketPath)).find(target => target.url === `about:blank#${marker}`)?.webSocketDebuggerUrl;
        if (!endpoint) await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!endpoint) throw new Error('DEVTOOLS_TARGET_NOT_FOUND');
      const cdp = await CdpConnection.connect(endpoint, { socketPath: this.socketPath });
      let unsubscribe = () => {};
      const surface = new CdpSurface(session, cdp, {
        readDialog: async () => (await this.native.call<{ dialog: import('../../../packages/surface/src/index').SurfaceDialog | null }>('surface.dialog', { surface: id })).dialog,
        respondDialog: async (dialog, accept) => { await this.native.call('surface.dialog.answer', { surface: id, dialog, accept }); },
        setVisible: async visible => { await this.native.call('surface.visible', { surface: id, visible }); },
        close: async () => {
          unsubscribe();
          this.surfaces.delete(surface);
          await this.native.call('surface.destroy', { surface: id });
        },
      });
      unsubscribe = this.native.onEvent('surface.hidden', data => {
        if (data.surface === id) void surface.hide().catch(() => {});
      });
      this.surfaces.set(surface, id);
      return surface;
    } catch (error) {
      await this.native.call('surface.destroy', { surface: id }).catch(() => {});
      throw error;
    }
  }

  async destroy(surface: Surface): Promise<void> {
    if (!this.surfaces.has(surface)) return;
    await surface.close();
  }

  async clearSession(session: SurfaceSession): Promise<void> {
    for (const surface of this.surfaces.keys()) if (surface.session === session) await this.destroy(surface);
    await this.native.call('profile.clear', { session }, 120000);
  }

  async capture(surface: Surface, name: string): Promise<Record<string, unknown>> {
    const id = this.surfaces.get(surface);
    if (!id) throw new Error('NO_SURFACE');
    const geometry = await surface.evaluateReadOnly<{ sensitive: boolean; viewportWidth: number; viewportHeight: number; masks: number[][] }>(`(() => {
      const sensitive=location.hostname==='nid.naver.com'||location.hostname==='auth.band.us'||Boolean(document.querySelector('input[type="password"]'));
      const masks=[];
      for (const e of document.querySelectorAll('*')) {
        const tag=e.tagName.toLowerCase();
        if (['script','style','head','link','meta'].includes(tag)) continue;
        if (['input','textarea','img','svg','canvas','video','iframe'].includes(tag) || getComputedStyle(e).backgroundImage!=='none' || Array.from(e.childNodes).some(n=>n.nodeType===3&&(n.textContent||'').trim())) {
          const r=e.getBoundingClientRect(); if(r.width&&r.height) masks.push([r.left,r.top,r.right,r.bottom]);
        }
      }
      return {sensitive,viewportWidth:innerWidth,viewportHeight:innerHeight,masks};
    })()`);
    if (!(surface instanceof CdpSurface)) throw new Error('CAPTURE_UNAVAILABLE');
    const screenshot = geometry.sensitive ? '' : await surface.captureViewport();
    return this.native.call('debug.capture', { surface: id, name, screenshot, ...geometry });
  }
}
