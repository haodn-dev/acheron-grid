import config from './playwright.config.mjs';
export default { ...config, testMatch: 'benchmark.mjs', workers: 1 };
