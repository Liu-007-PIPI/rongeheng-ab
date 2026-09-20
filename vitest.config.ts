import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // 测试固定走本地后端，不去碰真实的 Supabase 项目
    env: { VITE_DATA_BACKEND: 'local' },
    globals: true,
    restoreMocks: true,
  },
});
