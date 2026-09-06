import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
	parseCsv,
	parseDateWithFormat,
	importRows,
	type ColumnMapping
} from '../../src/data/io/importService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Import service', () => {
	let key: CryptoKey;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8181', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
	});

	it('parses a date under an explicit column-mapping format', () => {
		expect(parseDateWithFormat('05/03/2026', 'DD/MM/YYYY')).toBe('2026-03-05');
		expect(parseDateWithFormat('2026-03-05', 'YYYY-MM-DD')).toBe('2026-03-05');
		expect(parseDateWithFormat('not-a-date', 'DD/MM/YYYY')).toBeNull();
	});

	it('parses CSV headers and rows', () => {
		const csv = 'Date,Description,Amount\n05/03/2026,Groceries,-40.00\n';
		const parsed = parseCsv(csv);
		expect(parsed.headers).toEqual(['Date', 'Description', 'Amount']);
		expect(parsed.rows).toEqual([
			{ Date: '05/03/2026', Description: 'Groceries', Amount: '-40.00' }
		]);
	});

	it('imports well-formed rows and reports malformed ones without silently dropping them', async () => {
		const mapping: ColumnMapping = {
			dateColumn: 'Date',
			amountColumn: 'Amount',
			descriptionColumn: 'Description',
			accountId,
			dateFormat: 'DD/MM/YYYY',
			amountSignConvention: 'negative-is-expense'
		};
		const rows = [
			{ Date: '05/03/2026', Description: 'Groceries', Amount: '-40.00' },
			{ Date: 'not-a-date', Description: 'Bad row', Amount: '10.00' },
			{ Date: '06/03/2026', Description: 'Salary', Amount: '500.00' }
		];

		const result = await importRows(key, rows, mapping);
		expect(result.createdCount).toBe(2);
		expect(result.skippedMalformedRows).toEqual([{ rowNumber: 3, reason: 'Unparseable date.' }]);

		const transactions = await TransactionRepository.search(key, { accountId });
		expect(transactions).toHaveLength(2);
		expect(transactions.every((t) => t.reviewStatus === 'unreviewed')).toBe(true);
		expect(transactions.every((t) => t.source === 'file_import')).toBe(true);
	});

	it('flags a likely duplicate rather than silently merging or discarding it', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-03-05', amount: -4000, type: 'expense' },
			[]
		);
		const mapping: ColumnMapping = {
			dateColumn: 'Date',
			amountColumn: 'Amount',
			accountId,
			dateFormat: 'YYYY-MM-DD',
			amountSignConvention: 'negative-is-expense'
		};
		const result = await importRows(key, [{ Date: '2026-03-05', Amount: '-40.00' }], mapping);
		expect(result.createdCount).toBe(1);
		expect(result.flaggedDuplicates).toHaveLength(1);
	});

	it('supports separate debit/credit columns as an alternative sign convention', async () => {
		const mapping: ColumnMapping = {
			dateColumn: 'Date',
			amountColumn: 'Amount',
			accountId,
			dateFormat: 'YYYY-MM-DD',
			amountSignConvention: 'separate-debit-credit-columns',
			debitColumn: 'Debit',
			creditColumn: 'Credit'
		};
		const rows = [
			{ Date: '2026-03-05', Debit: '40.00', Credit: '' },
			{ Date: '2026-03-06', Debit: '', Credit: '500.00' }
		];
		const result = await importRows(key, rows, mapping);
		expect(result.createdCount).toBe(2);
		const transactions = await TransactionRepository.search(key, { accountId });
		expect(transactions.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-4000, 50000]);
	});
});
