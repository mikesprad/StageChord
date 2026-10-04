import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        // The service worker caches app files across runs; tests should hit the server directly.
        serviceWorkers: 'block',
        trace: 'retain-on-failure'
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        // Modern iPadOS: normal slide-out menu.
        { name: 'ipad', use: { ...devices['iPad (gen 11)'] } },
        // iOS 12 user agent: exercises the full-page iOS fallback menu.
        { name: 'ipad-legacy', use: { ...devices['iPad (gen 7)'] } }
    ],
    webServer: {
        command: `node tests/e2e/serve.mjs`,
        url: `http://localhost:${PORT}/index.html`,
        env: { PORT: String(PORT) },
        reuseExistingServer: !process.env.CI
    }
});
