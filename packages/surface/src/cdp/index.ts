import { traceStep, trace, reasonCode, requestTrace, currentTrace, inTrace, expectedTelemetryRequest } from '../telemetry';
import type { ClickTargetMiss, ClickTargetOptions, GuardedRequest, GuardedResponse, RequestBlockReason, RequestRule, KeyInput, NavigationOptions, NavigationPolicy, Surface, SurfaceDialog, SurfaceOpenOptions, SurfaceSession, SurfaceState } from '../index';
import { inputCharacters } from '../index';
import { clickTargetExpression } from './click-target';
import { CdpConnection } from './connection';
export { CdpConnection } from './connection';
export { redactionGeometry } from './redaction';

export interface SurfaceLifecycle {
  setVisible(visible: boolean): Promise<void>;
  close(): Promise<void>;
  readDialog?(): Promise<SurfaceDialog | null>;
  respondDialog?(id: string, accept: boolean): Promise<void>;
  restrictNavigation?(policy: NavigationPolicy): Promise<void>;
  onUserHidden?(listener: () => void): () => void;
  onNavigationHidden?(listener: () => void): () => void;
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
  private jobTrace: import('../telemetry').TraceJob | undefined;
  private navigationError: string | undefined;
  private metrics: { width: number; height: number; deviceScaleFactor: number; mobile: boolean } | undefined;
  private readonly loaded = new Set<string>();
  private mainLoader: string | undefined;
  private dialog: SurfaceDialog | null = null;
  private dialogSerial = 0;
  private barrierFailed = false;
  private barrierFailure = '';
  private readonly blockedRequests = new Map<string, boolean>();
  private requestGuard: { paths: Set<string>; rules: readonly RequestRule[]; inspect: (request: GuardedRequest) => boolean | Promise<boolean>; response: (response: GuardedResponse) => void; observeResponse?: (request: Pick<GuardedRequest, 'url' | 'method'>) => boolean; blocked?: (request: Pick<GuardedRequest, 'url' | 'method'> | undefined, reason: RequestBlockReason) => void } | undefined;
  private readonly acceptedRequests = new Map<string, GuardedRequest>();

  constructor(
    readonly session: SurfaceSession,
    private readonly cdp: CdpConnection,
    private readonly lifecycle: SurfaceLifecycle,
    private readonly inputDelayMs = 60,
  ) {
    cdp.on('Fetch.requestPaused', p => { void inTrace(this.jobTrace, () => this.intercept(p)).catch(error => {
      const message = error instanceof Error ? error.message : '';
      // Chromium can cancel a paused request before continue/fail is handled.
      // This exact error means its interception no longer exists. It does not
      // remove the installed policy, authorize another request or retry a write.
      if(p.responseStatusCode === undefined && p.responseErrorReason === undefined && /Invalid InterceptionId/i.test(message)) {
        inTrace(this.jobTrace, () => trace('barrier', 'skip', { reason: 'STALE_INTERCEPTION' })); this.acceptedRequests.delete(String(p.requestId)); return;
      }
      inTrace(this.jobTrace, () => trace('barrier', 'fail', { reason: reasonCode(error) }));
      this.barrierFailed = true;
      const kind = /InterceptionId|interception id/i.test(message) ? 'STALE_INTERCEPTION' : /resource.*identifier/i.test(message) ? 'STALE_RESOURCE' : /response body|body.*response/i.test(message) ? 'RESPONSE_BODY' : /CDP_TIMEOUT/.test(message) ? 'TIMEOUT' : 'PROTOCOL';
      this.barrierFailure = `${p.responseErrorReason !== undefined ? 'ERROR' : p.responseStatusCode !== undefined ? 'RESPONSE' : 'REQUEST'}_${kind}`;
    }); });
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
    return traceStep('surface.cdp.index.CdpSurface.intercept', async () => {
      const request = p.request as GuardedRequest | undefined;
      const requestId = String(p.requestId);
      if (p.responseStatusCode !== undefined || p.responseErrorReason !== undefined) {
        const accepted = this.acceptedRequests.get(requestId); this.acceptedRequests.delete(requestId);
        if (accepted) {
          const status = Number(p.responseStatusCode);
          trace('barrier', 'ok', { ...requestTrace(accepted, true),
            ...(Number.isInteger(status) ? { counts: { status } } : {}), reason: 'REQUEST_ALLOWED' });
        }
        if (accepted && p.responseErrorReason === undefined &&
          (!['GET', 'HEAD', 'OPTIONS'].includes(accepted.method) ||
            accepted.method === 'GET' && this.requestGuard?.observeResponse?.(accepted) === true)) {
          try {
            const result = await this.cdp.send<{ body: string; base64Encoded?: boolean }>('Fetch.getResponseBody', { requestId });
            this.requestGuard?.response({ status: Number(p.responseStatusCode), body: result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body, url: accepted.url, method: accepted.method });
          } finally { await this.cdp.send('Fetch.continueRequest', { requestId }); }
        } else await this.cdp.send('Fetch.continueRequest', { requestId });
        return;
      }
      let blocked = true;
      let reason: RequestBlockReason = 'REQUEST_INVALID';
      let inspected: GuardedRequest | undefined;
      try {
        const url = new URL(request?.url ?? '');
        const path = `${url.hostname}${url.pathname}`;
        blocked = this.blockedRequests.has(path);
        if (blocked) {
          reason = 'STATIC_BLOCK';
          const raw = p.request as GuardedRequest & { headers?: Record<string, unknown> };
          const contentType = Object.entries(raw.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1];
          trace('barrier', this.blockedRequests.get(path) ? 'blocked_expected' : 'fail', { ...requestTrace({ url: raw.url, method: raw.method, contentType: String(contentType ?? ''), ...(typeof raw.postData === 'string' ? { postData: raw.postData, postDataComplete: true } : {}) }, false), reason });
        }
        if (!blocked && this.requestGuard?.rules.some(r => (r.hostname === '*' || r.hostname === url.hostname) && (r.prefix ? url.pathname.startsWith(r.pathname) : r.pathname === url.pathname))) {
          const raw = p.request as GuardedRequest & { headers?: Record<string, unknown> };
          const header = (name: string) => Object.entries(raw.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
          const expected = header('content-length');
          const length = typeof expected === 'string' && /^\d+$/.test(expected) ? Number(expected) : undefined;
          const inline = typeof raw.postData === 'string';
          let postData = raw.postData, fetched = false;
          let postDataFailure: GuardedRequest['postDataFailure'];
          const mustFetch = raw.hasPostData === true && !inline || length !== undefined && (!inline || Buffer.byteLength(postData!, 'utf8') !== length);
          if (mustFetch) {
            // CDP has no Fetch.getRequestPostData. Fetch's networkId addresses
            // Network.getRequestPostData while this request remains paused.
            if (typeof p.networkId === 'string') {
              try {
                const body = await this.cdp.send<{ postData: string }>('Network.getRequestPostData', { requestId: p.networkId });
                if (typeof body.postData === 'string') { postData = body.postData; fetched = true; }
              } catch { trace('surface.cdp.index.CdpSurface.intercept', 'fail', { reason: 'CAUGHT_FAILURE' });  postDataFailure = 'FETCH_FAILED'; }
            } else postDataFailure = 'NETWORK_ID_MISSING';
          }
          const complete = typeof postData === 'string' && (!mustFetch || fetched) && (length === undefined || Buffer.byteLength(postData, 'utf8') === length);
          if (!complete && !postDataFailure) postDataFailure = typeof postData === 'string' && length !== undefined ? 'LENGTH_MISMATCH' : 'MISSING';
          reason = 'INSPECTOR_ERROR';
          trace('barrier', 'start');
          const inspection = { url: raw.url, method: raw.method, ...(complete ? { postData: postData! } : {}),
            contentType: String(header('content-type') ?? ''), hasPostData: raw.hasPostData === true, postDataInline: inline,
            postDataFetched: fetched, postDataComplete: complete, ...(postDataFailure ? { postDataFailure } : {}) };
          inspected = inspection;
          blocked = !request || !await this.requestGuard.inspect(inspection);
          trace('barrier', blocked ? expectedTelemetryRequest(inspection) ? 'blocked_expected' : 'fail' : 'ok', { ...requestTrace(inspection, !blocked), reason: currentTrace()?.decisionReason ?? (blocked ? 'INSPECTOR_DENIED' : 'REQUEST_ALLOWED') });
          if (blocked) reason = 'INSPECTOR_DENIED';
          if (!blocked && (this.requestGuard.observeResponse?.(raw) ?? true)) this.acceptedRequests.set(requestId, { url: raw.url, method: raw.method });
        }
      } catch {
        trace('surface.cdp.index.CdpSurface.intercept', 'fail', { reason: 'CAUGHT_FAILURE' });
        trace('barrier', 'fail', { ...(inspected || request ? requestTrace(inspected ?? request!, false) : {}), reason });
        blocked = true; /* Unreadable intercepted requests fail closed. */
      }
      await this.cdp.send(blocked ? 'Fetch.failRequest' : 'Fetch.continueRequest', {
        requestId: p.requestId, ...(blocked ? { errorReason: 'BlockedByClient' } : {}),
      });
      if (blocked) this.requestGuard?.blocked?.(request ? { url: request.url, method: request.method } : undefined, reason);

    });
  }

  async guardRequests(rules: readonly RequestRule[], inspect: (request: GuardedRequest) => boolean | Promise<boolean>, response: (response: GuardedResponse) => void, observeResponse?: (request: Pick<GuardedRequest, 'url' | 'method'>) => boolean, blocked?: (request: Pick<GuardedRequest, 'url' | 'method'> | undefined, reason: RequestBlockReason) => void) {
    return traceStep('surface.cdp.index.CdpSurface.guardRequests', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    if (this.requestGuard) throw new Error('SURFACE_REQUEST_GUARD_ALREADY_SET');
    const paths = new Set(rules.map(rule => {
      if (!(rule.hostname === '*' || /^[a-z0-9.-]+$/.test(rule.hostname)) || !/^\/[a-zA-Z0-9/_.-]*$/.test(rule.pathname)) throw new Error('SURFACE_BAD_REQUEST_BARRIER');
      return `${rule.hostname}${rule.pathname}`;
    }));
    this.requestGuard = { paths, rules: [...rules], inspect, response, ...(observeResponse ? { observeResponse } : {}), ...(blocked ? { blocked } : {}) };
    // Retain the full body for Network.getRequestPostData if Fetch omits it.
    await this.cdp.send('Network.enable', { maxPostDataSize: 16 * 1024 * 1024 });
    await this.updateRequestPatterns();

    });
  }

  async blockRequests(rules: readonly { hostname: string; pathname: string; expected?: boolean }[]): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.blockRequests', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    for (const rule of rules) {
      if (!/^[a-z0-9.-]+$/.test(rule.hostname) || !/^\/[a-zA-Z0-9/_.-]+$/.test(rule.pathname)) throw new Error('SURFACE_BAD_REQUEST_BARRIER');
      this.blockedRequests.set(`${rule.hostname}${rule.pathname}`, rule.expected === true);
    }
    await this.updateRequestPatterns();

    });
  }

  /** Fetch.enable replaces its complete pattern set. Adding static blocks must
   * retain an installed inspector and its response observation in either order. */
  private async updateRequestPatterns() {
    const paths = new Set([...(this.requestGuard?.paths ?? []), ...this.blockedRequests.keys()]);
    const stages = this.requestGuard ? ['Request', 'Response'] : ['Request'];
    await this.cdp.send('Fetch.enable', { patterns: [...paths].flatMap(path =>
      stages.flatMap(requestStage => [path, ...(path.startsWith('127.0.0.1/') ? [path.replace('127.0.0.1/', '127.0.0.1:*/')] : [])]
        .map(pattern => ({ urlPattern: `*://${pattern}*`, requestStage })))) });
  }

  async open(options: SurfaceOpenOptions): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.open', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    try { const u = new URL(options.url); trace('navigation', 'start', { navigation: { host: u.hostname, path: u.pathname } }); } catch { trace('navigation', 'fail', { reason: 'REQUEST_INVALID' }); }
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

    });
  }

  async evaluateReadOnly<T>(expression: string): Promise<T> {
    return traceStep('surface.cdp.index.CdpSurface.evaluateReadOnly', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    const reply = await this.cdp.send<{ result: { value?: T }; exceptionDetails?: unknown }>('Runtime.evaluate', {
      expression, returnByValue: true, throwOnSideEffect: true, timeout: 5000,
    });
    if (reply.exceptionDetails) throw new Error('SURFACE_READ_FAILED_OR_SIDE_EFFECT');
    return reply.result.value as T;

    });
  }

  readState(): Promise<SurfaceState> {
    return this.evaluateReadOnly<SurfaceState>('({url: location.href, title: document.title, loading: document.readyState !== "complete"})');
  }

  async readClickTarget(x: number, y: number, selector: string, options?: ClickTargetOptions): Promise<boolean> {
    return traceStep('surface.cdp.index.CdpSurface.readClickTarget', async () => {
      this.jobTrace = currentTrace() ?? this.jobTrace;
      if (![x, y].every(Number.isFinite)) throw new Error('SURFACE_HIT_TEST_FAILED');
      const { frameTree } = await this.cdp.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
      const { executionContextId } = await this.cdp.send<{ executionContextId: number }>('Page.createIsolatedWorld', {
        frameId: frameTree.frame.id, worldName: 'goltou-click-target',
      });
      // Blink may flush layout for elementFromPoint, which V8 rejects with
      // throwOnSideEffect. Only this fixed reader runs in the isolated world.
      const { result, exceptionDetails } = await this.cdp.send<{ result: { value?: boolean | ClickTargetMiss }; exceptionDetails?: unknown }>('Runtime.evaluate', {
        expression: clickTargetExpression(x, y, selector, options), contextId: executionContextId,
        returnByValue: true, timeout: 5000,
      });
      if (exceptionDetails) throw new Error('SURFACE_HIT_TEST_FAILED');
      if (result.value && typeof result.value === 'object') options?.onMiss?.report(result.value);
      return result.value === true;
    });
  }

  async waitForNavigation(options: NavigationOptions = {}): Promise<SurfaceState> {
    return traceStep('surface.cdp.index.CdpSurface.waitForNavigation', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    const deadline = Date.now() + (options.timeoutMs ?? 30000);
    while (Date.now() < deadline) {
      if (this.navigationError) throw new Error(this.navigationError);
      try {
        const state = await this.readState();
        if (!state.loading && (!options.url || state.url === options.url)) return state;
      } catch (error) { trace('surface.cdp.index.CdpSurface.waitForNavigation', 'fail', { reason: reasonCode(error) });
        if (error instanceof Error && /CDP_CLOSED|CDP_TIMEOUT/.test(error.message)) throw error;
        // Execution contexts disappear during navigation.
      }
      await pause(50);
    }
    throw new Error('SURFACE_NAVIGATION_TIMEOUT');

    });
  }

  async click(x: number, y: number, beforePress?: () => Promise<void>): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.click', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    if (![x, y].every(Number.isFinite)) throw new Error('SURFACE_BAD_COORDINATES');
    await this.input('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await pause(this.inputDelayMs);
    await beforePress?.();
    await this.input('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await pause(this.inputDelayMs);
    await this.input('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

    });
  }

  async insertText(text: string): Promise<void> {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    await this.input('Input.insertText', { text });
    await pause(this.inputDelayMs);
  }
  async typeText(text: string): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.typeText', async () => {
    for (const char of inputCharacters(text)) { await this.insertText(char); }

    });
  }

  async pressKey(input: KeyInput, beforePress?: () => Promise<void>): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.pressKey', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    const key = keys[input.key] ?? (/^[a-z0-9]$/i.test(input.key)
      ? { code: /^[0-9]$/.test(input.key) ? `Digit${input.key}` : `Key${input.key.toUpperCase()}`, vk: input.key.toUpperCase().charCodeAt(0) }
      : undefined);
    if (!key) throw new Error('SURFACE_UNSUPPORTED_KEY');
    const params = { key: input.key, code: key.code, windowsVirtualKeyCode: key.vk, modifiers: input.modifiers ?? 0 };
    const text = 'text' in key ? key.text : ((params.modifiers & 7) === 0 && input.key.length === 1 ? input.key : undefined);
    await beforePress?.();
    await this.input('Input.dispatchKeyEvent', { ...params, type: 'keyDown', ...(text ? { text } : {}) });
    await pause(this.inputDelayMs);
    await this.input('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });

    });
  }
  private async input(method: string, params: Record<string, unknown>): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.input', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    if (this.barrierFailed) throw new Error(`SURFACE_DRAFT_BARRIER_FAILED:${this.barrierFailure}`);
    if (this.dialog) throw new Error('SURFACE_DIALOG_PENDING');
    let unsubscribe = () => {};
    const dialog = new Promise<never>((_, reject) => { unsubscribe = this.cdp.on('Page.javascriptDialogOpening', () => reject(new Error('SURFACE_DIALOG_PENDING'))); });
    // A modal can block the very input command that opened it. Yield to the user
    // without waiting for that command's reply or sending a second input.
    try { await Promise.race([this.cdp.send(method, params), dialog]); } finally { unsubscribe(); }

    });
  }

  async attachFiles(selector: string, absolutePaths: readonly string[]): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.attachFiles', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
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

    });
  }
  async readDialog(): Promise<SurfaceDialog | null> {
    return traceStep('surface.cdp.index.CdpSurface.readDialog', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace; const dialog = this.lifecycle.readDialog ? await this.lifecycle.readDialog() : this.dialog; if (dialog) trace('dialog', 'wait', { dialog: dialog.kind }); return dialog;
    });
  }
  async respondDialog(id: string, accept: boolean): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.respondDialog', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    if (this.lifecycle.respondDialog) return this.lifecycle.respondDialog(id, accept);
    if (this.dialog?.id !== id) throw new Error('DIALOG_ID_MISMATCH');
    await this.cdp.send('Page.handleJavaScriptDialog', { accept }); this.dialog = null;

    });
  }
  /** Shell-only capture: bitmap and CSS geometry are from the same CDP viewport. */
  async captureViewport(): Promise<string> {
    return traceStep('surface.cdp.index.CdpSurface.captureViewport', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    // Only the compositor snapshot shares the emulated CSS viewport. Native view
    // snapshots can use Android density even when their PNG has the same size.
    const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
    try { return (await this.cdp.send<{ data: string }>('Page.captureScreenshot', params, 1500)).data; }
    catch (error) { trace('surface.cdp.index.CdpSurface.captureViewport', 'fail', { reason: reasonCode(error) });
      if (!(error instanceof Error) || error.message !== 'CDP_TIMEOUT Page.captureScreenshot') throw error;
      // An occluded WebView can leave the first frame request unanswered.
      // Retry the read once; this never repeats an editor input or save.
      return (await this.cdp.send<{ data: string }>('Page.captureScreenshot', params)).data;
    }

    });
  }

  async show(): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.show', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    // A native phone viewport and a fixed desktop emulation must not compete.
    await this.cdp.send('Emulation.clearDeviceMetricsOverride');
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await this.lifecycle.setVisible(true);

    });
  }
  async restrictNavigation(policy: NavigationPolicy): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.restrictNavigation', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    if (!this.lifecycle.restrictNavigation) throw new Error('SURFACE_NAVIGATION_GUARD_REQUIRED');
    await this.lifecycle.restrictNavigation(policy);

    });
  }
  onUserHidden(listener: () => void): () => void { return this.lifecycle.onUserHidden?.(listener) ?? (() => {}); }
  onNavigationHidden(listener: () => void): () => void { return this.lifecycle.onNavigationHidden?.(listener) ?? (() => {}); }
  async hide(): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.hide', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    await this.lifecycle.setVisible(false);
    if (this.metrics) await this.cdp.send('Emulation.setDeviceMetricsOverride', this.metrics);
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    });
  }
  async close(): Promise<void> {
    return traceStep('surface.cdp.index.CdpSurface.close', async () => {
    this.jobTrace = currentTrace() ?? this.jobTrace;
    if (this.closed) return;
    this.closed = true;
    this.cdp.close();
    await this.lifecycle.close();

    });
  }
}
