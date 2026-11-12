import type { KeyInput, NavigationOptions, Surface, SurfaceOpenOptions, SurfaceSession, SurfaceState } from '../index';
import { CdpConnection } from './connection';
export { CdpConnection } from './connection';

export interface SurfaceLifecycle {
  setVisible(visible: boolean): Promise<void>;
  close(): Promise<void>;
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const keys: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' }, Tab: { code: 'Tab', vk: 9 },
  Backspace: { code: 'Backspace', vk: 8 }, Delete: { code: 'Delete', vk: 46 },
  Escape: { code: 'Escape', vk: 27 }, ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 }, Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 },
};

/** Shared WebSocket CDP implementation; lifecycle belongs to the device shell. */
export class CdpSurface implements Surface {
  private closed = false;
  private navigationError: string | undefined;
  private readonly loaded = new Set<string>();

  constructor(
    readonly session: SurfaceSession,
    private readonly cdp: CdpConnection,
    private readonly lifecycle: SurfaceLifecycle,
    private readonly inputDelayMs = 60,
  ) {
    cdp.on('Page.lifecycleEvent', params => {
      if (params.name === 'load' && typeof params.loaderId === 'string') {
        if (this.loaded.size > 32) this.loaded.clear();
        this.loaded.add(params.loaderId);
      }
    });
  }

  async open(options: SurfaceOpenOptions): Promise<void> {
    if (options.session !== this.session) throw new Error('SURFACE_SESSION_MISMATCH');
    if (!['http:', 'https:'].includes(new URL(options.url).protocol)) throw new Error('SURFACE_HTTP_URL_REQUIRED');
    if (![options.width, options.height].every(n => Number.isInteger(n) && n > 0 && n <= 8192)) throw new Error('SURFACE_BAD_VIEWPORT');
    await this.cdp.send('Page.enable');
    await this.cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
    await this.cdp.send('Network.setUserAgentOverride', { userAgent: options.userAgent });
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: options.width, height: options.height, deviceScaleFactor: 1, mobile: false,
    });
    // Page.navigate acknowledges navigation start; wait for the requested document, not the old page.
    const result = await this.cdp.send<{ errorText?: string; loaderId?: string }>('Page.navigate', { url: options.url });
    this.navigationError = result.errorText;
    if (this.navigationError) throw new Error(this.navigationError);
    if (result.loaderId) {
      const deadline = Date.now() + 30000;
      while (!this.loaded.has(result.loaderId)) {
        if (!this.cdp.isOpen) throw new Error('CDP_CLOSED');
        if (Date.now() >= deadline) throw new Error('SURFACE_NAVIGATION_TIMEOUT');
        await pause(50);
      }
    }
    await this.waitForNavigation();
  }

  async evaluateReadOnly<T>(expression: string): Promise<T> {
    const reply = await this.cdp.send<{ result: { value?: T }; exceptionDetails?: unknown }>('Runtime.evaluate', {
      expression, returnByValue: true, throwOnSideEffect: true, timeout: 5000,
    });
    if (reply.exceptionDetails) throw new Error('SURFACE_READ_FAILED_OR_SIDE_EFFECT');
    return reply.result.value as T;
  }

  readState(): Promise<SurfaceState> {
    return this.evaluateReadOnly<SurfaceState>('({url: location.href, title: document.title, loading: document.readyState !== "complete"})');
  }

  async waitForNavigation(options: NavigationOptions = {}): Promise<SurfaceState> {
    const deadline = Date.now() + (options.timeoutMs ?? 30000);
    while (Date.now() < deadline) {
      if (this.navigationError) throw new Error(this.navigationError);
      try {
        const state = await this.readState();
        if (!state.loading && (!options.url || state.url === options.url)) return state;
      } catch (error) {
        if (error instanceof Error && /CDP_CLOSED|CDP_TIMEOUT/.test(error.message)) throw error;
        // Execution contexts disappear during navigation.
      }
      await pause(50);
    }
    throw new Error('SURFACE_NAVIGATION_TIMEOUT');
  }

  async click(x: number, y: number): Promise<void> {
    if (![x, y].every(Number.isFinite)) throw new Error('SURFACE_BAD_COORDINATES');
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await pause(this.inputDelayMs);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await pause(this.inputDelayMs);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async typeText(text: string): Promise<void> {
    for (const char of text) { await this.cdp.send('Input.insertText', { text: char }); await pause(this.inputDelayMs); }
  }

  async pressKey(input: KeyInput): Promise<void> {
    const key = keys[input.key] ?? (/^[a-z0-9]$/i.test(input.key)
      ? { code: /^[0-9]$/.test(input.key) ? `Digit${input.key}` : `Key${input.key.toUpperCase()}`, vk: input.key.toUpperCase().charCodeAt(0) }
      : undefined);
    if (!key) throw new Error('SURFACE_UNSUPPORTED_KEY');
    const params = { key: input.key, code: key.code, windowsVirtualKeyCode: key.vk, modifiers: input.modifiers ?? 0 };
    const text = 'text' in key ? key.text : ((params.modifiers & 7) === 0 && input.key.length === 1 ? input.key : undefined);
    await this.cdp.send('Input.dispatchKeyEvent', { ...params, type: 'keyDown', ...(text ? { text } : {}) });
    await pause(this.inputDelayMs);
    await this.cdp.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
  }

  async attachFiles(selector: string, absolutePaths: readonly string[]): Promise<void> {
    const { root } = await this.cdp.send<{ root: { nodeId: number } }>('DOM.getDocument');
    const { nodeId } = await this.cdp.send<{ nodeId: number }>('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error('SURFACE_FILE_INPUT_NOT_FOUND');
    await this.cdp.send('DOM.setFileInputFiles', { nodeId, files: [...absolutePaths] });
  }

  show(): Promise<void> { return this.lifecycle.setVisible(true); }
  hide(): Promise<void> { return this.lifecycle.setVisible(false); }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cdp.close();
    await this.lifecycle.close();
  }
}
