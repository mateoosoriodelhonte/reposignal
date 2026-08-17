import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * E2E runs against a production build with `GITHUB_FIXTURES=1`, which makes the
 * GitHub client serve bundled fixture snapshots instead of calling the real
 * API. CI must never depend on GitHub being reachable, or on rate limits.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Serialized in CI so the single built server is not contended; omitted
  // locally so Playwright picks a worker count from the machine.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      GITHUB_FIXTURES: '1',
      GITHUB_TOKEN: 'e2e-token-not-a-real-credential',
    },
  },
});
