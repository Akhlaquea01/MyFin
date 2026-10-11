import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { NotifiedItemRepository } from '../../src/data/dexie/notificationRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { resetBlindIndexSaltCache } from '../../src/data/dexie/blindIndexSalt';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import {
	ingestCapturedMessages,
	resolveCaptureDate,
	type IngestMessage
} from '../../src/data/io/captureIngestService';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';

const RECEIVED = Date.UTC(2026, 9, 5, 6, 30); // 5 Oct 2026, 06:30 UTC

let nextId = 0;
const sms = (body: string, receivedAt = RECEIVED, sender = 'VM-HDFCBK'): IngestMessage => ({
	id: `q${++nextId}`,
	payload: { channel: 'sms', sender, body, receivedAt }
});
const note = (title: string, body: string, receivedAt = RECEIVED): IngestMessage => ({
	id: `q${++nextId}`,
	payload: { channel: 'notification', sender: 'Google Pay', title, body, receivedAt }
});

const HDFC_SWIGGY =
	'Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 05/10/26 Ref 628123456789';

describe('ingestCapturedMessages', () => {
	let key: CryptoKey;
	let hdfc: string;
	let icici: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		resetBlindIndexSaltCache();
		nextId = 0;
		key = await deriveEncryptionKey('8383', randomSaltBase64());
		const make = (name: string, accountLast4: string) =>
			AccountRepository.create(key, {
				name,
				type: 'bank',
				openingBalance: 100_000,
				creditLimit: null,
				billingCycleDay: null,
				accountLast4
			});
		hdfc = (await make('HDFC', '1234')).id;
		icici = (await make('ICICI', '987')).id;
	});
	afterEach(() => vi.restoreAllMocks());

	const run = (messages: IngestMessage[], extra: { maxPerRun?: number } = {}) =>
		ingestCapturedMessages(key, messages, { defaultAccountId: icici, ...extra });
	const unreviewed = () => TransactionRepository.listUnreviewed(key);
	const balance = async (id: string) => (await AccountRepository.getById(key, id))!.currentBalance;

	it('files a bank SMS as an unreviewed entry under the account its digits name', async () => {
		const message = sms(HDFC_SWIGGY);
		const report = await run([message]);

		expect(report).toMatchObject({ created: 1, needsAccountCheck: 0, failed: 0 });
		expect(report.ackIds).toEqual([message.id]);

		const [tx] = await unreviewed();
		expect(tx).toMatchObject({
			accountId: hdfc,
			amount: -25000,
			type: 'expense',
			date: '2026-10-05',
			source: 'sms_capture',
			reviewStatus: 'unreviewed',
			notes: null,
			duplicateOfId: null
		});
		expect(tx.capture).toMatchObject({
			channel: 'sms',
			sender: 'VM-HDFCBK',
			receivedAt: RECEIVED,
			accountCheck: null
		});
		expect(tx.capture?.text).toBe(HDFC_SWIGGY);
		const merchant = (await MerchantRepository.list(key)).find((m) => m.id === tx.merchantId);
		expect(merchant?.name).toBe('SWIGGY');
		expect(await balance(hdfc)).toBe(75_000);
	});

	it('matches a three-digit tail to a three-digit tag', async () => {
		await run([
			sms('Acct XX987 is credited with Rs 5,000.00 on 05-Oct-26 from JOHN DOE. UPI:628123456789')
		]);
		const [tx] = await unreviewed();
		expect(tx).toMatchObject({ accountId: icici, amount: 500000, type: 'income' });
		expect(tx.capture?.accountCheck).toBeNull();
	});

	it('uses the default account and says so when the digits match nothing', async () => {
		const report = await run([sms('Rs.99.00 debited from A/c XX5555 at NETFLIX')]);
		const [tx] = await unreviewed();
		expect(tx.accountId).toBe(icici);
		expect(tx.capture).toMatchObject({ accountCheck: 'unmatched-tail', tailHint: '5555' });
		expect(report.needsAccountCheck).toBe(1);
	});

	it('uses the default account when the message names no account at all', async () => {
		await run([note('Paid ₹250', 'Paid ₹250.00 to Swiggy')]);
		const [tx] = await unreviewed();
		expect(tx.accountId).toBe(icici);
		expect(tx.source).toBe('notification_capture');
		expect(tx.capture).toMatchObject({ accountCheck: 'default-account', tailHint: null });
	});

	it('leaves a message queued when there is no account to file it under', async () => {
		const message = sms('Rs.99.00 debited from A/c XX5555 at NETFLIX');
		const report = await ingestCapturedMessages(key, [message], { defaultAccountId: null });
		expect(report.noAccount).toBe(1);
		expect(report.created).toBe(0);
		expect(report.ackIds).toEqual([]);
		expect(await unreviewed()).toHaveLength(0);
	});

	it('acknowledges and discards messages that are not transactions, creating nothing', async () => {
		const messages = [
			sms('123456 is your OTP for txn of Rs.500 at AMAZON. Do not share.'),
			sms('Get pre-approved loan up to Rs.5,00,000! Apply now'),
			sms('Avl Bal in A/c XX1234 is Rs.9,000.00'),
			sms('Your credit limit is Rs.50,000') // passes the filter, but no direction can be read
		];
		const report = await run(messages);
		expect(report.created).toBe(0);
		expect(report.ignored).toEqual({ otp: 1, promo: 1, 'balance-only': 1 });
		expect(report.unreadable).toBe(1);
		expect(report.ackIds).toHaveLength(4);
		expect(await unreviewed()).toHaveLength(0);
	});

	it('files the same message once, however often the queue hands it over', async () => {
		const first = sms(HDFC_SWIGGY);
		await run([first]);
		const again = { ...first, id: 'q-replayed' };
		const report = await run([again]);
		expect(report.alreadyProcessed).toBe(1);
		expect(report.created).toBe(0);
		expect(report.ackIds).toEqual(['q-replayed']);
		expect(await unreviewed()).toHaveLength(1);
	});

	it('does not skip a replay after a crash that wrote the entry but not the ledger — it files a flagged duplicate', async () => {
		const message = sms(HDFC_SWIGGY);
		await run([message]);
		// Simulate losing the ledger row.
		await db.notifiedItems.clear();
		const report = await run([{ ...message, id: 'q-replayed' }]);
		expect(report.created).toBe(1);
		expect(report.duplicatesFlagged).toBe(1);
		const entries = await unreviewed();
		expect(entries).toHaveLength(2);
		expect(entries.filter((tx) => tx.duplicateOfId !== null)).toHaveLength(1);
	});

	describe('SMS and notification for the same payment', () => {
		it('folds the second sighting into the first and keeps both visible', async () => {
			const report = await run([
				note('Paid ₹250', 'Paid ₹250.00 to Swiggy', RECEIVED),
				sms(HDFC_SWIGGY, RECEIVED + 60_000)
			]);
			expect(report).toMatchObject({ created: 1, paired: 1 });
			expect(report.ackIds).toHaveLength(2);

			const entries = await unreviewed();
			expect(entries).toHaveLength(1);
			// The notification came first and had to guess the account; the SMS named it.
			expect(entries[0].accountId).toBe(hdfc);
			expect(entries[0].capture?.accountCheck).toBeNull();
			expect(entries[0].capture?.alsoSeenAs).toEqual([
				{ channel: 'sms', sender: 'VM-HDFCBK', receivedAt: RECEIVED + 60_000 }
			]);
			// Both accounts end up right: the guessed one is back to its opening balance.
			expect(await balance(icici)).toBe(100_000);
			expect(await balance(hdfc)).toBe(75_000);
		});

		it('pairs one-to-one, so two same-amount payments minutes apart stay two entries', async () => {
			const report = await run([
				sms(HDFC_SWIGGY, RECEIVED),
				note('Paid ₹250', 'Paid ₹250.00 to Swiggy', RECEIVED + 20_000),
				sms(HDFC_SWIGGY.replace('Ref 628123456789', 'Ref 628123456790'), RECEIVED + 180_000),
				note('Paid ₹250', 'Paid ₹250.00 to Swiggy', RECEIVED + 200_000)
			]);
			expect(report.created).toBe(2);
			expect(report.paired).toBe(2);
			expect(await unreviewed()).toHaveLength(2);
		});

		it('does not fold payments that are too far apart in time', async () => {
			const report = await run([
				sms(HDFC_SWIGGY, RECEIVED),
				note('Paid ₹250', 'Paid ₹250.00 to Swiggy', RECEIVED + 30 * 60_000)
			]);
			expect(report.paired).toBe(0);
			expect(report.created).toBe(2);
		});
	});

	describe('likely duplicates are flagged, never skipped', () => {
		it('creates both of two same-amount SMS and flags the second', async () => {
			const report = await run([
				sms(HDFC_SWIGGY, RECEIVED),
				sms(HDFC_SWIGGY.replace('628123456789', '628123456790'), RECEIVED + 3_600_000)
			]);
			expect(report).toMatchObject({ created: 2, duplicatesFlagged: 1 });
			const entries = await unreviewed();
			expect(entries.filter((tx) => tx.duplicateOfId !== null)).toHaveLength(1);
		});

		it('flags an SMS for something already entered by hand', async () => {
			const manual = await TransactionEngine.recordTransaction(key, {
				accountId: hdfc,
				date: '2026-10-05',
				amount: -25000,
				type: 'expense'
			});
			await run([sms(HDFC_SWIGGY)]);
			const [tx] = await unreviewed();
			expect(tx.duplicateOfId).toBe(manual.id);
		});
	});

	it('handles at most maxPerRun messages and leaves the rest untouched for the next run', async () => {
		const messages = [
			sms(HDFC_SWIGGY.replace('250.00', '101.00'), RECEIVED),
			sms(HDFC_SWIGGY.replace('250.00', '102.00'), RECEIVED + 1000),
			sms(HDFC_SWIGGY.replace('250.00', '103.00'), RECEIVED + 2000)
		];
		const report = await run(messages, { maxPerRun: 2 });
		expect(report.created).toBe(2);
		expect(report.ackIds).toEqual([messages[0].id, messages[1].id]);
		expect(await unreviewed()).toHaveLength(2);
	});

	it('files a message whose text fails halfway as failed, unacknowledged and retryable', async () => {
		const message = sms(HDFC_SWIGGY);
		vi.spyOn(NotifiedItemRepository, 'exists').mockRejectedValueOnce(new Error('boom'));
		const report = await run([message]);
		expect(report.failed).toBe(1);
		expect(report.ackIds).toEqual([]);
		const retry = await run([message]);
		expect(retry.created).toBe(1);
	});

	it('never writes message text to the console', async () => {
		const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
			vi.spyOn(console, m).mockImplementation(() => {})
		);
		vi.spyOn(NotifiedItemRepository, 'exists').mockRejectedValueOnce(new Error(HDFC_SWIGGY));
		await run([sms(HDFC_SWIGGY), sms(HDFC_SWIGGY.replace('250.00', '260.00'))]);
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
	});
});

describe('resolveCaptureDate', () => {
	const received = Date.UTC(2026, 9, 5, 6, 30);

	it('uses the date written in the message when it is plausibly recent', () => {
		expect(resolveCaptureDate('2026-10-04', received)).toBe('2026-10-04');
		expect(resolveCaptureDate('2026-10-05', received)).toBe('2026-10-05');
	});

	it('falls back to the day the message arrived for an implausible date', () => {
		expect(resolveCaptureDate('2099-01-01', received)).toBe('2026-10-05');
		expect(resolveCaptureDate('2026-09-01', received)).toBe('2026-10-05');
	});

	it('falls back to the arrival day when the message has no date', () => {
		expect(resolveCaptureDate(null, received)).toBe('2026-10-05');
	});
});
