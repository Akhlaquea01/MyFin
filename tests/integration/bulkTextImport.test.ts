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

	it('ignores blank lines', async () => {
		const fileText = ['', 'Rs.50 debited at Shop', '', ''].join('\n');
		const result = await importBulkText(key, fileText, accountId);
		expect(result.createdCount).toBe(1);
		expect(result.skippedMalformedRows).toHaveLength(0);
	});
});
