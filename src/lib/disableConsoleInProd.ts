// FR-006 / Constitution Principle II: financial data must never reach logs/console
// output "under any circumstance, in any build". Rather than depend on a bundler-specific
// `drop console` build option, this disables every console method at runtime whenever the
// app is running as a production build, regardless of which bundler produced it.
if (import.meta.env.PROD) {
	const noop = () => {};
	for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
		console[method] = noop;
	}
}
