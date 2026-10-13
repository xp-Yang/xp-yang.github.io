import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';

// Reuse the site's UI module and its installed toolchain for this standalone app.
const config = {
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  // Native module loading covers the WebGPU app and lazy WebGL fallback.
  // No legacy preload polyfill is required.
  build: { target: 'es2022', modulePreload: { polyfill: false } },
};

export default config;
