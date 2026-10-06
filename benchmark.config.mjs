import config from './playwright.config.mjs';
export default { ...config, testMatch: ['benchmark.mjs', 'benchmark-commands.mjs', 'benchmark-memory.mjs', 'benchmark-batch.mjs'], workers: 1 };
