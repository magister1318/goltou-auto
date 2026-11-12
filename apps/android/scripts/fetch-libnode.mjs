// Reference: ../refs/DAF/daf3/apps/mobile/scripts/fetch-libnode.mjs (prebuilt nodejs-mobile extraction).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const version = '18.20.4';
// npm registry published package checksum, pinned to the reference runtime version.
const expectedSha1 = 'b95947496e90ba1778353108b27d631bd4a614fb';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'app/libnode');
const stamp = path.join(target, 'VERSION');
const abis = ['arm64-v8a', 'armeabi-v7a'];
if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === `${version} sha1=${expectedSha1}`
  && abis.every(abi => existsSync(path.join(target, 'bin', abi, 'libnode.so')))
  && existsSync(path.join(target, 'include/node/node.h'))) {
  console.log(`libnode ${version} already present`);
} else {
  const work = path.join(root, '.libnode-download');
  mkdirSync(work, { recursive: true });
  const response = await fetch(`https://registry.npmjs.org/nodejs-mobile-react-native/-/nodejs-mobile-react-native-${version}.tgz`);
  if (!response.ok) throw new Error(`LIBNODE_DOWNLOAD_FAILED ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (createHash('sha1').update(buffer).digest('hex') !== expectedSha1) throw new Error('LIBNODE_CHECKSUM_MISMATCH');
  const archive = path.join(work, 'package.tgz');
  writeFileSync(archive, buffer);
  execFileSync('tar', ['xzf', archive, '-C', work]);
  const source = path.join(work, 'package/android/libnode');
  mkdirSync(target, { recursive: true });
  cpSync(path.join(source, 'include'), path.join(target, 'include'), { recursive: true });
  for (const abi of abis) cpSync(path.join(source, 'bin', abi), path.join(target, 'bin', abi), { recursive: true });
  writeFileSync(stamp, `${version} sha1=${expectedSha1}\n`);
  // Both paths are fixed descendants of this script's Android workspace.
  if (path.dirname(work) !== path.resolve(root)) throw new Error('INVALID_CLEANUP_PATH');
  rmSync(work, { recursive: true, force: true });
  console.log(`libnode ${version}: ${abis.join(', ')} → apps/android/app/libnode`);
}
