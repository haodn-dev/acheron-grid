import { test as base, expect } from '@playwright/test';

export { expect };
export const test = base.extend({
  page: async ({ page, browserName }, use) => {
    if (browserName === 'firefox') await page.addInitScript(() => {
      const NativeClipboardEvent = window.ClipboardEvent;
      // Firefox protects/clones synthetic clipboard stores. Inject the explicit test payload;
      // real browser clipboard events retain their native constructor and data policies.
      window.ClipboardEvent = class extends NativeClipboardEvent {
        constructor(type, options = {}) {
          super(type, options);
          if (options.clipboardData) Object.defineProperty(this, 'clipboardData', { value: options.clipboardData });
        }
      };
    });
    await use(page);
  },
});
