import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Stub next/navigation so tests don't need Next.js runtime
      'next/navigation': path.resolve(__dirname, 'tests/__stubs__/next-navigation-stub.ts'),
      'next/image': path.resolve(__dirname, 'tests/__stubs__/next-image-stub.tsx'),
      'next/link': path.resolve(__dirname, 'tests/__stubs__/next-link-stub.tsx'),
    },
  },
});
