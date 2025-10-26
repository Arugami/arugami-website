// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://arugami.com',
  server: {
    port: 3000
  },
  integrations: [
    tailwind(),
    sitemap()
  ],
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
    // Force cache busting with timestamp
    assets: `_astro_${Date.now()}`
  },
  vite: {
    build: {
      cssCodeSplit: false,
      // Add cache busting to JS/CSS files
      rollupOptions: {
        output: {
          entryFileNames: `[name]-${Date.now()}.js`,
          chunkFileNames: `[name]-${Date.now()}.js`,
          assetFileNames: `[name]-${Date.now()}.[ext]`
        }
      }
    }
  }
});
