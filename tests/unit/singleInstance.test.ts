import { describe, it, expect, vi, afterEach } from 'vitest';
import { acquireSingleInstanceLock } from '../../src/lib/singleInstance';

describe('acquireSingleInstanceLock', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reports unsupported when the browser has no Web Locks API', () => {
		// Node's own `navigator` global (unlike a browser without the Web Locks API) actually
		// implements `navigator.locks` as an inherited, non-configurable property that survives
		// `delete` — stubbing the whole global is the only reliable way to simulate its absence.
		vi.stubGlobal('navigator', {});
		const onRoleChange = vi.fn();
		const cleanup = acquireSingleInstanceLock(onRoleChange);
		expect(onRoleChange).toHaveBeenCalledWith('unsupported');
		cleanup();
	});

	/**
	 * Regression: `navigator.locks.request` had no `.catch()`, so a rejected promise (e.g. a
	 * SecurityError in a restricted context) silently dropped the request — `onRoleChange` was
	 * never called again, leaving the caller stuck with no role instead of failing open the
	 * same way an unsupported browser does.
	 */
	it('fails open (reports unsupported) when navigator.locks.request rejects', async () => {
		vi.stubGlobal('navigator', {
			locks: { request: vi.fn(() => Promise.reject(new Error('SecurityError'))) }
		});
		const onRoleChange = vi.fn();
		const cleanup = acquireSingleInstanceLock(onRoleChange);

		// Let the rejected promise's .catch() run.
		await Promise.resolve();
		await Promise.resolve();

		expect(onRoleChange).toHaveBeenCalledWith('unsupported');
		cleanup();
	});
});
