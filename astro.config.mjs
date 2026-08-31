// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // localhostだとIPv6(::1)にしかバインドされずGoogle OAuthの戻り先(127.0.0.1)で
  // 接続拒否になることがあるため、開発時は127.0.0.1を明示する
  server: { host: '127.0.0.1' },
  integrations: [react()],
  adapter: vercel()
});