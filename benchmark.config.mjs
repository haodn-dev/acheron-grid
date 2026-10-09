import config from './playwright.config.mjs';
export default {
  ...config,
  testMatch: [
    'benchmark-worker.mjs',
    'benchmark.mjs',
    'benchmark-commands.mjs',
    'benchmark-memory.mjs',
    'benchmark-batch.mjs',
    'benchmark-rendering.mjs',
    'benchmark-responsiveness.mjs',
  ],
  workers: 1,
};
