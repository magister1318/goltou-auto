import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const adb = process.env.ADB ?? (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe') : 'adb');
const serial = process.env.ANDROID_SERIAL;
const prefix = serial ? ['-s', serial] : [];
function run(args) { return execFileSync(adb, [...prefix, ...args], { maxBuffer: 16 * 1024 * 1024, windowsHide: true }); }
const out = path.resolve(process.argv[2] ?? path.join('tmp', `wp0-device-${new Date().toISOString().replace(/[:.]/g, '-')}`));
// Read only files/wp0 in this package. Never pull app WebView storage or other phone files.
const names = run(['shell', 'run-as', 'kr.goltou.auto', 'ls', 'files/wp0']).toString('utf8').trim().split(/\r?\n/).filter(Boolean);
mkdirSync(out, { recursive: true });
let count = 0;
for (const name of names) {
  if (!/^[a-f0-9-]{36}(?:-(?:failure|before-post))?\.(?:json|png)$/.test(name)) continue;
  const data = run(['exec-out', 'run-as', 'kr.goltou.auto', 'cat', `files/wp0/${name}`]);
  if (name.endsWith('.json')) JSON.parse(data.toString('utf8'));
  writeFileSync(path.join(out, name), data); count++;
}
console.log(`골투오토 실험 기록 ${count}개 → ${out}`);
