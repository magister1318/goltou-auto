import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const version = Object.fromEntries(readFileSync(fileURLToPath(new URL('../../apps/android/version.properties', import.meta.url)), 'utf8').trim().split(/\r?\n/).map(line => line.split('=')));
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), base: '/ui/', define: { __GOLTOU_DEBUG__: 'true', __GOLTOU_VERSION__: JSON.stringify(version.versionName), __GOLTOU_VERSION_CODE__: version.versionCode! }, build: { target: 'chrome100', outDir: 'dist', emptyOutDir: true } });
