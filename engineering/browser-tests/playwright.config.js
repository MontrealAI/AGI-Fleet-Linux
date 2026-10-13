import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  testDir: process.env.FLEET_TEST_ROOT ? './fleet-tests' : './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  timeout: 30_000,
  globalTimeout: 180_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: false,
    serviceWorkers: 'block',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args:['--no-sandbox']} : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: process.env.FLEET_TEST_ROOT ? undefined : {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory _site',
    cwd: root,
    url: 'http://127.0.0.1:4173/start.html',
    reuseExistingServer: false,
    timeout: 15_000
  }
});
