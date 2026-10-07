import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a running stack with the demo seed loaded (see docs/DEPLOYMENT.md). They are skipped
 * unless E2E_BASE_URL is set, so `npm test` and CI without a stack stay green.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
