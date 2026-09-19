import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AutoBackupSettingsRepository } from '../../src/data/dexie/autoBackupSettingsRepository';
import { maybeRunScheduledBackup, isAutoBackupSupported } from '../../src/data/io/autoBackupService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import type { UserProfile, AutoBackupSettings } from '../../src/domain/entities';

function makeMockDirectoryHandle(opts: {
	queryPermission?: 'granted' | 'prompt' | 'denied';
	requestPermission?: 'granted' | 'prompt' | 'denied';
}) {
	const write = vi.fn();
	const close = vi.fn();
	const createWritable = vi.fn().mockResolvedValue({ write, close });
	const getFileHandle = vi.fn().mockResolvedValue({ createWritable });
	return {
		handle: {
			queryPermission: vi.fn().mockResolvedValue(opts.queryPermission ?? 'granted'),
			requestPermission: vi.fn().mockResolvedValue(opts.requestPermission ?? 'granted'),
			getFileHandle
		} as unknown as FileSystemDirectoryHandle,
		write,
		close,
		getFileHandle
	};
}

/** A real `FileSystemDirectoryHandle` can't survive a real structured clone into IndexedDB from
 *  this Node test environment either — the *browser's* structured-clone algorithm has special,
 *  spec-blessed support for that one opaque handle type that a plain JS test double (functions
 *  attached as properties) doesn't get, and `fake-indexeddb` correctly rejects it
 *  (`DataCloneError`) the same way a real implementation would reject an ordinary object with
 *  function properties. So these tests stub the repository boundary directly instead of
 *  round-tripping the mock handle through Dexie — the same boundary
 *  contracts/scheduled-backup.md draws the line at (a settings-persistence concern, not the
 *  service's own logic under test here). */
function stubSettings(settings: AutoBackupSettings) {
	vi.spyOn(AutoBackupSettingsRepository, 'get').mockResolvedValue(settings);
	const updateSpy = vi
		.spyOn(AutoBackupSettingsRepository, 'update')
		.mockImplementation(async (changes) => {
			settings = { ...settings, ...changes };
			return settings;
		});
	return { updateSpy, getCurrent: () => settings };
}

describe('Auto backup service', () => {
	let key: CryptoKey;
	let profile: UserProfile;
	const pin = '5555';

	beforeEach(async () => {
		await db.delete();
		await db.open();
		const salt = randomSaltBase64();
		key = await deriveEncryptionKey(pin, salt);
		profile = {
			id: 'local-user',
			pinVerifierHash: 'x',
			pinSalt: 'x',
			encryptionSalt: salt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300000,
			storagePersisted: false
		};
		// Node test environment has no `window` global at all — simulate a supporting browser.
		(globalThis as unknown as { window: unknown }).window = { showDirectoryPicker: vi.fn() };
	});

	afterEach(() => {
		delete (globalThis as unknown as { window?: unknown }).window;
		vi.restoreAllMocks();
	});

	it('reports unsupported when the browser has no File System Access API', () => {
		delete (globalThis as unknown as { window?: unknown }).window;
		expect(isAutoBackupSupported()).toBe(false);
	});

	it('reports supported when showDirectoryPicker exists on window', () => {
		expect(isAutoBackupSupported()).toBe(true);
	});

	it('does nothing when automatic backups are disabled', async () => {
		const { getFileHandle, handle } = makeMockDirectoryHandle({});
		stubSettings({ id: 'local-user', enabled: false, intervalDays: 1, directoryHandle: handle });
		await maybeRunScheduledBackup(pin, key, profile);
		expect(getFileHandle).not.toHaveBeenCalled();
	});

	it('does nothing when no destination folder is configured', async () => {
		const { updateSpy } = stubSettings({ id: 'local-user', enabled: true, intervalDays: 1 });
		await maybeRunScheduledBackup(pin, key, profile);
		expect(updateSpy).not.toHaveBeenCalled();
	});

	it('does nothing when the interval has not yet elapsed', async () => {
		const { getFileHandle, handle } = makeMockDirectoryHandle({});
		stubSettings({
			id: 'local-user',
			enabled: true,
			intervalDays: 7,
			directoryHandle: handle,
			lastBackupAt: new Date().toISOString()
		});
		await maybeRunScheduledBackup(pin, key, profile);
		expect(getFileHandle).not.toHaveBeenCalled();
	});

	it('writes an encrypted backup and records success when due', async () => {
		const { write, close, getFileHandle, handle } = makeMockDirectoryHandle({
			queryPermission: 'granted'
		});
		const { getCurrent } = stubSettings({
			id: 'local-user',
			enabled: true,
			intervalDays: 1,
			directoryHandle: handle
			// lastBackupAt absent -> always due
		});

		await maybeRunScheduledBackup(pin, key, profile);

		expect(getFileHandle).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(1);
		// The written payload is the same encrypted container createBackup() produces — never
		// plaintext financial data, and never the raw PIN.
		const written = JSON.parse(write.mock.calls[0][0] as string);
		expect(written.container).toBeDefined();
		expect(written.ciphertext).toBeDefined();
		expect(JSON.stringify(written)).not.toContain(pin);

		expect(getCurrent().lastBackupStatus).toBe('success');
		expect(getCurrent().lastBackupAt).toBeDefined();
	});

	it('requests permission when not already granted, and proceeds if granted', async () => {
		const { write, handle } = makeMockDirectoryHandle({
			queryPermission: 'prompt',
			requestPermission: 'granted'
		});
		stubSettings({ id: 'local-user', enabled: true, intervalDays: 1, directoryHandle: handle });

		await maybeRunScheduledBackup(pin, key, profile);

		expect(handle.requestPermission).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it('records a failure and never writes when permission is denied', async () => {
		const { write, getFileHandle, handle } = makeMockDirectoryHandle({
			queryPermission: 'denied',
			requestPermission: 'denied'
		});
		const { getCurrent } = stubSettings({
			id: 'local-user',
			enabled: true,
			intervalDays: 1,
			directoryHandle: handle
		});

		await maybeRunScheduledBackup(pin, key, profile);

		expect(getFileHandle).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
		expect(getCurrent().lastBackupStatus).toBe('failed');
	});
});
