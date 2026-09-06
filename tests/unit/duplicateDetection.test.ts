import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// FR-020 / FR-038: "likely duplicate" = same account + same amount + date within ±1 day.

describe('Duplicate transaction detection', () => {
	let key: CryptoKey;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('2222', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-03-10', amount: -25000, type: 'expense' },
			[]
		);
	});

	it('flags a same-day, same-amount transaction on the same account as a duplicate', async () => {
		const dupes = await TransactionRepository.findPossibleDuplicates(
			key,
			accountId,
			-25000,
			'2026-03-10'
		);
		expect(dupes).toHaveLength(1);
	});

	it('flags a transaction one day later with the same amount as a duplicate', async () => {
		const dupes = await TransactionRepository.findPossibleDuplicates(
			key,
			accountId,
			-25000,
			'2026-03-11'
		);
		expect(dupes).toHaveLength(1);
	});

	it('does not flag a transaction more than one day away', async () => {
		const dupes = await TransactionRepository.findPossibleDuplicates(
			key,
			accountId,
			-25000,
			'2026-03-13'
		);
		expect(dupes).toHaveLength(0);
	});

	it('does not flag a different amount on the same day', async () => {
		const dupes = await TransactionRepository.findPossibleDuplicates(
			key,
			accountId,
			-9999,
			'2026-03-10'
		);
		expect(dupes).toHaveLength(0);
	});

	it('does not flag a matching amount/date on a different account', async () => {
		const otherAccount = await AccountRepository.create(key, {
			name: 'Savings',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		const dupes = await TransactionRepository.findPossibleDuplicates(
			key,
			otherAccount.id,
			-25000,
			'2026-03-10'
		);
		expect(dupes).toHaveLength(0);
	});
});
