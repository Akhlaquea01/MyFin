import { describe, it, expect, beforeEach } from 'vitest';
import { db, type TransactionSplitRow } from '../../src/data/dexie/db';
import { encryptRow } from '../../src/data/dexie/encryptedTable';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../src/data/dexie/transactionRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import {
	checkIntegrity,
	describeIntegrityIssue,
	repairBalances
} from '../../src/data/io/integrityService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import type { TransactionSplit } from '../../src/domain/entities';

describe('data integrity check', () => {
	let key: CryptoKey;
	let checking: string;
	let savings: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8181', randomSaltBase64());
		const make = (name: string, openingBalance: number) =>
			AccountRepository.create(key, {
				name,
				type: 'bank',
				openingBalance,
				creditLimit: null,
				billingCycleDay: null
			});
		checking = (await make('Checking', 10_000)).id;
		savings = (await make('Savings', 0)).id;
	});

	const kinds = async () => (await checkIntegrity(key)).issues.map((issue) => issue.kind);

	it('finds nothing wrong in a ledger built through the normal flows', async () => {
		const groceries = await CategoryRepository.create(key, { name: 'Groceries' });
		await TransactionEngine.recordTransaction(
			key,
			{ accountId: checking, date: '2026-03-05', amount: -2500, type: 'expense' },
			[{ categoryId: groceries.id, amount: -2500 }]
		);
		await TransactionEngine.recordTransfer(key, {
			fromAccountId: checking,
			toAccountId: savings,
			amount: 1000,
			date: '2026-03-06'
		});
		const [first] = await TransactionRepository.search(key);
		await TransactionEngine.deleteTransaction(key, first.id);

		const report = await checkIntegrity(key);
		expect(report.issues).toEqual([]);
		// The transfer (both legs) was deleted; only the expense is left to check.
		expect(report.checkedTransactions).toBe(1);
	});

	it('reports a balance that has drifted, and repairBalances rebuilds it from the ledger', async () => {
		await TransactionEngine.recordTransaction(key, {
			accountId: checking,
			date: '2026-03-05',
			amount: -2500,
			type: 'expense'
		});
		await AccountRepository.setBalance(key, checking, 999);

		const { issues } = await checkIntegrity(key);
		expect(issues).toEqual([
			{
				kind: 'balance-mismatch',
				accountId: checking,
				accountName: 'Checking',
				stored: 999,
				expected: 7_500
			}
		]);
		expect(describeIntegrityIssue(issues[0])).toContain('Checking');

		expect(await repairBalances(key)).toBe(1);
		expect(await kinds()).toEqual([]);
		expect((await AccountRepository.getById(key, checking))?.currentBalance).toBe(7_500);
		expect(await repairBalances(key)).toBe(0);
	});

	it('reports entries whose categories do not add up, or that point at things that are gone', async () => {
		const mismatched = await TransactionEngine.recordTransaction(key, {
			accountId: checking,
			date: '2026-03-05',
			amount: -1000,
			type: 'expense'
		});
		const [split] = await TransactionRepository.getSplits(key, mismatched.id);
		const bad: TransactionSplit = { ...split, amount: -900 };
		await db.transactionSplits.put(
			await encryptRow<TransactionSplitRow, TransactionSplit>(key, bad, {
				transactionId: bad.transactionId,
				categoryId: bad.categoryId
			})
		);
		await TransactionRepository.create(
			key,
			{ accountId: 'no-such-account', date: '2026-03-06', amount: -100, type: 'expense' },
			[{ categoryId: 'ghost-category', amount: -100 }]
		);

		const found = await kinds();
		expect(found).toContain('split-mismatch');
		expect(found).toContain('unknown-account');
		expect(found).toContain('unknown-category');
	});

	it('does not call a deleted category an orphan: its entries fall back to Uncategorized', async () => {
		const category = await CategoryRepository.create(key, { name: 'Old' });
		const tx = await TransactionEngine.recordTransaction(
			key,
			{ accountId: savings, date: '2026-03-05', amount: -100, type: 'expense' },
			[{ categoryId: category.id, amount: -100 }]
		);
		await CategoryRepository.remove(key, category.id);
		expect(await kinds()).toEqual([]);
		expect((await TransactionRepository.getSplits(key, tx.id)).map((s) => s.categoryId)).toEqual([
			UNCATEGORIZED_CATEGORY_ID
		]);
	});

	it('reports a transfer whose other half is missing', async () => {
		const [, inLeg] = await TransactionEngine.recordTransfer(key, {
			fromAccountId: checking,
			toAccountId: savings,
			amount: 1000,
			date: '2026-03-06'
		});

		await db.transactions.delete(inLeg.id); // one leg only, bypassing the engine
		const report = await checkIntegrity(key);
		expect(report.issues).toContainEqual(
			expect.objectContaining({ kind: 'broken-transfer', reason: 'missing-other-leg' })
		);
	});

	it('does not mistake a person-loan movement (a lone transfer entry) for a broken transfer', async () => {
		await TransactionRepository.create(
			key,
			{ accountId: checking, date: '2026-03-05', amount: -5000, type: 'transfer' },
			[]
		);
		await TransactionEngine.recalculateAccountBalance(key, checking);
		expect(await kinds()).toEqual([]);
	});

	it('reports an entry saved with an unusable date', async () => {
		const tx = await TransactionEngine.recordTransaction(key, {
			accountId: checking,
			date: '2026-03-05',
			amount: -100,
			type: 'expense'
		});
		await TransactionRepository.writeAtomic(key, [{ transaction: { ...tx, date: '' } }]);
		expect(await kinds()).toEqual(['invalid-date']);
	});
});
