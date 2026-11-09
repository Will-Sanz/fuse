import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'self-contained-mcp-resource',
      enforce: 'post',
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
          const assets = Object.values(bundle).filter((item) => item.type === 'asset');
          if (chunks.length !== 1 || assets.some((item) => !item.fileName.endsWith('.css')))
            this.error('Inline review must contain one script and only inline styles.');
          const notice = readFileSync(
            new URL('./src/liquidglass/vendor/HTML-TO-IMAGE-LICENSE', import.meta.url),
            'utf8',
          ).replace(/-->/g, '-- >');
          const script = chunks[0].code.replace(/<\/script/gi, '<\\/script');
          const css = assets
            .map((item) => item.source)
            .join('\n')
            .replace(/<\/style/gi, '<\\/style');
          if (!css.length)
            this.error('Inline review styles were not emitted before resource assembly.');
          for (const name of Object.keys(bundle)) delete bundle[name];
          this.emitFile({
            type: 'asset',
            fileName: 'review.html',
            source: `<!doctype html><!-- LiquidGlass @ybouane/liquidglass 1.0.3 (MIT declared upstream). Bundled html-to-image notice:\n${notice}\n--><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fuse review</title><style>${css}</style></head><body class="dark-mode"><div id="root"></div><script>${script}</script></body></html>`,
          });
        },
      },
    },
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist/inline',
    emptyOutDir: true,
    lib: {
      entry: 'src/inline/main.tsx',
      name: 'FuseReview',
      formats: ['iife'],
      fileName: 'review',
      cssFileName: 'review',
    },
  },
});
