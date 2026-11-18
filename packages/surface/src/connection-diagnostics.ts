/** Login navigation metadata only. Never pass a page, request body or input value. */
export const connectionSteps = ['CREATED', 'STARTED', 'FINISHED', 'BLOCKED', 'NET_ERROR', 'HTTP_ERROR', 'SHOWN', 'HIDDEN',
  'RENDERER_GONE', 'POPUP_OPENED', 'POPUP_CLOSED', 'LANDING_HIDDEN', 'BLOCKED_HIDDEN', 'CHECK_CONFIRMED', 'CHECK_NOT_CONFIRMED', 'RETRY_LIMIT'] as const;
export interface ConnectionDiagnostic { host: string; path: string; code?: number }
export function connectionMetadata(url: string): ConnectionDiagnostic {
  try { const u = new URL(url); return sanitizeConnection({ host: u.hostname, path: u.pathname }); }
  catch { return { host: 'none', path: 'none' }; }
}
export function sanitizeConnection(value: ConnectionDiagnostic): ConnectionDiagnostic {
  const host = typeof value.host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(value.host) ? value.host.toLowerCase() : 'none';
  const path = typeof value.path === 'string' && value.path.startsWith('/')
    ? value.path.split(/[?#]/, 1)[0]!.replace(/[\r\n\t ]/g, '_').replace(/\d{3,}/g, '{n}').slice(0, 80) : 'none';
  return { host, path, ...(typeof value.code === 'number' && Number.isInteger(value.code) && value.code >= -999 && value.code <= 599 ? { code: value.code } : {}) };
}
