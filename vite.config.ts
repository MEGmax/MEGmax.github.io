import { defineConfig } from 'vite';
import { cssVariables, palette } from './src/palette.ts';

export default defineConfig({
  // User site: served from the domain root (https://megmax.github.io/).
  base: '/',
  build: {
    // Keep Vite's hashed bundles apart from the static files in public/assets.
    assetsDir: '_app',
    target: 'es2020',
    // three.js lives in the lazily-loaded scene chunk
    chunkSizeWarningLimit: 600,
  },
  plugins: [
    {
      name: 'palette-css-vars',
      transformIndexHtml(html) {
        return html
          .replace('<!-- palette -->', `<style id="palette">${cssVariables()}</style>`)
          .replaceAll('%PALETTE_BASE%', palette.base);
      },
    },
  ],
});
