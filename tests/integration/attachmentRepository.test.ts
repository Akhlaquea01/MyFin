import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AttachmentRepository } from '../../src/data/dexie/attachmentRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('AttachmentRepository + TransactionRepository.purge against Dexie', () => {
	let key: CryptoKey;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('5555', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
	});

	async function makeTransaction(): Promise<string> {
		const tx = await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-01', amount: -500, type: 'expense' },
			[]
		);
		return tx.id;
	}

	it('creates, lists, and removes attachments independently', async () => {
		const transactionId = await makeTransaction();
		const a = await AttachmentRepository.create(key, {
			transactionId,
			mimeType: 'image/jpeg',
			data: 'AAAA',
			sizeBytes: 3
		});
		const b = await AttachmentRepository.create(key, {
			transactionId,
			mimeType: 'image/png',
			data: 'BBBB',
			sizeBytes: 3
		});

		const listed = await AttachmentRepository.listForTransaction(key, transactionId);
		expect(listed.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());

		await AttachmentRepository.remove(key, a.id);
		const afterRemove = await AttachmentRepository.listForTransaction(key, transactionId);
		expect(afterRemove.map((x) => x.id)).toEqual([b.id]);
	});

	it('rejects a 6th attachment on the same transaction', async () => {
		const transactionId = await makeTransaction();
		for (let i = 0; i < 5; i++) {
			await AttachmentRepository.create(key, {
				transactionId,
				mimeType: 'image/jpeg',
				data: `img-${i}`,
				sizeBytes: 5
			});
		}
		await expect(
			AttachmentRepository.create(key, {
				transactionId,
				mimeType: 'image/jpeg',
				data: 'one-too-many',
				sizeBytes: 5
			})
		).rejects.toThrow();
	});

	it('countsForTransactions returns a bulk map, omitting transactions with none', async () => {
		const withAttachment = await makeTransaction();
		const withoutAttachment = await makeTransaction();
		await AttachmentRepository.create(key, {
			transactionId: withAttachment,
			mimeType: 'image/jpeg',
			data: 'x',
			sizeBytes: 1
		});

		const counts = await AttachmentRepository.countsForTransactions(key, [
			withAttachment,
			withoutAttachment
		]);
		expect(counts[withAttachment]).toBe(1);
		expect(counts[withoutAttachment]).toBeUndefined();
	});

	it('TransactionRepository.purge rejects an active (non-soft-deleted) transaction', async () => {
		const transactionId = await makeTransaction();
		await expect(TransactionRepository.purge(key, transactionId)).rejects.toThrow();
	});

	it('TransactionRepository.purge hard-deletes the transaction, its splits, tags, and attachments', async () => {
		const transactionId = await makeTransaction();
		await AttachmentRepository.create(key, {
			transactionId,
			mimeType: 'image/jpeg',
			data: 'receipt',
			sizeBytes: 7
		});

		await TransactionRepository.softDelete(key, transactionId);
		await TransactionRepository.purge(key, transactionId);

		expect(await TransactionRepository.getById(key, transactionId)).toBeNull();
		expect(await AttachmentRepository.listForTransaction(key, transactionId)).toEqual([]);
		expect(await db.transactionSplits.where('transactionId').equals(transactionId).count()).toBe(0);
		expect(await db.transactionTags.where('transactionId').equals(transactionId).count()).toBe(0);
	});
});
