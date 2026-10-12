import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// "Confirm all categorized" must leave the entries that carry a warning for a human look. It asks
// the repository which of the candidates are flagged; flags live inside the encrypted entry.
describe('TransactionRepository.flaggedAmong', () => {
	let key: CryptoKey;
	let accountId: string;
	let categoryId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('482915', randomSaltBase64());
		accountId = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		categoryId = (await CategoryRepository.create(key, { name: 'Food' })).id;
	});

	async function waiting(extra: Record<string, unknown> = {}) {
		const tx = await TransactionRepository.create(
			key,
			{
				accountId,
				date: '2026-10-10',
				amount: -500,
				type: 'expense',
				reviewStatus: 'unreviewed',
				...extra
			},
			[{ categoryId, amount: -500 }]
		);
		return tx.id;
	}

	it('flags possible duplicates and captures filed on a guessed account, and nothing else', async () => {
		const plain = await waiting();
		const original = await waiting();
		const duplicate = await waiting({ duplicateOfId: original });
		const guessed = await waiting({
			capture: {
				channel: 'sms',
				sender: 'VM-HDFCBK',
				receivedAt: 1,
				text: 'Rs.500 debited',
				accountCheck: 'default-account'
			}
		});
		const matched = await waiting({
			capture: { channel: 'sms', sender: 'VM-HDFCBK', receivedAt: 1, text: 'Rs.500 debited' }
		});

		const flagged = await TransactionRepository.flaggedAmong(key, [
			plain,
			original,
			duplicate,
			guessed,
			matched
		]);

		expect([...flagged].sort()).toEqual([duplicate, guessed].sort());
	});

	it('is empty for no candidates and ignores ids that no longer exist', async () => {
		expect((await TransactionRepository.flaggedAmong(key, [])).size).toBe(0);
		expect((await TransactionRepository.flaggedAmong(key, ['missing-id'])).size).toBe(0);
	});
});
