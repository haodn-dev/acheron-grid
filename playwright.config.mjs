import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    browserName: process.env.ACHERON_TEST_BROWSER || 'chromium',
    // Keep Firefox's last chrome window alive while contexts dispose their tabs.
    ...(process.env.ACHERON_TEST_BROWSER === 'firefox'
      ? { launchOptions: { firefoxUserPrefs: { 'browser.tabs.closeWindowWithLastTab': false } } }
      : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'node tests/server.mjs', url: 'http://127.0.0.1:4179', reuseExistingServer: false },
});
