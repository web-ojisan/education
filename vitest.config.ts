import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // RLSテストは実際のローカルSupabaseに接続するため、並列実行によるデータ競合を避ける
    fileParallelism: false,
  },
});
