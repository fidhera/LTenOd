const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 }
  },
  reporter: [['list']]
});
