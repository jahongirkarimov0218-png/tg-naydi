import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm exec next start -H 127.0.0.1 -p 3100',
        url: 'http://127.0.0.1:3100/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          ...process.env,
          PROVIDER_MODE: 'SANDBOX',
          NEXT_PUBLIC_PROVIDER_MODE: 'SANDBOX',
          TGNAYDI_DATA_DIR: '.data/e2e-jobs',
        },
      },
});
