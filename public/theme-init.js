// Runs before first paint so a light-theme user never sees a dark flash. An external file because
// the CSP (script-src 'self') forbids inline scripts. Keep in step with src/lib/theme.ts.
(function () {
	var stored = null;
	try {
		stored = localStorage.getItem('myfin.theme');
	} catch {
		// Storage can be blocked; fall back to the system setting.
	}
	var dark =
		stored === 'dark' ||
		(stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.classList.toggle('dark', dark);
})();
