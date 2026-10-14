import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', modulePreload: { polyfill: false } },
});
