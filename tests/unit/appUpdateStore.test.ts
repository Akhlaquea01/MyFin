import { describe, it, expect, vi } from 'vitest';
import {
	createAppUpdateStore,
	formatMegabytes,
	type AppUpdateApi
} from '../../src/lib/appUpdateStore';
import { describeUpdateError, type NativeUpdateCheck } from '../../src/lib/native/nativeAppUpdate';

const NEWER: NativeUpdateCheck = {
	installedVersion: '0.1.92',
	latestVersion: '0.1.93',
	updateAvailable: true,
	size: 8 * 1024 * 1024,
	notes: '- Fix calendar dates\n- Add updates',
	publishedAt: '2026-10-17T10:00:00Z'
};
const CURRENT: NativeUpdateCheck = {
	...NEWER,
	installedVersion: '0.1.93',
	updateAvailable: false,
	size: 0
};
const UPDATE = {
	version: '0.1.93',
	size: NEWER.size,
	notes: NEWER.notes,
	publishedAt: NEWER.publishedAt
};

function makeApi(overrides: Partial<AppUpdateApi> = {}) {
	const api = {
		check: vi.fn(async () => NEWER),
		download: vi.fn<AppUpdateApi['download']>(async () => {}),
		install: vi.fn(async () => 'started' as const),
		describeError: describeUpdateError,
		...overrides
	};
	return api satisfies AppUpdateApi;
}

describe('app update store: checking', () => {
	it('starts idle and reports up to date when GitHub has nothing newer', async () => {
		const store = createAppUpdateStore(makeApi({ check: vi.fn(async () => CURRENT) }));
		expect(store.getState()).toEqual({ phase: 'idle' });
		await store.check();
		expect(store.getState()).toEqual({ phase: 'up-to-date', version: '0.1.93' });
	});

	it('offers the newer version with its size and notes', async () => {
		const store = createAppUpdateStore(makeApi());
		await store.check();
		expect(store.getState()).toEqual({ phase: 'available', update: UPDATE });
	});

	it('turns a plugin failure into a readable message with check as the retry step', async () => {
		const store = createAppUpdateStore(
			makeApi({
				check: vi.fn(async () => {
					throw Object.assign(new Error('x'), { code: 'offline' });
				})
			})
		);
		await store.check();
		expect(store.getState()).toEqual({
			phase: 'error',
			message: 'Could not reach GitHub. Check your connection and try again.',
			retry: 'check'
		});
	});

	it('ignores a second check while one is running', async () => {
		let finish: (value: NativeUpdateCheck) => void = () => {};
		const check = vi.fn(() => new Promise<NativeUpdateCheck>((resolve) => (finish = resolve)));
		const store = createAppUpdateStore(makeApi({ check }));
		const first = store.check();
		expect(store.getState().phase).toBe('checking');
		await store.check();
		finish(NEWER);
		await first;
		expect(check).toHaveBeenCalledTimes(1);
		expect(store.getState().phase).toBe('available');
	});

	it('notifies subscribers of every change until they unsubscribe', async () => {
		const store = createAppUpdateStore(makeApi());
		const seen: string[] = [];
		const unsubscribe = store.subscribe(() => seen.push(store.getState().phase));
		await store.check();
		unsubscribe();
		await store.check();
		expect(seen).toEqual(['checking', 'available']);
	});
});

describe('app update store: downloading and installing', () => {
	it('downloads, shows progress, then opens the installer', async () => {
		const phases: Array<[string, number?]> = [];
		const api = makeApi({
			download: vi.fn(async (onProgress: (received: number, total: number) => void) => {
				onProgress(1024, UPDATE.size);
				onProgress(UPDATE.size, UPDATE.size);
			})
		});
		const store = createAppUpdateStore(api);
		await store.check();
		store.subscribe(() => {
			const s = store.getState();
			phases.push([s.phase, s.phase === 'downloading' ? s.received : undefined]);
		});
		await store.download();

		expect(phases).toEqual([
			['downloading', 0],
			['downloading', 1024],
			['downloading', UPDATE.size],
			['ready', undefined]
		]);
		expect(api.install).toHaveBeenCalledTimes(1);
		expect(store.getState()).toEqual({ phase: 'ready', update: UPDATE, installer: 'opened' });
	});

	it('falls back to the published size when the plugin does not know the total', async () => {
		const seenTotals: number[] = [];
		const store = createAppUpdateStore(
			makeApi({
				download: vi.fn(async (onProgress: (received: number, total: number) => void) => {
					onProgress(500, 0);
				})
			})
		);
		await store.check();
		store.subscribe(() => {
			const s = store.getState();
			if (s.phase === 'downloading') seenTotals.push(s.total);
		});
		await store.download();
		expect(seenTotals).toContain(UPDATE.size);
		expect(seenTotals).not.toContain(0);
	});

	it('waits for the user to allow installs, then installs on the next tap', async () => {
		const install = vi
			.fn<() => Promise<'started' | 'permission-needed'>>()
			.mockResolvedValueOnce('permission-needed')
			.mockResolvedValueOnce('started');
		const store = createAppUpdateStore(makeApi({ install }));
		await store.check();
		await store.download();
		expect(store.getState()).toEqual({
			phase: 'ready',
			update: UPDATE,
			installer: 'needs-permission'
		});

		await store.install();
		expect(store.getState()).toEqual({ phase: 'ready', update: UPDATE, installer: 'opened' });
		expect(install).toHaveBeenCalledTimes(2);
	});

	it('keeps the found update when the download fails, and retries from available', async () => {
		const download = vi
			.fn<AppUpdateApi['download']>()
			.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'checksum' }))
			.mockResolvedValueOnce(undefined);
		const api = makeApi({ download });
		const store = createAppUpdateStore(api);
		await store.check();
		await store.download();
		expect(store.getState()).toMatchObject({
			phase: 'error',
			retry: 'download',
			update: UPDATE,
			message: 'The downloaded file was damaged, so it was discarded. Try again.'
		});
		expect(api.install).not.toHaveBeenCalled();

		await store.download();
		expect(store.getState().phase).toBe('ready');
		expect(api.install).toHaveBeenCalledTimes(1);
	});

	it('can retry only the install step after Android could not open the installer', async () => {
		const install = vi
			.fn<() => Promise<'started' | 'permission-needed'>>()
			.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'install-failed' }))
			.mockResolvedValueOnce('started');
		const api = makeApi({ install });
		const store = createAppUpdateStore(api);
		await store.check();
		await store.download();
		expect(store.getState()).toMatchObject({ phase: 'error', retry: 'install' });

		await store.install();
		expect(store.getState()).toEqual({ phase: 'ready', update: UPDATE, installer: 'opened' });
		expect(api.download).toHaveBeenCalledTimes(1);
	});

	it('does nothing when asked to download or install before an update was found', async () => {
		const api = makeApi();
		const store = createAppUpdateStore(api);
		await store.download();
		await store.install();
		expect(api.download).not.toHaveBeenCalled();
		expect(api.install).not.toHaveBeenCalled();
		expect(store.getState()).toEqual({ phase: 'idle' });
	});

	it('does not start a check or a second download while one is downloading', async () => {
		let finish: () => void = () => {};
		const download = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
		const api = makeApi({ download });
		const store = createAppUpdateStore(api);
		await store.check();
		const running = store.download();
		await store.check();
		await store.download();
		expect(api.check).toHaveBeenCalledTimes(1);
		expect(download).toHaveBeenCalledTimes(1);
		finish();
		await running;
	});
});

describe('describeUpdateError', () => {
	it('explains each plugin error code', () => {
		expect(describeUpdateError({ code: 'rate-limited' })).toMatch(/limiting requests/);
		expect(describeUpdateError({ code: 'signature' })).toMatch(/different key/);
		expect(describeUpdateError({ code: 'install-failed' })).toMatch(/installer/);
	});

	it('uses a generic message for unknown codes and non-errors', () => {
		const generic = 'Something went wrong while updating. Try again.';
		expect(describeUpdateError({ code: 'brand-new-code' })).toBe(generic);
		expect(describeUpdateError({ code: 'constructor' })).toBe(generic);
		expect(describeUpdateError(new Error('boom'))).toBe(generic);
		expect(describeUpdateError(null)).toBe(generic);
	});
});

describe('formatMegabytes', () => {
	it('shows one decimal and nothing for an unknown size', () => {
		expect(formatMegabytes(8.44 * 1024 * 1024)).toBe('8.4 MB');
		expect(formatMegabytes(0)).toBe('');
		expect(formatMegabytes(Number.NaN)).toBe('');
	});
});
