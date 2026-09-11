// Setup for the `dom` Vitest project (jsdom). Extends expect with Testing Library's DOM
// matchers and tears down the rendered tree between tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
	cleanup();
});

// jsdom ships no Web Crypto by default, and every screen under test reaches the session layer.
// Node's implementation is the same WebCrypto surface the browser exposes.
if (!globalThis.crypto?.subtle) {
	const { webcrypto } = await import('node:crypto');
	Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

// jsdom implements neither the Web Locks API (single-instance lock) nor matchMedia (Radix
// primitives probe it). Both are absent rather than broken, so the app's own feature detection
// handles Locks; matchMedia has no such guard and needs a stub.
if (!window.matchMedia) {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		})
	});
}
