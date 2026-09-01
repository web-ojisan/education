// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import AstroPWA from '@vite-pwa/astro';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // localhostだとIPv6(::1)にしかバインドされずGoogle OAuthの戻り先(127.0.0.1)で
  // 接続拒否になることがあるため、開発時は127.0.0.1を明示する
  server: { host: '127.0.0.1' },
  integrations: [
    react(),
    // ドリル画面(/drill と /multiplication)のみオフラインで動くようにするPWA設定。
    // /children など他の画面はキャッシュ対象に含めず、オンライン専用のままにする。
    AstroPWA({
      registerType: 'autoUpdate',
      // このサイトは output: 'server' (SSR) で、@vite-pwa/astroの自動SW登録は
      // 静的HTMLファイルへの後処理(astro:build:done)前提のため、SSRページには効かない。
      // そのためinjectRegisterは無効化し、DrillIsland側でnavigator.serviceWorker.register()を
      // 直接呼んで登録する
      injectRegister: false,
      // astro dev(開発サーバー)ではvite-plugin-pwaはデフォルトで無効化されるため、
      // 動作確認できるように開発時も有効化しておく
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        // 仮の名前・アイコン。正式なブランド素材が揃うまでのプレースホルダー
        name: 'さんすう図形ドリル',
        short_name: 'ずけいドリル',
        description: '小学校低学年向けの算数・図形学習ドリル',
        start_url: '/drill',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        // ドリル画面以外のナビゲーションはキャッシュしない(オンライン専用の画面を
        // オフラインで開けてしまうのを避けるため)
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) => request.mode === 'navigate' && url.pathname === '/drill',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'drill-page',
              networkTimeoutSeconds: 3,
            },
          },
          {
            urlPattern: ({ url, request }) => request.mode === 'navigate' && url.pathname === '/multiplication',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'multiplication-page',
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
    }),
  ],
  adapter: vercel()
});