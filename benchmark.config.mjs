import config from './playwright.config.mjs';
export default { ...config, testMatch: ['benchmark.mjs', 'benchmark-commands.mjs', 'benchmark-memory.mjs', 'benchmark-batch.mjs', 'benchmark-rendering.mjs'], workers: 1 };
