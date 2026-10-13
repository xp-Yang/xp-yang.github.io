import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';

// Reuse the site's UI module and its installed toolchain for this standalone app.
export default {
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  // The app targets module-capable WebGL2 browsers and has no async chunks.
  // Native module loading is sufficient; avoid an unnecessary DOM observer.
  build: { target: 'es2022', modulePreload: { polyfill: false } },
};
