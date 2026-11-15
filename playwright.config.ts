import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build served by `vite preview`, so what passes
 * here is what ships.
 *
 * Port 4238 is this lab's own, assigned by the catalog's tools/port-sync.js and
 * pinned in tools/playwright-ports.json. Never the Vite default 4173: a shared
 * port means `reuseExistingServer` silently scans a DIFFERENT lab's preview, and
 * during a mutation check it can scan an unmutated checkout still running from an
 * earlier run — which reads as "the mutation was not caught".
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 180_000, // the axe driver walks every panel and disclosure before scanning
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results/artifacts',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:4238/crypto-lab-lthash/',
    colorScheme: 'dark', // dark is the only theme
  },
  projects: [
    { name: 'a11y', testMatch: /a11y\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // Claims and verdicts run in one engine: they assert what the page SAYS and
    // what it measures, neither of which varies by browser.
    { name: 'claims', testMatch: /claims\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'verdicts', testMatch: /verdicts\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'coverage', testMatch: /verdict-coverage\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Build before serving: `vite preview` only serves whatever is already in
    // dist/, so without the build in front a run tests a stale bundle — and a
    // build that FAILS leaves the previous good bundle in place, so the whole
    // suite passes green against source that no longer compiles. That silently
    // invalidates mutation checking, which is the only thing that proves a test
    // has teeth.
    command: 'npm run build && npm run preview -- --port 4238 --strictPort',
    url: 'http://localhost:4238/crypto-lab-lthash/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
