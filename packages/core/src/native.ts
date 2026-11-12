// Reference: ../refs/DAF/daf3/apps/mobile/src/core/native.ts (trimmed request/reply channel).
import WebSocket from 'ws';

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };

/** Platform-neutral RPC channel. The device shell implements the actual operations. */
export class NativeBridge {
  private socket: WebSocket | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly events = new Map<string, Set<(data: Record<string, unknown>) => void>>();

  onEvent(name: string, listener: (data: Record<string, unknown>) => void): () => void {
    const listeners = this.events.get(name) ?? new Set(); this.events.set(name, listeners); listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.events.delete(name); };
  }

  attach(socket: WebSocket): void {
    this.detach();
    this.socket = socket;
    socket.on('message', raw => {
      if (this.socket !== socket) return;
      try {
        const msg = JSON.parse(String(raw)) as { id: number; ok: boolean; result?: unknown; error?: string; event?: string; data?: Record<string, unknown> };
        if (msg.event) { for (const listener of this.events.get(msg.event) ?? []) listener(msg.data ?? {}); return; }
        const item = this.pending.get(msg.id);
        if (!item) return;
        this.pending.delete(msg.id);
        clearTimeout(item.timer);
        if (msg.ok) item.resolve(msg.result);
        else item.reject(new Error(msg.error ?? 'NATIVE_ERROR'));
      } catch { socket.close(1003, 'Invalid message'); }
    });
    socket.on('close', () => { if (this.socket === socket) this.detach(); });
    socket.on('error', () => { if (this.socket === socket) this.detach(); });
  }

  call<T>(op: string, args: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('NATIVE_NOT_CONNECTED'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`NATIVE_TIMEOUT ${op}`)); }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      socket.send(JSON.stringify({ id, op, ...args }), error => { if (error) this.detach(); });
    });
  }

  detach(): void {
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('NATIVE_DISCONNECTED')); }
    this.pending.clear();
  }
}
