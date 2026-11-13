import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), base: '/ui/', define: { __GOLTOU_DEBUG__: 'true' }, build: { target: 'chrome100', outDir: 'dist', emptyOutDir: true } });
