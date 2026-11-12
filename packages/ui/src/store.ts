import { useSyncExternalStore } from 'react';
import type { AppSnapshot, Commands } from '@goltou/core/protocol';
type State = { connected: boolean; snapshot: AppSnapshot | null; error: string };
let state: State = { connected: false, snapshot: null, error: '' };
const listeners = new Set<() => void>();
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
let socket: WebSocket;
let serial = 0;
function update(next: Partial<State>) { state = { ...state, ...next }; for (const listener of listeners) listener(); }
export function useStore() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state); }
export function clearError() { update({ error: '' }); }
export function connect() {
  // The launch token is only a bootstrap secret. Goltou tokens never cross this channel.
  history.replaceState({ screen: 'login' }, '', location.pathname);
  socket = new WebSocket(`${location.origin.replace('http:', 'ws:')}/ui-socket`);
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as { type: string; id?: number; snapshot?: AppSnapshot; data?: unknown; state?: unknown; code?: string; message?: string };
    if (message.type === 'ready') { update({ connected: true }); void request('session.get', {}).then(snapshot => update({ snapshot })).catch(() => {}); }
    if (message.type === 'snapshot' && message.snapshot) update({ snapshot: message.snapshot });
    const item = message.id === undefined ? undefined : pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id!);
    if (message.type === 'error') {
      update({ error: message.message ?? '요청에 실패했습니다.' }); item.reject(Object.assign(new Error(message.message), { code: message.code }));
    } else item.resolve(message.data ?? message.state);
  };
  socket.onclose = () => {
    update({ connected: false, error: '코어 연결이 끊겼습니다. 앱을 다시 열어 주세요.' });
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('코어 연결이 끊겼습니다.')); } pending.clear();
  };
  socket.onerror = () => update({ error: '코어에 연결하지 못했습니다.' });
}
function send(message: Record<string, unknown>): Promise<unknown> {
  if (socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('코어 연결을 기다려 주세요.'));
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); update({ error: '응답이 늦습니다. 다시 시도해 주세요.' }); reject(new Error('응답 시간 초과')); }, 30000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, ...message }));
  });
}
export function request<K extends keyof Commands>(command: K, input: Commands[K]['input']): Promise<Commands[K]['output']> {
  return send({ type: 'app', command, input }) as Promise<Commands[K]['output']>;
}
export function diagnose(url: string) { return send({ type: 'diagnose', url }) as Promise<{ title: string; url: string }>; }
