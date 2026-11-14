import { afterAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const run = promisify(execFile);
const directories: string[] = [];
afterAll(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });

it.each([
  { args: ['--out'], error: 'MISSING_BUILD_OUTPUT' },
  { args: ['--out', path.resolve('..')], error: 'INVALID_BUILD_OUTPUT' },
  { args: ['--out', path.resolve('packages')], error: 'INVALID_BUILD_OUTPUT' },
])('rejects invalid build output before touching files ($error)', async ({ args, error }) => {
  await expect(run(process.execPath, ['scripts/build-core.mjs', ...args])).rejects.toThrow(error);
});

it('builds isolated release assets, strips debug tools and starts the bundled core offline', async () => {
  await mkdir('tmp', { recursive: true });
  const directory = await mkdtemp(path.resolve('tmp/wp12-release-')); directories.push(directory);
  await run(process.execPath, ['scripts/build-core.mjs', '--release', '--out', directory]);
  const assets = path.join(directory, 'android-assets/bundle');
  expect((await readdir(assets)).sort()).toEqual(['core.cjs', 'engine.cjs', 'manifest.json', 'ui']);
  const manifest = JSON.parse(await readFile(path.join(assets, 'manifest.json'), 'utf8'));
  const version = await readFile('apps/android/version.properties', 'utf8');
  expect(manifest.debug).toBe(false);
  expect(version).toContain(`versionName=${manifest.version}`);
  expect(version).toContain(`versionCode=${manifest.versionCode}`);
  const engine = await readFile(path.join(assets, 'engine.cjs'), 'utf8');
  for (const marker of ['recoverTestPostCleanup', 'cleanup-context.json', 'publishResponseShape', 'publish-response-shape.json', 'WP14 private-once']) expect(engine.includes(marker), marker).toBe(false);
  for (const marker of ['publishProbeShape', '"blog.publishProbe"', 'configurePublishProbe:', 'blocked-unconditionally', 'auditConversions', 'experimentTitle: true', 'draftSaveLimit: 1', 'photoPaths:', 'class Experiments', 'delete-test-post', 'BLOG_TEST_DELETE_ALREADY_ATTEMPTED', 'BLOG_TEST_DELETE_CONFIRM_UNCONFIRMED', 'blog.deleteTestPost']) expect(engine.includes(marker), marker).toBe(false);
  const uiFiles = await readdir(path.join(assets, 'ui/assets'));
  const ui = (await Promise.all(uiFiles.filter(file => file.endsWith('.js')).map(file => readFile(path.join(assets, 'ui/assets', file), 'utf8')))).join('\n');
  for (const marker of ['이번 비공개 실험 글 삭제', '비공개 차단 프로브 설정', '전체공개 차단 프로브 설정', 'blog.publishProbe', '변환 점검', 'conversion.check', '실험 화면 열기', 'WP1 숨김 브라우저', '가짜 실행 설정', '실험 글 삭제', 'blog.deleteTestPost']) expect(ui.includes(marker), marker).toBe(false);
  expect(uiFiles.some(file => file.startsWith('Experiments-'))).toBe(false);

  // No login, API calls, external page or CDP connection is needed to boot the release core.
  const reservation = http.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as import('node:net').AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const token = '0'.repeat(64);
  const child = spawn(process.execPath, [path.join(assets, 'core.cjs'), '--port', String(port), '--token', token,
    '--devtools', path.join(directory, 'unused.sock'), '--bundle', assets, '--debug', 'false', '--data', path.join(directory, 'data')], { stdio: 'ignore' });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      ready = await fetch(`http://127.0.0.1:${port}/health?token=${token}`).then(response => response.ok).catch(() => false);
      if (ready || child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(ready).toBe(true);
    expect(await fetch(`http://127.0.0.1:${port}/ui/?token=${token}`).then(response => response.status)).toBe(200);
  } finally {
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    if (child.exitCode === null) { child.kill(); await exited; }
  }
}, 60000);
