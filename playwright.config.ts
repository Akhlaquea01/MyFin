import { defineConfig } from '@playwright/test';

export default defineConfig({
	// One worker. Each spec drives a full onboard-and-populate flow against a single
	// preview server, and running them in parallel made different specs fail on each run
	// purely from 5s expect timeouts under CPU contention — flaky in a way that hides real
	// regressions. The whole suite still finishes in well under two minutes serially.
	workers: 1,
	// Playwright's 5s default is tight for this app: every spec onboards or unlocks, and each
	// of those runs a 210,000-iteration PBKDF2 derivation on the main thread before the UI
	// responds. Under load that pushed assertions past the deadline and failed a different
	// spec on each run.
	expect: { timeout: 15_000 },
	timeout: 60_000,
	webServer: { command: 'npm run build && npm run preview', port: 4173 },
	testDir: 'tests/e2e',
	testMatch: '**/*.spec.ts'
});
