import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4179', browserName: process.env.ACHERON_TEST_BROWSER || 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/server.mjs', url: 'http://127.0.0.1:4179', reuseExistingServer: false },
});
