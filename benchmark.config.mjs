import config from './playwright.config.mjs';
export default { ...config, testMatch: ['benchmark.mjs', 'benchmark-commands.mjs'], workers: 1 };
