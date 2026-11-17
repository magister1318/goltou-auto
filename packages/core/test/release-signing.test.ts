import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { signingSecretViolations } from '../../../scripts/check-signing-secrets.mjs';
const run = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
it.each(['key.jks', 'key.JKS', 'key.keystore', 'release-key/anything', 'nested/keystore.properties', 'release-signing.properties', 'key.p12'])('rejects a tracked signing file: %s', name => {
  expect(signingSecretViolations([{ name, content: '' }])).toEqual([name]);
});
it.each(['storePassword', 'keyPassword', 'password', 'token', 'secret', 'api_key'])('rejects a tracked credential property without disclosing it: %s', key => {
  expect(signingSecretViolations([{ name: 'config.properties', content: `${key}=synthetic-test-value` }])).toEqual(['config.properties']);
});
it('scans staged Git contents and never prints credential values', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracked-secret-test-')); directories.push(directory);
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  await run('git', ['init', '-q', directory], { env });
  await writeFile(path.join(directory, 'config.properties'), 'keyPassword=synthetic-test-value\n');
  await run('git', ['add', 'config.properties'], { cwd: directory, env });
  // Hiding the staged secret with a safe working tree must not defeat the guard.
  await writeFile(path.join(directory, 'config.properties'), 'versionCode=2\n');
  const output = await run(process.execPath, [path.resolve('scripts/check-signing-secrets.mjs')], { cwd: directory, env }).catch(error => error);
  expect(output.code).toBe(1);
  expect(output.stderr).toContain('TRACKED_SIGNING_SECRET');
  expect(output.stderr).not.toContain('synthetic-test-value');
});
it('accepts the actual repository Git index', async () => {
  expect((await run(process.execPath, ['scripts/check-signing-secrets.mjs'])).stdout).toContain('SIGNING_SECRETS_CHECK_PASSED');
});
it('enables the release control channel independently of diagnostics and preserves private relay access', async () => {
  const activity = await readFile('apps/android/app/src/main/java/kr/goltou/auto/MainActivity.kt', 'utf8');
  const gradle = await readFile('apps/android/app/build.gradle.kts', 'utf8');
  expect(gradle).toContain('buildConfigField("boolean", "WEBVIEW_CONTROL_ENABLED", "true")');
  expect(gradle).toContain('isDebuggable = false');
  expect(gradle).toContain('isJniDebuggable = false');
  expect(activity).toContain('WebView.setWebContentsDebuggingEnabled(BuildConfig.WEBVIEW_CONTROL_ENABLED)');
  expect(activity.indexOf('WebView.setWebContentsDebuggingEnabled')).toBeLessThan(activity.indexOf('NodeRuntime.ensureStarted'));
  expect(activity).not.toContain('getIntent(');
  expect(activity).not.toContain('onNewIntent');
  const relay = await readFile('apps/android/app/src/main/java/kr/goltou/auto/DevtoolsRelay.kt', 'utf8');
  expect(relay).toContain('File(filesDir, "devtools.sock")');
  expect(relay).toContain('LocalSocketAddress.Namespace.FILESYSTEM');
  expect(relay).toContain('LocalSocketAddress.Namespace.ABSTRACT');
  expect(relay).toContain('webview_devtools_remote_${Process.myPid()}');
  expect(relay).not.toContain('java.net.ServerSocket');
  const manifest = await readFile('apps/android/app/src/main/AndroidManifest.xml', 'utf8');
  expect(manifest.match(/android:exported="true"/g)).toHaveLength(1); // launcher only
  expect(manifest).not.toMatch(/<service|<receiver|android.intent.action.VIEW/);
  const bridge = await readFile('apps/android/bridge/main.ts', 'utf8');
  expect(bridge).toContain("new AndroidSurfaceHost(native, argument('devtools'))");
  expect(bridge).not.toContain("argument('devtools'), __GOLTOU_DEBUG__");
});
it.each([1, 2])('fails closed for an absent or multiple signer digest (%s)', async count => {
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    ". ./scripts/apk-signature.ps1; $text=if($env:DIGEST_TEST_COUNT -eq '1'){'no signer'}else{('Signer #1 certificate SHA-256 digest: '+('a'*64)+[Environment]::NewLine+'Signer #2 certificate SHA-256 digest: '+('b'*64))}; try { Read-CertificateDigest $text; exit 2 } catch { Write-Output 'REJECTED' }"], { env: { ...process.env, DIGEST_TEST_COUNT: String(count) } });
  expect(result.stdout).toContain('REJECTED');
});
it('normalizes one valid certificate digest', async () => {
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    ". ./scripts/apk-signature.ps1; Read-CertificateDigest ('Signer #1 certificate SHA-256 digest: '+('ab'*32))"]);
  expect(result.stdout.trim()).toBe('AB'.repeat(32));
});
it.each(['SAME', 'DIFFERENT'])('compares installed and release certificates with read-only adb calls: %s', async comparison => {
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    ". ./scripts/apk-signature.ps1; function Get-ApkCertificate([string]$Path,[switch]$Release) { if($Release -or $env:CERT_TEST_RESULT -eq 'SAME') { return ('A'*64) }; return ('B'*64) }; function adb { $global:LASTEXITCODE=0; if(($args[0..2] -join ' ') -eq 'shell pm path') { return 'package:/data/app/synthetic/base.apk' }; if($args[0] -eq 'pull') { [IO.File]::WriteAllText($args[2], 'fixture'); return }; throw 'MUTATING_ADB_CALL_FORBIDDEN' }; Compare-InstalledCertificate 'synthetic-release.apk'"], { env: { ...process.env, CERT_TEST_RESULT: comparison } });
  expect(result.stdout.trim()).toBe(comparison);
});
it('checks both schemes over the v2 platform range even when manifest minSdk would skip v2', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scheme-range-test-')); directories.push(directory);
  const signer = path.join(directory, 'signer.ps1');
  await writeFile(signer, `if (($args -join ' ') -notmatch '--min-sdk-version 24') { throw 'V2_RANGE_NOT_CHECKED' }\nWrite-Output 'Verified using v2 scheme (APK Signature Scheme v2): true'\nWrite-Output 'Verified using v3 scheme (APK Signature Scheme v3): true'\nWrite-Output ('Signer #1 certificate SHA-256 digest: ' + $env:CERT_TEST_DIGEST)\n$global:LASTEXITCODE=0\n`);
  const digest = (await readFile('apps/android/release-certificate.sha256', 'utf8')).trim();
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    ". ./scripts/apk-signature.ps1; function Get-ApkSigner { return $env:CERT_TEST_SIGNER }; Get-ApkCertificate 'synthetic.apk' -Release"], { env: { ...process.env, CERT_TEST_SIGNER: signer, CERT_TEST_DIGEST: digest } });
  expect(result.stdout.trim()).toBe(digest);
});
