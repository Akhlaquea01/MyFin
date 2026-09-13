import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { TagRepository } from '../../src/data/dexie/tagRepository';
import { AttachmentRepository } from '../../src/data/dexie/attachmentRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

/**
 * Regression: `TagRepository.getOrCreate` and `AttachmentRepository.create` used to do a
 * read-then-write with no enclosing Dexie transaction. Two concurrent calls could both pass
 * the check before either wrote, producing duplicate tags or momentarily exceeding
 * `MAX_ATTACHMENTS_PER_TRANSACTION`. Fixed by pre-encrypting outside the transaction (Web
 * Crypto breaks Dexie's transaction zone) and doing the check-then-write as one atomic
 * `db.transaction('rw', ...)` block.
 */
describe('concurrent writes are serialized, not racy', () => {
	let key: CryptoKey;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('9090', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
	});

	it('TagRepository.getOrCreate never creates two tags for the same concurrently-requested name', async () => {
		const results = await Promise.all(
			Array.from({ length: 10 }, () => TagRepository.getOrCreate(key, 'Reimbursable'))
		);

		const distinctIds = new Set(results.map((t) => t.id));
		expect(distinctIds.size).toBe(1);

		const allTags = await TagRepository.list(key);
		expect(allTags.filter((t) => t.name === 'Reimbursable')).toHaveLength(1);
	});

	it('AttachmentRepository.create never lets concurrent calls exceed the per-transaction cap', async () => {
		const tx = await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-01', amount: -500, type: 'expense' },
			[]
		);

		const attempts = await Promise.allSettled(
			Array.from({ length: 8 }, (_, i) =>
				AttachmentRepository.create(key, {
					transactionId: tx.id,
					mimeType: 'image/jpeg',
					data: `img-${i}`,
					sizeBytes: 5
				})
			)
		);

		const succeeded = attempts.filter((a) => a.status === 'fulfilled');
		const failed = attempts.filter((a) => a.status === 'rejected');
		expect(succeeded).toHaveLength(5);
		expect(failed).toHaveLength(3);

		const stored = await AttachmentRepository.listForTransaction(key, tx.id);
		expect(stored).toHaveLength(5);
	});
});
