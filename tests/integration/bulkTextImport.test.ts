import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { importBulkText } from '../../src/data/io/bulkTextImportService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Bulk text import (User Story 4)', () => {
	let key: CryptoKey;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('7777', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
	});

	it('creates one unreviewed transaction per recognizable line', async () => {
		const fileText = [
			'Rs.500.00 debited from A/c XX1234 on 05-Jan-26 to AMAZON Ref No 1',
			'Credited: Rs 2000 to your account from Jane Doe'
		].join('\n');

		const result = await importBulkText(key, fileText, accountId);

		expect(result.createdCount).toBe(2);
		expect(result.skippedMalformedRows).toHaveLength(0);

		const transactions = await TransactionRepository.search(key, { accountId });
		expect(transactions).toHaveLength(2);
		expect(transactions.every((tx) => tx.reviewStatus === 'unreviewed')).toBe(true);
		expect(transactions.every((tx) => tx.source === 'bulk_import')).toBe(true);
	});

	it('reports unrecognizable lines instead of silently dropping them', async () => {
		const fileText = ['Thank you for shopping with us!', 'Rs.100 debited at Store'].join('\n');

		const result = await importBulkText(key, fileText, accountId);

		expect(result.createdCount).toBe(1);
		expect(result.skippedMalformedRows).toHaveLength(1);
		expect(result.skippedMalformedRows[0].rowNumber).toBe(1);
	});

	it('flags a likely duplicate instead of silently creating it twice', async () => {
		const fileText = 'Rs.300 debited at Cafe';

		const first = await importBulkText(key, fileText, accountId);
		expect(first.flaggedDuplicates).toHaveLength(0);

		const second = await importBulkText(key, fileText, accountId);
		expect(second.createdCount).toBe(1);
		expect(second.flaggedDuplicates).toHaveLength(1);

		const transactions = await TransactionRepository.search(key, { accountId });
		expect(transactions).toHaveLength(2);
		expect(transactions.some((tx) => tx.duplicateOfId !== null)).toBe(true);
	});

	it('files a line on the date it states, and dates one that states none as today', async () => {
		const fileText = [
			'Rs.500.00 debited from A/c XX1234 on 05-Jan-26 to AMAZON',
			'Rs.80 debited at Cafe'
		].join('\n');

		await importBulkText(key, fileText, accountId);

		const transactions = await TransactionRepository.search(key, { accountId });
		const dated = transactions.find((tx) => tx.amount === -500_00)!;
		const undated = transactions.find((tx) => tx.amount === -80_00)!;
		expect(dated.date).toBe('2026-01-05');
		expect(undated.date).not.toBe('2026-01-05');
	});

	it('judges duplicates against each line’s own date, not today’s', async () => {
		const line = 'Rs.300 debited at Cafe on 05-Jan-26';

		await importBulkText(key, line, accountId);
		const sameDay = await importBulkText(key, line, accountId);
		expect(sameDay.flaggedDuplicates).toHaveLength(1);

		// Same amount, but months apart: two genuine purchases, not a duplicate.
		const later = await importBulkText(key, 'Rs.300 debited at Cafe on 05-Mar-26', accountId);
		expect(later.flaggedDuplicates).toHaveLength(0);
	});

	it('ignores blank lines', async () => {
		const fileText = ['', 'Rs.50 debited at Shop', '', ''].join('\n');
		const result = await importBulkText(key, fileText, accountId);
		expect(result.createdCount).toBe(1);
		expect(result.skippedMalformedRows).toHaveLength(0);
	});

	// spec 017, FR-020/FR-021/FR-024: per-line card-identifier routing for a mixed statement.
	describe('card-identifier auto-routing (spec 017)', () => {
		it('routes each line to its matched card, falling back to the default for an unmatched line', async () => {
			const hdfcCard = await AccountRepository.create(key, {
				name: 'HDFC Card',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null,
				cardLast4: '4321'
			});
			const iciciCard = await AccountRepository.create(key, {
				name: 'ICICI Card',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null,
				cardLast4: '8765'
			});
			const accounts = [hdfcCard, iciciCard, (await AccountRepository.getById(key, accountId))!];

			const fileText = [
				'Rs.500 debited on card ending 4321 at Amazon',
				'Rs.300 debited on card ending 8765 at Flipkart',
				'Rs.100 debited at Local Store' // no identifier — falls back to the default account
			].join('\n');

			const result = await importBulkText(key, fileText, accountId, accounts);
			expect(result.createdCount).toBe(3);

			const hdfcTx = await TransactionRepository.search(key, { accountId: hdfcCard.id });
			const iciciTx = await TransactionRepository.search(key, { accountId: iciciCard.id });
			const defaultTx = await TransactionRepository.search(key, { accountId });
			expect(hdfcTx).toHaveLength(1);
			expect(iciciTx).toHaveLength(1);
			expect(defaultTx).toHaveLength(1);
			expect(hdfcTx[0].amount).toBe(-50000);
			expect(iciciTx[0].amount).toBe(-30000);

			// Every touched account's balance is recalculated, not just the default one.
			expect((await AccountRepository.getById(key, hdfcCard.id))?.currentBalance).toBe(-50000);
			expect((await AccountRepository.getById(key, iciciCard.id))?.currentBalance).toBe(-30000);
		});

		it('falls back to the default account when a line matches more than one tagged card', async () => {
			const first = await AccountRepository.create(key, {
				name: 'Card A',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null,
				cardLast4: '4321'
			});
			const second = await AccountRepository.create(key, {
				name: 'Card B',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null,
				cardLast4: '8765'
			});

			const fileText = 'Rs.200 debited, cards ending 4321 and 8765 both mentioned';
			const result = await importBulkText(key, fileText, accountId, [first, second]);
			expect(result.createdCount).toBe(1);

			const defaultTx = await TransactionRepository.search(key, { accountId });
			expect(defaultTx).toHaveLength(1); // ambiguous line never blocks — falls back, unrouted
		});

		it('routes a line to the bank account whose saved digits it names after "A/c"', async () => {
			const savings = await AccountRepository.create(key, {
				name: 'Savings',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null,
				accountLast4: '1234'
			});
			const fileText = [
				'Rs.500.00 debited from A/c XX1234 to AMAZON',
				'Rs.100 debited from A/c XX7777 at Local Store' // digits match nothing — default account
			].join('\n');

			const result = await importBulkText(key, fileText, accountId, [savings]);
			expect(result.createdCount).toBe(2);
			expect(await TransactionRepository.search(key, { accountId: savings.id })).toHaveLength(1);
			expect(await TransactionRepository.search(key, { accountId })).toHaveLength(1);
		});
	});
});
