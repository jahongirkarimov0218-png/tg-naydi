const config = {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: {
    configFile: 'vitest.stryker.config.ts',
    related: true,
  },
  mutate: [
    'src/lib/phone-normalizer.ts',
    'src/lib/csv-exporter.ts',
    'src/lib/csv-parser.ts',
    'src/lib/logger.ts',
    'src/lib/auth.ts',
    'src/lib/job-engine.ts',
    'src/lib/job-store/index.ts',
    'src/lib/providers/mtproto.ts',
  ],
  reporters: ['clear-text', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  coverageAnalysis: 'perTest',
  concurrency: 4,
  timeoutMS: 15000,
  thresholds: {
    high: 90,
    low: 80,
    break: null,
  },
};

export default config;
