import { afterAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

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
  expect(engine).toContain('BLOG_POST_DELETE_CHECK_');
  expect(engine).toContain('BLOG_POST_DELETED');
  expect(engine).not.toContain('blog.checkTestPostDeleted');
  expect(engine).not.toContain('.read-dialog');
  for (const marker of ['one-band-post.allow', 'blog-only-test', 'band-only-test']) expect(engine.includes(marker), marker).toBe(false);
  expect(engine).not.toContain('RELEASE_AUTOMATION_UNAVAILABLE');
  expect(engine).not.toContain('uncertain-band-cleanup.json');
  expect(engine).not.toContain('linkUncertainBandForDeletion');
  for (const marker of ['record-delete-context.json', 'record-delete-shape.jsonl', 'blog.inspectRecordedPost', 'recoverPrivatePublish', 'verifyInterruptedPrivatePublish', 'private-publish-context.json', 'blog.verifyPrivatePublish', 'recoverTestPostCleanup', 'cleanup-context.json', 'publishResponseShape', 'publish-response-shape.json', 'WP14 private-once']) expect(engine.includes(marker), marker).toBe(false);
  for (const marker of ['publishProbeShape', '"blog.publishProbe"', 'configurePublishProbe:', 'blocked-unconditionally', 'auditConversions', 'experimentTitle: true', 'draftSaveLimit: 1', 'photoPaths:', 'class Experiments', 'delete-test-post', 'BLOG_TEST_DELETE_ALREADY_ATTEMPTED', 'BLOG_TEST_DELETE_CONFIRM_UNCONFIRMED', 'blog.deleteTestPost']) expect(engine.includes(marker), marker).toBe(false);
  const uiFiles = await readdir(path.join(assets, 'ui/assets'));
  const ui = (await Promise.all(uiFiles.filter(file => file.endsWith('.js')).map(file => readFile(path.join(assets, 'ui/assets', file), 'utf8')))).join('\n');
  expect(ui).toContain('블로그 글을 삭제할까요?');
  expect(ui).toContain('되돌릴 수 없습니다.');
  expect(ui).toContain('로그 내보내기');
  expect(ui).toContain('데이터 내보내기');
  expect(ui).not.toContain('자동 등록을 사용할 수 없습니다.');
  expect(ui).not.toContain('삭제 결과만 확인');
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
  const connections: WebSocket[] = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      ready = await fetch(`http://127.0.0.1:${port}/health?token=${token}`).then(response => response.ok).catch(() => false);
      if (ready || child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(ready).toBe(true);
    expect(await fetch(`http://127.0.0.1:${port}/ui/?token=${token}`).then(response => response.status)).toBe(200);
    let document: string | null = null, logExports = 0;
    const unexpectedNative: string[] = [];
    const native = new WebSocket(`ws://127.0.0.1:${port}/native?token=${token}`); connections.push(native);
    native.on('message', raw => {
      const message = JSON.parse(String(raw)) as { id: number; op: string; text?: string };
      let result: unknown = {};
      if (message.op === 'session.read') result = { token: null };
      else if (message.op === 'logs.environment') result = { appVersion: manifest.version, deviceModel: 'PC fixture', webViewVersion: 'synthetic' };
      else if (message.op === 'localData.export') { document = message.text!; result = { text: '' }; }
      else if (message.op === 'localData.import') result = { text: document };
      else if (message.op === 'logs.export') logExports++;
      else unexpectedNative.push(message.op);
      native.send(JSON.stringify({ id: message.id, ok: true, result }));
    });
    await new Promise<void>((resolve, reject) => { native.once('open', resolve); native.once('error', reject); });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ui-socket?token=${token}`, { origin: `http://127.0.0.1:${port}` }); connections.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let id = 0;
    const request = (command: string, input = {}, type = 'app') => new Promise<Record<string, unknown>>((resolve, reject) => {
      const current = ++id;
      const timeout = setTimeout(() => { socket.off('message', receive); reject(Error('RELEASE_COMMAND_TIMEOUT')); }, 5000);
      const receive = (raw: WebSocket.RawData) => {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        if (message.id !== current) return;
        clearTimeout(timeout); socket.off('message', receive); resolve(message);
      };
      socket.on('message', receive); socket.send(JSON.stringify({ id: current, type, command, input }));
    });
    const preferences = { polish: true, closing: false, linkCard: false, lastBandKey: '111' };
    expect(await request('preferences.save', preferences)).toMatchObject({ type: 'reply', data: preferences });
    expect(await request('localData.export')).toMatchObject({ type: 'reply', data: { cancelled: false } });
    expect(JSON.parse(document!).preferences).toEqual(preferences);
    expect(document).not.toMatch(/cookie|token|password|one-band-post/);
    await request('preferences.save', { ...preferences, polish: false, lastBandKey: '' });
    expect(await request('localData.import')).toMatchObject({ type: 'reply', data: { cancelled: false, preferences } });
    expect(await request('preferences.get')).toMatchObject({ type: 'reply', data: preferences });
    expect(await request('logs.list')).toMatchObject({ type: 'reply', data: [] });
    expect(await request('logs.export')).toMatchObject({ type: 'reply' });
    expect(logExports).toBe(1);
    for (const [command, type] of [['simulation.configure', 'app'], ['info', 'experiment']]) {
      expect(await request(command!, {}, type!)).toMatchObject({ type: 'error', message: 'DEBUG_ONLY' });
    }
    expect(unexpectedNative).toEqual([]);
  } finally {
    for (const socket of connections) socket.terminate();
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    if (child.exitCode === null) { child.kill(); await exited; }
  }
}, 60000);
