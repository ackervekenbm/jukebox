import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    port: 5199,
    strictPort: false,
    watch: {
      usePolling: true,
      interval: 150,
    },
    proxy: {
      // Same-origin proxy: the API server owns /discogs and /api in both dev
      // and production, so the browser never talks cross-origin to Discogs
      // (Discogs' rate-limit 429s carry no Access-Control-Allow-Origin).
      '/discogs': {
        target: 'http://127.0.0.1:3000',
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
      },
      '/oauth': {
        target: 'http://127.0.0.1:3000',
      },
    },
  },
  define: {
    // Injected at build time. Locally (vite dev) these fall back to dev
    // values; the Docker build receives them as ARGs from the workflow.
    __BUILD_SHA__: JSON.stringify(process.env.COMMIT_SHA ?? 'dev'),
    __BUILD_TIME__: JSON.stringify(process.env.BUILD_TIME ?? ''),
    __REPO__: JSON.stringify(process.env.GITHUB_REPOSITORY ?? 'ackervekenbm/jukebox'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'],
      manifest: {
        name: 'Jukebox',
        short_name: 'Jukebox',
        description: 'Browse your Discogs collection.',
        lang: 'en',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\.(png|jpe?g|webp|gif|avif)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'album-art',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})