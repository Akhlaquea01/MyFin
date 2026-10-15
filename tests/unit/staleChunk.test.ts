import { describe, it, expect, beforeEach } from 'vitest';
import { shouldReloadForStaleChunk } from '../../src/lib/staleChunk';

// vitest's node project has no sessionStorage; a minimal stand-in is enough for the guard.
function installSessionStorage() {
	const data = new Map<string, string>();
	(globalThis as { sessionStorage?: Storage }).sessionStorage = {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value)
	} as Storage;
}

describe('shouldReloadForStaleChunk', () => {
	beforeEach(installSessionStorage);

	it('allows one reload, then refuses a repeat inside the window so a broken deploy cannot loop', () => {
		expect(shouldReloadForStaleChunk(1_000_000)).toBe(true);
		expect(shouldReloadForStaleChunk(1_005_000)).toBe(false);
		expect(shouldReloadForStaleChunk(1_014_999)).toBe(false);
	});

	it('allows another reload once the window has passed', () => {
		expect(shouldReloadForStaleChunk(1_000_000)).toBe(true);
		expect(shouldReloadForStaleChunk(1_020_000)).toBe(true);
	});

	it('never reloads when sessionStorage is unavailable', () => {
		delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
		expect(shouldReloadForStaleChunk(1_000_000)).toBe(false);
	});
});
