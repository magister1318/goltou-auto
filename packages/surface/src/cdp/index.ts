import type { GuardedRequest, GuardedResponse, RequestRule, KeyInput, NavigationOptions, Surface, SurfaceDialog, SurfaceOpenOptions, SurfaceSession, SurfaceState } from '../index';
import { inputCharacters } from '../index';
import { CdpConnection } from './connection';
export { CdpConnection } from './connection';
export { redactionGeometry } from './redaction';

export interface SurfaceLifecycle {
  setVisible(visible: boolean): Promise<void>;
  close(): Promise<void>;
  readDialog?(): Promise<SurfaceDialog | null>;
  respondDialog?(id: string, accept: boolean): Promise<void>;
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const keys: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' }, Tab: { code: 'Tab', vk: 9 },
  Backspace: { code: 'Backspace', vk: 8 }, Delete: { code: 'Delete', vk: 46 },
  Escape: { code: 'Escape', vk: 27 }, ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 }, Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 },
  PageUp: { code: 'PageUp', vk: 33 }, PageDown: { code: 'PageDown', vk: 34 },
};

/** Shared WebSocket CDP implementation; lifecycle belongs to the device shell. */
export class CdpSurface implements Surface {
  readAppFocus?: () => Promise<boolean>;
  private closed = false;
  private navigationError: string | undefined;
  private metrics: { width: number; height: number; deviceScaleFactor: number; mobile: boolean } | undefined;
  private readonly loaded = new Set<string>();
  private mainLoader: string | undefined;
  private dialog: SurfaceDialog | null = null;
  private dialogSerial = 0;
  private barrierFailed = false;
  private readonly blockedRequests = new Set<string>();
  private requestGuard: { paths: Set<string>; inspect: (request: GuardedRequest) => boolean | Promise<boolean>; response: (response: GuardedResponse) => void } | undefined;
  private readonly acceptedRequests = new Set<string>();

  constructor(
    readonly session: SurfaceSession,
    private readonly cdp: CdpConnection,
    private readonly lifecycle: SurfaceLifecycle,
    private readonly inputDelayMs = 60,
  ) {
    cdp.on('Fetch.requestPaused', p => { void this.intercept(p).catch(() => { this.barrierFailed = true; }); });
    /*
     * Interception is installed before navigation. A policy never replaces a
     * draft barrier, and an exception never permits a request.
     */
    cdp.on('Page.javascriptDialogOpening', p => { this.dialog = { id: String(++this.dialogSerial), kind: p.type === 'alert' ? 'alert' : 'confirm', message: String(p.message ?? ''), ...(typeof p.url === 'string' ? { url: p.url } : {}) }; });
    cdp.on('Page.javascriptDialogClosed', () => { this.dialog = null; });
    cdp.on('Page.frameNavigated', params => {
      const frame = params.frame as { parentId?: string; loaderId?: string } | undefined;
      if (frame && !frame.parentId && frame.loaderId) this.mainLoader = frame.loaderId;
    });
    cdp.on('Page.lifecycleEvent', params => {
      if (params.name === 'load' && typeof params.loaderId === 'string') {
        if (this.loaded.size > 32) this.loaded.clear();
        this.loaded.add(params.loaderId);
      }
    });
  }
  private async intercept(p: Record<string, unknown>) {
      const request = p.request as GuardedRequest | undefined;
      const requestId = String(p.requestId);
      if (p.responseStatusCode !== undefined) {
        if (this.acceptedRequests.delete(requestId)) {
          try {
            const result = await this.cdp.send<{ body: string; base64Encoded?: boolean }>('Fetch.getResponseBody', { requestId });
            this.requestGuard?.response({ status: Number(p.responseStatusCode), body: result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body });
          } finally { await this.cdp.send('Fetch.continueRequest', { requestId }); }
        } else await this.cdp.send('Fetch.continueRequest', { requestId });
        return;
      }
      let blocked = true;
      try {
        const url = new URL(request?.url ?? '');
        const path = `${url.hostname}${url.pathname}`;
        blocked = this.blockedRequests.has(path);
        if (!blocked && this.requestGuard?.paths.has(path)) {
          const raw = p.request as GuardedRequest & { headers?: Record<string, unknown> };
          const header = (name: string) => Object.entries(raw.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
          const expected = header('content-length');
          const length = typeof expected === 'string' && /^\d+$/.test(expected) ? Number(expected) : undefined;
          const inline = typeof raw.postData === 'string';
          let postData = raw.postData, fetched = false;
          const mustFetch = raw.hasPostData === true && !inline || length !== undefined && (!inline || Buffer.byteLength(postData!, 'utf8') !== length);
          if (mustFetch) {
            // CDP has no Fetch.getRequestPostData. Fetch's networkId addresses
            // Network.getRequestPostData while this request remains paused.
            if (typeof p.networkId === 'string') {
              try {
                const body = await this.cdp.send<{ postData: string }>('Network.getRequestPostData', { requestId: p.networkId });
                if (typeof body.postData === 'string') { postData = body.postData; fetched = true; }
              } catch { /* Missing full data cannot authorize publication. */ }
            }
          }
          const complete = typeof postData === 'string' && (!mustFetch || fetched) && (length === undefined || Buffer.byteLength(postData, 'utf8') === length);
          blocked = !request || !await this.requestGuard.inspect({ url: raw.url, method: raw.method, ...(complete ? { postData: postData! } : {}),
            contentType: String(header('content-type') ?? ''), hasPostData: raw.hasPostData === true, postDataInline: inline,
            postDataFetched: fetched, postDataComplete: complete });
          if (!blocked) this.acceptedRequests.add(requestId);
        }
      } catch { blocked = true; /* Unreadable intercepted requests fail closed. */ }
      await this.cdp.send(blocked ? 'Fetch.failRequest' : 'Fetch.continueRequest', {
        requestId: p.requestId, ...(blocked ? { errorReason: 'BlockedByClient' } : {}),
      });
  }

  async guardRequests(rules: readonly RequestRule[], inspect: (request: GuardedRequest) => boolean | Promise<boolean>, response: (response: GuardedResponse) => void) {
    if (this.requestGuard) throw new Error('SURFACE_REQUEST_GUARD_ALREADY_SET');
    const paths = new Set(rules.map(rule => {
      if (!/^[a-z0-9.-]+$/.test(rule.hostname) || !/^\/[a-zA-Z0-9/_.-]+$/.test(rule.pathname)) throw new Error('SURFACE_BAD_REQUEST_BARRIER');
      return `${rule.hostname}${rule.pathname}`;
    }));
    this.requestGuard = { paths, inspect, response };
    // Retain the full body for Network.getRequestPostData if Fetch omits it.
    await this.cdp.send('Network.enable', { maxPostDataSize: 16 * 1024 * 1024 });
    await this.cdp.send('Fetch.enable', { patterns: [...new Set([...paths, ...this.blockedRequests])].flatMap(path =>
      ['Request', 'Response'].flatMap(requestStage => [path, ...(path.startsWith('127.0.0.1/') ? [path.replace('127.0.0.1/', '127.0.0.1:*/')] : [])]
        .map(pattern => ({ urlPattern: `*://${pattern}*`, requestStage })))) });
  }

  async blockRequests(rules: readonly { hostname: string; pathname: string }[]): Promise<void> {
    for (const rule of rules) {
      if (!/^[a-z0-9.-]+$/.test(rule.hostname) || !/^\/[a-zA-Z0-9/_.-]+$/.test(rule.pathname)) throw new Error('SURFACE_BAD_REQUEST_BARRIER');
      this.blockedRequests.add(`${rule.hostname}${rule.pathname}`);
    }
    await this.cdp.send('Fetch.enable', { patterns: [...this.blockedRequests].map(path => ({ urlPattern: `*://${path}*`, requestStage: 'Request' })) });
  }

  async open(options: SurfaceOpenOptions): Promise<void> {
    if (options.session !== this.session) throw new Error('SURFACE_SESSION_MISMATCH');
    if (!['http:', 'https:'].includes(new URL(options.url).protocol)) throw new Error('SURFACE_HTTP_URL_REQUIRED');
    if (![options.width, options.height].every(n => Number.isInteger(n) && n > 0 && n <= 8192)) throw new Error('SURFACE_BAD_VIEWPORT');
    await this.cdp.send('Page.enable');
    await this.cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
    await this.cdp.send('Network.setUserAgentOverride', { userAgent: options.userAgent });
    this.metrics = {
      width: options.width, height: options.height, deviceScaleFactor: 1, mobile: false,
    };
    await this.cdp.send('Emulation.setDeviceMetricsOverride', this.metrics);
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // Page.navigate acknowledges navigation start; wait for the requested document, not the old page.
    const previousMainLoader = this.mainLoader;
    const result = await this.cdp.send<{ errorText?: string; loaderId?: string }>('Page.navigate', { url: options.url });
    this.navigationError = result.errorText;
    if (this.navigationError) throw new Error(this.navigationError);
    if (result.loaderId) {
      const deadline = Date.now() + 30000;
      while (!this.loaded.has(result.loaderId) && !(this.mainLoader && this.mainLoader !== previousMainLoader && this.loaded.has(this.mainLoader))) {
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

  async readClickTarget(x: number, y: number, selector: string): Promise<boolean> {
    // Points from read() use the outer document's layout viewport. Android CDP
    // can report the focused iframe's scroll in Page.getLayoutMetrics instead.
    // Adding that offset double-counts its scroll and can hit outside the view.
    const scroll = await this.evaluateReadOnly<{ x: number; y: number }>('({x:scrollX,y:scrollY})');
    if (![x, y, scroll?.x, scroll?.y].every(Number.isFinite)) throw new Error('SURFACE_HIT_TEST_FAILED');
    const node = await this.cdp.send<{ backendNodeId?: number }>('DOM.getNodeForLocation', { x: Math.round(x + scroll.x), y: Math.round(y + scroll.y), includeUserAgentShadowDOM: false, ignorePointerEventsNone: false });
    if (!node.backendNodeId) return false;
    const { object } = await this.cdp.send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId: node.backendNodeId });
    if (!object.objectId) return false;
    try {
      const result = await this.cdp.send<{ result: { value?: boolean }; exceptionDetails?: unknown }>('Runtime.callFunctionOn', {
        objectId: object.objectId, functionDeclaration: 'function(selector) { const targets=Array.from(this.ownerDocument.querySelectorAll(selector)); let e=this; while(e) { if(targets.includes(e)) return true; e=e.parentElement; } return false; }',
        arguments: [{ value: selector }], returnByValue: true, throwOnSideEffect: true,
      });
      if (result.exceptionDetails) throw new Error('SURFACE_HIT_TEST_FAILED');
      return result.result.value === true;
    } finally { await this.cdp.send('Runtime.releaseObject', { objectId: object.objectId }); }
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

  async click(x: number, y: number, beforePress?: () => Promise<void>): Promise<void> {
    if (![x, y].every(Number.isFinite)) throw new Error('SURFACE_BAD_COORDINATES');
    await this.input('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await pause(this.inputDelayMs);
    await beforePress?.();
    await this.input('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await pause(this.inputDelayMs);
    await this.input('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async typeText(text: string): Promise<void> {
    for (const char of inputCharacters(text)) { await this.input('Input.insertText', { text: char }); await pause(this.inputDelayMs); }
  }

  async pressKey(input: KeyInput): Promise<void> {
    const key = keys[input.key] ?? (/^[a-z0-9]$/i.test(input.key)
      ? { code: /^[0-9]$/.test(input.key) ? `Digit${input.key}` : `Key${input.key.toUpperCase()}`, vk: input.key.toUpperCase().charCodeAt(0) }
      : undefined);
    if (!key) throw new Error('SURFACE_UNSUPPORTED_KEY');
    const params = { key: input.key, code: key.code, windowsVirtualKeyCode: key.vk, modifiers: input.modifiers ?? 0 };
    const text = 'text' in key ? key.text : ((params.modifiers & 7) === 0 && input.key.length === 1 ? input.key : undefined);
    await this.input('Input.dispatchKeyEvent', { ...params, type: 'keyDown', ...(text ? { text } : {}) });
    await pause(this.inputDelayMs);
    await this.input('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
  }
  private async input(method: string, params: Record<string, unknown>): Promise<void> {
    if (this.barrierFailed) throw new Error('SURFACE_DRAFT_BARRIER_FAILED');
    if (this.dialog) throw new Error('SURFACE_DIALOG_PENDING');
    let unsubscribe = () => {};
    const dialog = new Promise<never>((_, reject) => { unsubscribe = this.cdp.on('Page.javascriptDialogOpening', () => reject(new Error('SURFACE_DIALOG_PENDING'))); });
    // A modal can block the very input command that opened it. Yield to the user
    // without waiting for that command's reply or sending a second input.
    try { await Promise.race([this.cdp.send(method, params), dialog]); } finally { unsubscribe(); }
  }

  async attachFiles(selector: string, absolutePaths: readonly string[]): Promise<void> {
    type Node = { nodeId: number; contentDocument?: Node; children?: Node[] };
    const { root } = await this.cdp.send<{ root: Node }>('DOM.getDocument', { depth: -1, pierce: true });
    const documents = [root];
    const visit = (node: Node) => {
      if (node.contentDocument) { documents.push(node.contentDocument); visit(node.contentDocument); }
      node.children?.forEach(visit);
    };
    visit(root);
    let nodeId = 0;
    for (const document of documents) {
      const result = await this.cdp.send<{ nodeId: number }>('DOM.querySelector', { nodeId: document.nodeId, selector });
      if (result.nodeId) { nodeId = result.nodeId; break; }
    }
    if (!nodeId) throw new Error('SURFACE_FILE_INPUT_NOT_FOUND');
    await this.cdp.send('DOM.setFileInputFiles', { nodeId, files: [...absolutePaths] });
  }
  async readDialog(): Promise<SurfaceDialog | null> { return this.lifecycle.readDialog ? this.lifecycle.readDialog() : this.dialog; }
  async respondDialog(id: string, accept: boolean): Promise<void> {
    if (this.lifecycle.respondDialog) return this.lifecycle.respondDialog(id, accept);
    if (this.dialog?.id !== id) throw new Error('DIALOG_ID_MISMATCH');
    await this.cdp.send('Page.handleJavaScriptDialog', { accept }); this.dialog = null;
  }
  /** Shell-only capture: bitmap and CSS geometry are from the same CDP viewport. */
  async captureViewport(): Promise<string> {
    // Only the compositor snapshot shares the emulated CSS viewport. Native view
    // snapshots can use Android density even when their PNG has the same size.
    const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
    try { return (await this.cdp.send<{ data: string }>('Page.captureScreenshot', params, 1500)).data; }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'CDP_TIMEOUT Page.captureScreenshot') throw error;
      // An occluded WebView can leave the first frame request unanswered.
      // Retry the read once; this never repeats an editor input or save.
      return (await this.cdp.send<{ data: string }>('Page.captureScreenshot', params)).data;
    }
  }

  async show(): Promise<void> {
    // A native phone viewport and a fixed desktop emulation must not compete.
    await this.cdp.send('Emulation.clearDeviceMetricsOverride');
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await this.lifecycle.setVisible(true);
  }
  async hide(): Promise<void> {
    await this.lifecycle.setVisible(false);
    if (this.metrics) await this.cdp.send('Emulation.setDeviceMetricsOverride', this.metrics);
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cdp.close();
    await this.lifecycle.close();
  }
}
