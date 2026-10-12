import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SealedCaptureItem } from '../../src/data/crypto/sealedBox';

// An in-memory stand-in for the Android plugin: a queue that sealed items sit in until the app
// drains and acknowledges them, plus the settings the app pushes down.
const native = vi.hoisted(() => ({
	queue: [] as SealedCaptureItem[],
	publicKey: '',
	keyId: '',
	enabled: { sms: false, notifications: false },
	cancelAlerts: 0,
	drains: 0,
	/** When set, the self test seals with this key pair instead — as a mismatching Java side would. */
	selfTestSeal: null as null | { publicKey: string; keyId: string }
}));

vi.mock('../../src/lib/native/transactionCapture', async () => {
	const { sealItem } = await import('../../src/data/crypto/sealedBox');
	return {
		isTransactionCaptureAvailable: () => true,
		SELF_TEST_TEXT: 'myfin-capture-self-test',
		TransactionCapture: {
			setSealingKey: vi.fn(async (publicKey: string, keyId: string) => {
				native.publicKey = publicKey;
				native.keyId = keyId;
			}),
			setEnabled: vi.fn(async (flags: { sms?: boolean; notifications?: boolean }) => {
				native.enabled = {
					sms: flags.sms ?? native.enabled.sms,
					notifications: flags.notifications ?? native.enabled.notifications
				};
			}),
			selfTest: vi.fn(async () => {
				const seal = native.selfTestSeal ?? { publicKey: native.publicKey, keyId: native.keyId };
				return {
					item: await sealItem(seal.publicKey, seal.keyId, { selfTest: 'myfin-capture-self-test' })
				};
			}),
			drainQueue: vi.fn(async (limit?: number) => {
				native.drains += 1;
				const size = limit ?? 200;
				return {
					items: native.queue.slice(0, size),
					remaining: Math.max(0, native.queue.length - size),
					dropped: 0
				};
			}),
			ack: vi.fn(async (ids: string[]) => {
				native.queue = native.queue.filter((item) => !ids.includes(item.id));
				return { removed: ids.length, remaining: native.queue.length };
			}),
			cancelAlert: vi.fn(async () => {
				native.cancelAlerts += 1;
			})
		}
	};
});

import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { resetBlindIndexSaltCache } from '../../src/data/dexie/blindIndexSalt';
import { createSealingKey, sealItem } from '../../src/data/crypto/sealedBox';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';
import { UnreadableCaptureRepository } from '../../src/data/dexie/unreadableCaptureRepository';
import { drainCapturedTransactions } from '../../src/data/io/captureDrain';
import { CaptureSetupError, disableCapture, enableCapture } from '../../src/data/io/captureSetup';
import type { CapturePayload } from '../../src/domain/capture/captureTypes';

const RECEIVED = Date.UTC(2026, 9, 5, 6, 30);
const BANK_SMS = 'Rs.250.00 debited from A/c XX1234 to SWIGGY on 05-10-26 Ref 628123456789';

describe('capture setup and drain', () => {
	let key: CryptoKey;
	let account: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		resetBlindIndexSaltCache();
		Object.assign(native, {
			queue: [],
			publicKey: '',
			keyId: '',
			enabled: { sms: false, notifications: false },
			cancelAlerts: 0,
			drains: 0,
			selfTestSeal: null
		});
		const pinSalt = randomSaltBase64();
		const encryptionSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin('8383', pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
		key = await deriveEncryptionKey('8383', encryptionSalt);
		account = (
			await AccountRepository.create(key, {
				name: 'HDFC',
				type: 'bank',
				openingBalance: 100_000,
				creditLimit: null,
				billingCycleDay: null,
				accountLast4: '1234'
			})
		).id;
	});

	const choices = () => ({ sms: true, notifications: true, defaultAccountId: account });
	const payload = (body: string, extra: Partial<CapturePayload> = {}): CapturePayload => ({
		channel: 'sms',
		sender: 'VM-HDFCBK',
		body,
		receivedAt: RECEIVED,
		...extra
	});
	const seal = (
		id: string,
		p: CapturePayload,
		keyId = native.keyId,
		publicKey = native.publicKey
	) => sealItem(publicKey, keyId, p, id);

	describe('enableCapture', () => {
		it('creates the sealing key, proves it against native, switches sources on and saves the choices', async () => {
			const saved = await enableCapture(key, choices());

			expect(saved).toMatchObject({
				enabled: true,
				sms: true,
				notifications: true,
				defaultAccountId: account
			});
			expect(saved.sealing?.publicKey).toBe(native.publicKey);
			expect(saved.sealing?.keyId).toBe(native.keyId);
			expect(native.enabled).toEqual({ sms: true, notifications: true });
			expect((await UserProfileRepository.get())?.capture?.sealing?.keyId).toBe(native.keyId);
		});

		it('keeps the same sealing key when the choices are changed later', async () => {
			const first = await enableCapture(key, choices());
			const second = await enableCapture(key, { ...choices(), notifications: false });
			expect(second.sealing?.keyId).toBe(first.sealing?.keyId);
			expect(native.enabled).toEqual({ sms: true, notifications: false });
		});

		it('refuses to turn on when native and the app disagree about the sealed format', async () => {
			const stranger = await createSealingKey(key);
			native.selfTestSeal = { publicKey: stranger.publicKey, keyId: stranger.keyId };

			await expect(enableCapture(key, choices())).rejects.toBeInstanceOf(CaptureSetupError);
			expect(native.enabled).toEqual({ sms: false, notifications: false });
			expect((await UserProfileRepository.get())?.capture?.enabled).toBeFalsy();
		});

		it('needs at least one source', async () => {
			await expect(
				enableCapture(key, { ...choices(), sms: false, notifications: false })
			).rejects.toBeInstanceOf(CaptureSetupError);
		});

		it('can be turned off again without losing the key', async () => {
			const first = await enableCapture(key, choices());
			await disableCapture();
			expect(native.enabled).toEqual({ sms: false, notifications: false });
			const profile = await UserProfileRepository.get();
			expect(profile?.capture?.enabled).toBe(false);
			expect(profile?.capture?.sealing?.keyId).toBe(first.sealing?.keyId);
		});
	});

	describe('drainCapturedTransactions', () => {
		it('does nothing until capture is switched on', async () => {
			expect(await drainCapturedTransactions(key)).toBeNull();
			expect(native.drains).toBe(0);
		});

		it('opens queued messages, files them in Review, and acknowledges everything it finished with', async () => {
			await enableCapture(key, choices());
			native.queue = [
				await seal('good', payload(BANK_SMS)),
				await seal('otp', payload('123456 is your OTP for txn of Rs.500. Do not share.'))
			];

			const result = await drainCapturedTransactions(key);

			expect(result?.report).toMatchObject({ created: 1 });
			expect(result?.report.ignored).toEqual({ otp: 1 });
			expect(native.queue).toEqual([]);
			expect(native.cancelAlerts).toBe(1);
			const [tx] = await TransactionRepository.listUnreviewed(key);
			expect(tx).toMatchObject({ accountId: account, amount: -25000, source: 'sms_capture' });
			expect((await UserProfileRepository.get())?.capture?.lastDrainAt).toBeGreaterThan(0);
		});

		it('discards items sealed to an old key or damaged, counting them rather than blocking the queue', async () => {
			const settings = await enableCapture(key, choices());
			const stranger = await createSealingKey(key);
			native.queue = [
				await seal('old-key', payload(BANK_SMS), 'some-old-kid', stranger.publicKey),
				{ ...(await seal('damaged', payload(BANK_SMS))), ct: 'AAAA' },
				await seal('good', payload(BANK_SMS.replace('250.00', '251.00')))
			];

			const result = await drainCapturedTransactions(key);

			expect(result?.undecryptable).toBe(2);
			expect(result?.report.created).toBe(1);
			expect(native.queue).toEqual([]);
			expect((await UserProfileRepository.get())?.capture?.unreadableCount).toBe(2);
			expect(settings.sealing?.keyId).toBe(native.keyId);
		});

		it('counts messages that look like transactions but cannot be read, and keeps their text to add by hand', async () => {
			await enableCapture(key, choices());
			native.queue = [await seal('odd', payload('Your credit limit is Rs.50,000'))];
			await drainCapturedTransactions(key);
			expect((await UserProfileRepository.get())?.capture?.unreadableCount).toBe(1);
			expect(native.queue).toEqual([]);
			const kept = await UnreadableCaptureRepository.list(key);
			expect(kept.map((u) => u.text)).toEqual([
				expect.stringContaining('credit limit is Rs.50,000')
			]);
		});

		it('leaves a message queued, and the alert up, when it could not be filed', async () => {
			await enableCapture(key, choices());
			await UserProfileRepository.update({
				capture: { ...(await UserProfileRepository.get())!.capture!, defaultAccountId: null }
			});
			native.queue = [await seal('stuck', payload('Rs.99.00 debited from A/c XX5555 at NETFLIX'))];

			const result = await drainCapturedTransactions(key);

			expect(result?.report.noAccount).toBe(1);
			expect(native.queue.map((i) => i.id)).toEqual(['stuck']);
			expect(native.cancelAlerts).toBe(0);
		});

		it('re-syncs native with the profile on every run', async () => {
			await enableCapture(key, choices());
			native.enabled = { sms: false, notifications: false }; // e.g. app data was cleared natively
			native.publicKey = '';
			await drainCapturedTransactions(key);
			expect(native.enabled).toEqual({ sms: true, notifications: true });
			expect(native.publicKey).not.toBe('');
		});

		it('runs one drain at a time however many triggers fire together', async () => {
			await enableCapture(key, choices());
			native.queue = [await seal('good', payload(BANK_SMS))];

			const results = await Promise.all([
				drainCapturedTransactions(key),
				drainCapturedTransactions(key),
				drainCapturedTransactions(key)
			]);

			expect(new Set(results).size).toBe(1);
			expect(await TransactionRepository.listUnreviewed(key)).toHaveLength(1);
		});
	});
});
