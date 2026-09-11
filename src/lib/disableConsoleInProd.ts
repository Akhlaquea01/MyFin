// FR-006 / Constitution Principle II: financial data must never reach logs/console output
// "under any circumstance, in any build". Rather than depend on a bundler-specific
// `drop console` build option, this disables console methods at runtime whenever the app is
// running as a production build, regardless of which bundler produced it.
//
// `warn` and `error` are deliberately NOT suppressed. The principle forbids *financial data*
// in console output, not diagnostics: this app never logs entities, so what those two
// channels actually carry is React's own error reporting, unhandled rejections, and Dexie
// failures. Silencing them bought no real secrecy — anyone with devtools open already has
// the whole IndexedDB — while making every production failure impossible to diagnose.
if (import.meta.env.PROD) {
	const noop = () => {};
	for (const method of ['log', 'info', 'debug', 'trace'] as const) {
		console[method] = noop;
	}
}
