import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// VITE_BASE=/nz-deals-app/ pnpm build  → GitHub Pages
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'NZ Deals',
        short_name: 'NZ Deals',
        description: 'Same item, which store is cheapest this week.',
        theme_color: '#111111',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        importScripts: ['push-sw.js'],   // 推播的 push / notificationclick 在 public/push-sw.js
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(a\.fsimg\.co\.nz|assets\.woolworths\.com\.au)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-images',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { host: '127.0.0.1' },
})
