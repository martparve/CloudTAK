import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running CloudTAK instance.
 *
 *   E2E_BASE_URL   defaults to the TAARA deployment
 *   E2E_USERNAME   TAK user to log in with (must be able to enroll on the TAK server)
 *   E2E_PASSWORD   its password
 *
 * Run: npx playwright test   (from api/web)
 */
export default defineConfig({
    testDir: './e2e',
    timeout: 90_000,
    expect: { timeout: 20_000 },
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
    outputDir: './e2e-results',
    use: {
        baseURL: process.env.E2E_BASE_URL || 'https://map.79-72-16-120.sslip.io',
        viewport: { width: 1400, height: 900 },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        ignoreHTTPSErrors: true,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
});
