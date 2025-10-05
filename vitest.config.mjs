import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resolveFromRoot = (...segments) => resolve(__dirname, ...segments);

export default defineConfig({
  resolve: {
    alias: {
      '@': resolveFromRoot('src'),
      '@/core': resolveFromRoot('src/core'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    env: {
      VDE_TEST_MODE: 'true',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.d.ts', '**/*.config.*', '**/__tests__/**'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
