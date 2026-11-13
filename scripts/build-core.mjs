// Reference: ../refs/DAF/daf3/apps/mobile/scripts/build-core.mjs (Node 18 bundle + built-in UI only).
import { build } from 'esbuild';
import { apiOrigin } from './app-config.mjs';
const debugBuild = !process.argv.includes('--release');
import { build as viteBuild } from 'vite';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
// Resolve and verify fixed generated directories before recursively replacing their contents.
function clearGenerated(dir) {
  if (!path.resolve(dir).startsWith(path.resolve(root) + path.sep)) throw new Error('INVALID_BUILD_OUTPUT');
  rmSync(dir, { recursive: true, force: true });
}
clearGenerated(out);
mkdirSync(out, { recursive: true });
const config = { minifySyntax: true, bundle: true, platform: 'node', target: 'node18', format: 'cjs', external: ['bufferutil', 'utf-8-validate'], logLevel: 'warning' };
await build({ ...config, entryPoints: [path.join(root, 'packages/core/src/index.ts')], outfile: path.join(out, 'core-api.cjs') });
await build({ ...config, entryPoints: [path.join(root, 'packages/surface/src/cdp/index.ts')], outfile: path.join(out, 'surface.cjs') });
await build({ ...config, entryPoints: [path.join(root, 'apps/android/bridge/main.ts')], outfile: path.join(out, 'engine.cjs'), define: { __GOLTOU_API_ORIGIN__: JSON.stringify(apiOrigin), __GOLTOU_DEBUG__: JSON.stringify(debugBuild) } });
writeFileSync(path.join(out, 'core.cjs'), `// Built-in embedded Node bootstrap. No downloaded code.\ntry { require('./engine.cjs'); } catch (error) { console.error('core load failed', error); setInterval(() => {}, 60000); }\n`);
await viteBuild({ configFile: path.join(root, 'packages/ui/vite.config.ts'), logLevel: 'warn' });
cpSync(path.join(root, 'packages/ui/dist'), path.join(out, 'ui'), { recursive: true });
cpSync(path.join(root, 'packages/sites/fixtures'), path.join(out, 'fixtures'), { recursive: true });
const hash = createHash('sha256');
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
digest(path.join(out, 'fixtures'));
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version: '0.1.0', debug: debugBuild, sha256: hash.digest('hex') }, null, 2));
const android = path.join(root, 'apps/android/app/src/main/assets/bundle');
clearGenerated(android);
mkdirSync(android, { recursive: true });
for (const file of ['core.cjs', 'engine.cjs', 'manifest.json', 'ui', 'fixtures']) cpSync(path.join(out, file), path.join(android, file), { recursive: true });
console.log('Node 18 core + React UI → dist, apps/android/app/src/main/assets/bundle');
