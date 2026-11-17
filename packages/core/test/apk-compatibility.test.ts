import { afterAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const directories: string[] = [];
afterAll(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });
const commit = '1'.repeat(40);

// The APK gate reads ZIP bytes, not dist/ or a generated asset directory.
it.each([
  { code: 'const tags = /[가-힣A-Za-z0-9_]+/gu;', sha: commit, expected: 'APK_COMPAT_PASSED' },
  { code: String.raw`const tags = /(?:^|\s)#[\p{L}\p{N}_]+/gu;`, sha: commit, expected: 'APK_EMBEDDED_COMPAT_FAILED' },
  { code: String.raw`const tags = new RegExp('\\p{L}', 'u');`, sha: commit, expected: 'APK_EMBEDDED_COMPAT_FAILED' },
  { code: 'const tags = /abc/;', sha: '2'.repeat(40), expected: 'APK_COMMIT_MISMATCH' },
])('checks the actual APK payload: $expected ($code)', async ({ code, sha, expected }) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'goltou-compat-test-')); directories.push(directory);
  const source = path.join(directory, 'payload');
  const bundle = path.join(source, 'assets/bundle');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(bundle, { recursive: true });
  await writeFile(path.join(bundle, 'engine.cjs'), code);
  await writeFile(path.join(bundle, 'core.cjs'), "require('./engine.cjs');");
  await writeFile(path.join(bundle, 'manifest.json'), JSON.stringify({ sourceCommit: sha }));
  const apk = path.join(directory, 'test.apk');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[IO.Compression.ZipFile]::Open($env:COMPAT_ZIP_DEST, 'Create'); try { foreach($name in @('core.cjs','engine.cjs','manifest.json')) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $env:COMPAT_ZIP_SOURCE $name),('assets/bundle/'+$name)) | Out-Null } } finally { $zip.Dispose() }"],
  { env: { ...process.env, COMPAT_ZIP_SOURCE: bundle, COMPAT_ZIP_DEST: apk } });
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/check-apk-compat.ps1', '-Apk', apk, '-ExpectedCommit', commit]).then(
    value => ({ passed: true, text: value.stdout }),
    error => ({ passed: false, text: String(error.stderr) }),
  );
  expect(result.passed, result.text).toBe(expected === 'APK_COMPAT_PASSED');
  expect(result.text).toContain(expected);
}, 30000);
