import config from './playwright.config.mjs';
export default { ...config, testMatch: 'playground.mjs',
  use: { ...config.use, baseURL: 'http://127.0.0.1:4180' },
  webServer: { ...config.webServer, command: 'node examples/vanilla/server.mjs', url: 'http://127.0.0.1:4180' },
};
