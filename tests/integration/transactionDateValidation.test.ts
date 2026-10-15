import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Transaction dates are validated where they are stored', () => {
	let key: CryptoKey;
	let checking: string;
	let savings: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8181', randomSaltBase64());
		const make = (name: string) =>
			AccountRepository.create(key, {
				name,
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
		checking = (await make('Checking')).id;
		savings = (await make('Savings')).id;
	});

	it('refuses to create an entry with an empty or impossible date', async () => {
		for (const date of ['', '2026-02-31', '05/03/2026']) {
			await expect(
				TransactionEngine.recordTransaction(key, {
					accountId: checking,
					date,
					amount: -1000,
					type: 'expense'
				})
			).rejects.toThrow('Enter a valid date.');
		}
		expect(await TransactionRepository.search(key, { accountId: checking })).toEqual([]);
	});

	it('refuses to edit an entry into an empty date, and leaves the entry as it was', async () => {
		const tx = await TransactionEngine.recordTransaction(key, {
			accountId: checking,
			date: '2026-03-05',
			amount: -1000,
			type: 'expense'
		});
		await expect(
			TransactionEngine.editTransaction(key, tx.id, { date: '' }, [
				{ categoryId: '__uncategorized__', amount: -1000 }
			])
		).rejects.toThrow('Enter a valid date.');
		expect((await TransactionRepository.getById(key, tx.id))?.date).toBe('2026-03-05');
	});

	it('refuses a transfer on an empty date, and a transfer edit onto one', async () => {
		await expect(
			TransactionEngine.recordTransfer(key, {
				fromAccountId: checking,
				toAccountId: savings,
				amount: 5000,
				date: ''
			})
		).rejects.toThrow('Enter a valid date.');

		const [out, inn] = await TransactionEngine.recordTransfer(key, {
			fromAccountId: checking,
			toAccountId: savings,
			amount: 5000,
			date: '2026-03-05'
		});
		await expect(TransactionEngine.editTransferPair(key, out.id, { date: '' })).rejects.toThrow(
			'Enter a valid date.'
		);
		expect((await TransactionRepository.getById(key, out.id))?.date).toBe('2026-03-05');
		expect((await TransactionRepository.getById(key, inn.id))?.date).toBe('2026-03-05');
	});

	it('still lets an entry that already holds an odd date be deleted and restored', async () => {
		// Written straight through the repository's batch path the way an old import could have.
		const tx = await TransactionEngine.recordTransaction(key, {
			accountId: checking,
			date: '2026-03-05',
			amount: -1000,
			type: 'expense'
		});
		await TransactionRepository.writeAtomic(key, [{ transaction: { ...tx, date: '2026-02-31' } }]);

		await TransactionEngine.deleteTransaction(key, tx.id);
		await TransactionEngine.restoreTransaction(key, tx.id);
		expect((await TransactionRepository.getById(key, tx.id))?.deletedAt).toBeNull();
	});
});
