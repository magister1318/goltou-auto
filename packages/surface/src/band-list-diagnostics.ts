import { sanitizeConnection, type ConnectionDiagnostic } from './connection-diagnostics';

export interface BandListDiagnostic {
  legacy?: boolean; home?: boolean; my?: boolean; loginForm?: boolean;
  tileCount?: number; apiCaptured?: boolean; apiRows?: number;
  source?: 'DOM' | 'API' | 'none';
  method?: 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'other';
}
export function bandListLocation(url: string): ConnectionDiagnostic {
  try { const u = new URL(url); return sanitizeBandListLocation({ host: u.hostname, path: u.pathname }); }
  catch { return { host: 'none', path: 'none' }; }
}
export function sanitizeBandListLocation(value: ConnectionDiagnostic): ConnectionDiagnostic {
  const clean = sanitizeConnection(value);
  return { host: clean.host, path: clean.path };
}
export function sanitizeBandList(value: BandListDiagnostic): BandListDiagnostic {
  const out: BandListDiagnostic = {};
  for (const key of ['legacy', 'home', 'my', 'loginForm', 'apiCaptured'] as const) if (typeof value[key] === 'boolean') out[key] = value[key];
  for (const key of ['tileCount', 'apiRows'] as const) if (Number.isSafeInteger(value[key]) && value[key]! >= 0) out[key] = value[key]!;
  if (['DOM', 'API', 'none'].includes(value.source ?? '')) out.source = value.source!;
  if (value.method !== undefined) out.method = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(value.method) ? value.method : 'other';
  return out;
}
