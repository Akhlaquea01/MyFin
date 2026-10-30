import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	// One worker. Each spec drives a full onboard-and-populate flow against a single
	// preview server, and running them in parallel made different specs fail on each run
	// purely from 5s expect timeouts under CPU contention — flaky in a way that hides real
	// regressions. The whole suite takes roughly ten minutes serially, build included.
	workers: 1,
	// Playwright's 5s default is tight for this app: every spec onboards or unlocks, and each
	// of those runs a 210,000-iteration PBKDF2 derivation that must finish before the UI
	// responds. Under load that pushed assertions past the deadline and failed a different
	// spec on each run.
	expect: { timeout: 15_000 },
	timeout: 60_000,
	// The build alone takes about a minute, which is Playwright's whole default window for the server
	// to come up, so a slightly busy machine failed the run before a single test started.
	webServer: { command: 'npm run build && npm run preview', port: 4173, timeout: 240_000 },
	testDir: 'tests/e2e',
	testMatch: '**/*.spec.ts',
	// Everything runs at the desktop default size, except `*.mobile.spec.ts`, which checks the phone
	// layout on a real phone profile (touch, small viewport) so the bottom bar and sheets are the ones
	// under test.
	projects: [
		{ name: 'desktop', testIgnore: '**/*.mobile.spec.ts' },
		{ name: 'mobile', testMatch: '**/*.mobile.spec.ts', use: { ...devices['Pixel 7'] } }
	],
	// Every spec here onboards into a fresh, empty install — exactly the condition
	// QuickTourProvider auto-starts the real product tour under. Every dialog it opens now
	// carries `role="dialog"` (a deliberate accessibility fix), so left unsuppressed it
	// collides with the many specs that assert `getByRole('dialog')` for a feature dialog they
	// just opened themselves, expecting exactly one match. quickTour.spec.ts explicitly
	// resets this back to a fresh/unseen state for the one test that needs the tour to
	// actually auto-start.
	use: {
		storageState: {
			cookies: [],
			origins: [
				{
					origin: 'http://localhost:4173',
					localStorage: [{ name: 'APP_QUICK_TOUR_SEEN', value: 'true' }]
				}
			]
		}
	}
});
