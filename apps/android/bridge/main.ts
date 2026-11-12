// Reference: ../refs/DAF/daf3/apps/mobile/src/core/main.ts (embedded Node startup arguments).
import path from 'node:path';
import { NativeBridge, startCore } from '../../../packages/core/src/index';
import { AndroidSurfaceHost } from './host';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`MISSING_ARGUMENT ${name}`);
  return value;
}

const native = new NativeBridge();
void startCore({
  native, host: new AndroidSurfaceHost(native, argument('devtools')),
  port: Number(argument('port')), token: argument('token'), uiDir: path.join(argument('bundle'), 'ui'),
}).then(() => console.log('골투오토 코어 준비됨')).catch(error => {
  console.error('코어 시작 실패', error);
  // Keep the embedded runtime alive; the shell reports a health-check timeout.
  setInterval(() => {}, 60000);
});
