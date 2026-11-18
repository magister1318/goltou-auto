import { expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectionMetadata, connectionSteps, sanitizeConnection } from '../../surface/src/connection-diagnostics';
import { configureTrace } from '@goltou/surface/telemetry';
import { AndroidSurfaceHost } from '../../../apps/android/bridge/host';
import type { NativeBridge } from '../src/native';
import { JobLogStore } from '../src/job-logs';

it('retains unknown hosts, masks runs of digits, truncates paths and drops query/fragment', () => {
  expect(connectionMetadata('https://unknown.example/step/123456/12?token=PRIVATE#PRIVATE')).toEqual({ host: 'unknown.example', path: '/step/{n}/12' });
  expect(connectionMetadata('https://unknown.example/' + 'a'.repeat(100)).path).toHaveLength(80);
  expect(connectionMetadata('invalid PRIVATE')).toEqual({ host: 'none', path: 'none' });
  expect(sanitizeConnection({ host: 'unknown.example', path: '/123?token=PRIVATE#PRIVATE', code: 2147483647 })).toEqual({ host: 'unknown.example', path: '/{n}' });
});

it('persists every native connection step in login_check jobs for export, without secrets', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'goltou-connect-'));
  const logs = new JobLogStore(directory);
  let diagnostic!: (data: Record<string, unknown>) => void;
  const native = { onEvent: (_: string, listener: typeof diagnostic) => { diagnostic = listener; return () => {}; } } as unknown as NativeBridge;
  configureTrace(logs);
  try {
    new AndroidSurfaceHost(native, 'unused');
    for (const step of connectionSteps) diagnostic({ session: 'naver', step, host: 'unknown.example', path: '/step/123456?token=PRIVATE#PRIVATE', code: -2 });
    diagnostic({ session: 'naver', step: 'PRIVATE', host: 'PRIVATE' });
    await Promise.resolve(); await Promise.resolve();
    expect(logs.list()).toHaveLength(connectionSteps.length);
    expect(logs.list().every(row => row.kind === 'login_check' && row.site === 'naver' && row.result !== 'running')).toBe(true);
    const content = readdirSync(directory, { recursive: true }).filter(name => String(name).endsWith('.jsonl'))
      .map(name => readFileSync(path.join(directory, String(name)), 'utf8')).join('\n');
    for (const step of connectionSteps) expect(content).toContain(`CONNECTION_${step}`);
    expect(content).toContain('unknown.example'); expect(content).toContain('/step/{n}');
    expect(content).not.toMatch(/PRIVATE|123456|token=|#PRIVATE/);
  } finally { configureTrace(undefined); rmSync(directory, { recursive: true, force: true }); }
});
