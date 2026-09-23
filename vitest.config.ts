import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    env: {
      // 测试固定走本地后端，不去碰真实的 Supabase 项目
      VITE_DATA_BACKEND: 'local',
      /*
       * 默认按定向模式跑：匿名码决定分组，A/B 相关断言才有确定的期望值。
       * 开放模式（生产默认）的行为在 src/openMode.test.tsx 里单独覆盖，
       * 那个文件用 vi.stubEnv + 动态 import 拿到自己的模块实例。
       */
      VITE_REQUIRE_ACCESS_CODE: 'true',
    },
    globals: true,
    restoreMocks: true,
  },
});
