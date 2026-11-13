// Reference: ../refs/DAF/daf3/apps/mobile/scripts/build-core.mjs (Node 18 bundle + built-in UI only).
import { build } from 'esbuild';
import { apiOrigin } from './app-config.mjs';
const debugBuild = !process.argv.includes('--release');
import { build as viteBuild } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputIndex = process.argv.indexOf('--out');
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error('MISSING_BUILD_OUTPUT');
const out = outputIndex < 0 ? path.join(root, 'dist') : path.resolve(process.argv[outputIndex + 1]);
if (outputIndex >= 0 && ![path.join(root, 'tmp'), path.join(root, 'apps/android/app/build/generated')]
  .some(base => out.startsWith(base + path.sep))) throw new Error('INVALID_BUILD_OUTPUT');
const version = Object.fromEntries(readFileSync(path.join(root, 'apps/android/version.properties'), 'utf8').trim().split(/\r?\n/).map(line => line.split('=')));
// Resolve and verify fixed generated directories before recursively replacing their contents.
function clearGenerated(dir) {
  let ancestor = path.resolve(dir);
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolved = path.resolve(realpathSync(ancestor), path.relative(ancestor, path.resolve(dir)));
  if (!resolved.startsWith(realpathSync(root) + path.sep)) throw new Error('INVALID_BUILD_OUTPUT');
  rmSync(dir, { recursive: true, force: true });
}
clearGenerated(out);
mkdirSync(out, { recursive: true });
const config = { minifySyntax: true, bundle: true, platform: 'node', target: 'node18', format: 'cjs', external: ['bufferutil', 'utf-8-validate'], logLevel: 'warning' };
await build({ ...config, entryPoints: [path.join(root, 'packages/core/src/index.ts')], outfile: path.join(out, 'core-api.cjs') });
await build({ ...config, entryPoints: [path.join(root, 'packages/surface/src/cdp/index.ts')], outfile: path.join(out, 'surface.cjs') });
await build({ ...config, entryPoints: [path.join(root, 'apps/android/bridge/main.ts')], outfile: path.join(out, 'engine.cjs'), define: { __GOLTOU_API_ORIGIN__: JSON.stringify(apiOrigin), __GOLTOU_DEBUG__: JSON.stringify(debugBuild) } });
writeFileSync(path.join(out, 'core.cjs'), `// Built-in embedded Node bootstrap. No downloaded code.\ntry { require('./engine.cjs'); } catch { console.error('CORE_LOAD_FAILED'); setInterval(() => {}, 60000); }\n`);
await viteBuild({ configFile: path.join(root, 'packages/ui/vite.config.ts'), logLevel: 'warn',
  define: { __GOLTOU_DEBUG__: JSON.stringify(debugBuild) }, build: { outDir: path.join(out, 'ui') } });
if (debugBuild) cpSync(path.join(root, 'packages/sites/fixtures'), path.join(out, 'fixtures'), { recursive: true });
const hash = createHash('sha256');
hash.update(JSON.stringify({ version: version.versionName, versionCode: Number(version.versionCode), debug: debugBuild }));
function digest(dir) {
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) digest(file);
    else hash.update(path.relative(out, file)).update('\0').update(readFileSync(file));
  }
}
// Only files that ship on Android participate in the built-in asset identity.
for (const file of ['core.cjs', 'engine.cjs']) hash.update(readFileSync(path.join(out, file)));
digest(path.join(out, 'ui'));
if (debugBuild) digest(path.join(out, 'fixtures'));
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version: version.versionName, versionCode: Number(version.versionCode), debug: debugBuild, sha256: hash.digest('hex') }, null, 2));
const android = outputIndex < 0 ? path.join(root, 'apps/android/app/src/main/assets/bundle') : path.join(out, 'android-assets/bundle');
clearGenerated(android);
mkdirSync(android, { recursive: true });
for (const file of ['core.cjs', 'engine.cjs', 'manifest.json', 'ui', ...(debugBuild ? ['fixtures'] : [])]) cpSync(path.join(out, file), path.join(android, file), { recursive: true });
console.log(`Node 18 core + React UI (${debugBuild ? 'debug' : 'release'}) built`);
