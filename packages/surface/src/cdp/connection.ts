// Reference: ../refs/DAF/daf3/apps/mobile/src/core/cdp.ts (request correlation and socket transport).
import net from 'node:net';
import WebSocket from 'ws';

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;
  private readonly listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', raw => {
      try {
        const msg = JSON.parse(String(raw)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> };
        if (msg.id === undefined) {
          if (msg.method) for (const listener of this.listeners.get(msg.method) ?? []) listener(msg.params ?? {});
          return;
        }
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error) pending.reject(new Error(msg.error.message));
        else pending.resolve(msg.result ?? {});
      } catch { this.fail(new Error('CDP_BAD_MESSAGE')); }
    });
    socket.on('close', () => this.fail(new Error('CDP_CLOSED')));
    socket.on('error', error => this.fail(error));
  }

  static connect(url: string, options: { socketPath?: string; timeoutMs?: number } = {}): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, {
        perMessageDeflate: false,
        maxPayload: 4 * 1024 * 1024,
        handshakeTimeout: options.timeoutMs ?? 10000,
        ...(options.socketPath ? { createConnection: () => net.connect(options.socketPath!) } : {}),
      });
      socket.once('error', reject);
      socket.once('open', () => { socket.off('error', reject); resolve(new CdpConnection(socket)); });
    });
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('CDP_CLOSED'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP_TIMEOUT ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }), error => { if (error) this.fail(error); });
    });
  }

  close(): void { this.fail(new Error('CDP_CLOSED')); this.socket.close(); }
  get isOpen(): boolean { return !this.closed; }

  on(method: string, handler: (params: Record<string, unknown>) => void): () => void {
    let listeners = this.listeners.get(method);
    if (!listeners) this.listeners.set(method, listeners = new Set());
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  private fail(error: Error): void {
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }
}
