import { defineConfig } from 'vite';
export default defineConfig({
  root: '.', publicDir: false,
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  resolve: { dedupe: ['preact', '@preact/signals-core'] },
  optimizeDeps: { noDiscovery: true, include: ['preact', 'preact/hooks', 'preact/jsx-runtime', '@preact/signals', '@preact/signals-core'] },
});
