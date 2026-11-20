import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'evals/**/*.test.ts'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/lib/**/*.ts', 'src/app/api/**/*.ts', 'worker/**/*.ts'],
      exclude: ['**/*.d.ts', '**/types.ts'],
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
