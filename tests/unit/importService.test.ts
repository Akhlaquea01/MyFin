import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
	parseCsv,
	parseDateWithFormat,
	importRows,
	resolveAccountForRow,
	findAccountNameCollisions,
	type ColumnMapping
} from '../../src/data/io/importService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import type { Account } from '../../src/domain/entities';

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

	describe('resolveAccountForRow (FR-003)', () => {
		it('matches an account by exact name', () => {
			const accounts = [{ id: '1', name: 'Checking' } as Account];
			expect(resolveAccountForRow('Checking', accounts)?.id).toBe('1');
		});

		it('matches ignoring case and surrounding whitespace', () => {
			const accounts = [{ id: '1', name: 'Checking' } as Account];
			expect(resolveAccountForRow('  checking  ', accounts)?.id).toBe('1');
		});

		it('returns null for a blank value', () => {
			const accounts = [{ id: '1', name: 'Checking' } as Account];
			expect(resolveAccountForRow('   ', accounts)).toBeNull();
		});

		it('returns null when no account matches', () => {
			const accounts = [{ id: '1', name: 'Checking' } as Account];
			expect(resolveAccountForRow('NonExistent', accounts)).toBeNull();
		});

		it('matches an archived account the same as an active one', () => {
			const accounts = [{ id: '1', name: 'Old Wallet', isArchived: true } as Account];
			expect(resolveAccountForRow('Old Wallet', accounts)?.id).toBe('1');
		});

		it('does not match a raw account id — matching is name-only', () => {
			const accounts = [{ id: 'acc-001', name: 'Checking' } as Account];
			expect(resolveAccountForRow('acc-001', accounts)).toBeNull();
		});
	});

	describe('findAccountNameCollisions (FR-006)', () => {
		it('returns no collisions when every referenced name is unique', () => {
			const accounts = [
				{ id: '1', name: 'Checking' } as Account,
				{ id: '2', name: 'Savings' } as Account
			];
			expect(findAccountNameCollisions(['Checking', 'Savings'], accounts)).toEqual([]);
		});

		it('flags a name shared by two accounts', () => {
			const accounts = [
				{ id: '1', name: 'Checking' } as Account,
				{ id: '2', name: 'Checking' } as Account
			];
			expect(findAccountNameCollisions(['Checking'], accounts)).toEqual(['Checking']);
		});

		it('does not treat a value matching zero accounts as a collision', () => {
			const accounts = [{ id: '1', name: 'Checking' } as Account];
			expect(findAccountNameCollisions(['NonExistent'], accounts)).toEqual([]);
		});

		it('deduplicates repeated colliding values', () => {
			const accounts = [
				{ id: '1', name: 'Checking' } as Account,
				{ id: '2', name: 'Checking' } as Account
			];
			expect(findAccountNameCollisions(['Checking', 'checking', ' Checking '], accounts)).toEqual([
				'Checking'
			]);
		});
	});

	describe('importRows multi-account routing (US1, FR-002/FR-003/FR-004)', () => {
		it('routes each row to the account named in the account column', async () => {
			const savings = await AccountRepository.create(key, {
				name: 'Savings',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			const mapping: ColumnMapping = {
				dateColumn: 'Date',
				amountColumn: 'Amount',
				accountColumn: 'Account',
				accountId,
				dateFormat: 'YYYY-MM-DD',
				amountSignConvention: 'negative-is-expense'
			};
			const rows = [
				{ Date: '2026-03-05', Amount: '-40.00', Account: 'Checking' },
				{ Date: '2026-03-06', Amount: '-20.00', Account: 'Savings' },
				{ Date: '2026-03-07', Amount: '10.00', Account: ' checking ' }
			];

			const result = await importRows(key, rows, mapping, [
				{ id: accountId, name: 'Checking' } as Account,
				{ id: savings.id, name: 'Savings' } as Account
			]);

			expect(result.createdCount).toBe(3);
			const checkingTx = await TransactionRepository.search(key, { accountId });
			const savingsTx = await TransactionRepository.search(key, { accountId: savings.id });
			expect(checkingTx).toHaveLength(2);
			expect(savingsTx).toHaveLength(1);
		});

		it('skips and reports a blank or unresolved account value without dropping other rows', async () => {
			const mapping: ColumnMapping = {
				dateColumn: 'Date',
				amountColumn: 'Amount',
				accountColumn: 'Account',
				accountId,
				dateFormat: 'YYYY-MM-DD',
				amountSignConvention: 'negative-is-expense'
			};
			const rows = [
				{ Date: '2026-03-05', Amount: '-40.00', Account: 'Checking' },
				{ Date: '2026-03-06', Amount: '-20.00', Account: '' },
				{ Date: '2026-03-07', Amount: '10.00', Account: 'Nonexistent' }
			];

			const result = await importRows(key, rows, mapping, [
				{ id: accountId, name: 'Checking' } as Account
			]);

			expect(result.createdCount).toBe(1);
			expect(result.skippedMalformedRows).toEqual([
				{ rowNumber: 3, reason: 'Account column is empty.' },
				{ rowNumber: 4, reason: 'Account "Nonexistent" not found.' }
			]);
		});

		it('behaves exactly as before when no account column is mapped (backward compatibility)', async () => {
			const mapping: ColumnMapping = {
				dateColumn: 'Date',
				amountColumn: 'Amount',
				accountId,
				dateFormat: 'YYYY-MM-DD',
				amountSignConvention: 'negative-is-expense'
			};
			const rows = [{ Date: '2026-03-05', Amount: '-40.00' }];

			const result = await importRows(key, rows, mapping);
			expect(result.createdCount).toBe(1);
			expect(result.perAccountSummary).toBeUndefined();
			const transactions = await TransactionRepository.search(key, { accountId });
			expect(transactions).toHaveLength(1);
		});

		it('keeps duplicate detection and balance updates scoped to each row account', async () => {
			const savings = await AccountRepository.create(key, {
				name: 'Savings',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			await TransactionRepository.create(
				key,
				{ accountId, date: '2026-03-05', amount: -4000, type: 'expense' },
				[]
			);

			const mapping: ColumnMapping = {
				dateColumn: 'Date',
				amountColumn: 'Amount',
				accountColumn: 'Account',
				accountId,
				dateFormat: 'YYYY-MM-DD',
				amountSignConvention: 'negative-is-expense'
			};
			const rows = [
				// Same date/amount as the existing Checking transaction, but on Savings — must
				// NOT be flagged as a duplicate (it's a different account).
				{ Date: '2026-03-05', Amount: '-40.00', Account: 'Savings' },
				// Same date/amount, same account as the existing transaction — SHOULD be flagged.
				{ Date: '2026-03-05', Amount: '-40.00', Account: 'Checking' }
			];

			const result = await importRows(key, rows, mapping, [
				{ id: accountId, name: 'Checking' } as Account,
				{ id: savings.id, name: 'Savings' } as Account
			]);

			expect(result.createdCount).toBe(2);
			expect(result.flaggedDuplicates).toHaveLength(1);

			const checkingAccount = await AccountRepository.getById(key, accountId);
			const savingsAccount = await AccountRepository.getById(key, savings.id);
			expect(checkingAccount?.currentBalance).toBe(-8000);
			expect(savingsAccount?.currentBalance).toBe(-4000);
		});
	});

	describe('importRows account-name collision blocking (US2, FR-006)', () => {
		it('throws before creating any transaction when an account name is ambiguous', async () => {
			const secondChecking = await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			const mapping: ColumnMapping = {
				dateColumn: 'Date',
				amountColumn: 'Amount',
				accountColumn: 'Account',
				accountId,
				dateFormat: 'YYYY-MM-DD',
				amountSignConvention: 'negative-is-expense'
			};
			const rows = [
				{ Date: '2026-03-05', Amount: '-40.00', Account: 'Checking' },
				{ Date: '2026-03-06', Amount: '-20.00', Account: 'Checking' }
			];

			await expect(
				importRows(key, rows, mapping, [
					{ id: accountId, name: 'Checking' } as Account,
					{ id: secondChecking.id, name: 'Checking' } as Account
				])
			).rejects.toThrow(/Checking/);

			const allTx = await TransactionRepository.search(key, {});
			expect(allTx).toHaveLength(0);
		});
	});

	describe('importRows perAccountSummary (US3, FR-007)', () => {
		it('reports a count and account name per touched account', async () => {
			const savings = await AccountRepository.create(key, {
				name: 'Savings',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			const mapping: ColumnMapping = {
				dateColumn: 'Date',
				amountColumn: 'Amount',
				accountColumn: 'Account',
				accountId,
				dateFormat: 'YYYY-MM-DD',
				amountSignConvention: 'negative-is-expense'
			};
			const rows = [
				{ Date: '2026-03-05', Amount: '-40.00', Account: 'Checking' },
				{ Date: '2026-03-06', Amount: '-20.00', Account: 'Savings' },
				{ Date: '2026-03-07', Amount: '-10.00', Account: 'Checking' }
			];

			const result = await importRows(key, rows, mapping, [
				{ id: accountId, name: 'Checking' } as Account,
				{ id: savings.id, name: 'Savings' } as Account
			]);

			expect(result.perAccountSummary).toEqual({
				[accountId]: { count: 2, accountName: 'Checking' },
				[savings.id]: { count: 1, accountName: 'Savings' }
			});
		});
	});
});
