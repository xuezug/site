import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite for the built site (Task 12).
 *
 * Runs against `scripts/preview.mjs`, which serves `dist/` the way Cloudflare
 * Pages does (directory indexes, branded 404, no SPA fallback). Build first:
 * `npm run build && npm run e2e`.
 *
 * `channel: 'chrome'` uses the *installed* Google Chrome, so the suite never
 * needs `npx playwright install`. Every R2 icon request is intercepted by the
 * specs (`tests/e2e/support/harness.ts`), so the run is fully offline.
 */
const DESKTOP_VIEWPORT = { width: 1280, height: 900 } as const;
const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    channel: 'chrome',
    viewport: { ...DESKTOP_VIEWPORT },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/preview.mjs',
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { PORT: String(PORT) },
  },
  projects: [
    {
      name: 'desktop',
      // Spreading the device keeps its user agent / UA hints, while the
      // viewport stays the 1280×900 the design uses for desktop checks.
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { ...DESKTOP_VIEWPORT } },
    },
  ],
});
