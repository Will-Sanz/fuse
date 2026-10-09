import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/showcase',
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  outputDir: 'test-results/showcase',
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3102',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:showcase && npx vite preview --host 127.0.0.1 --port 3102',
    url: 'http://127.0.0.1:3102',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
