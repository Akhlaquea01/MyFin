import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../src/data/dexie/transactionRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import type { Account, Transaction } from '../../src/domain/entities';

/** Small seeded PRNG so a failure reproduces from its seed. */
function mulberry32(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('ledger invariants hold under any sequence of operations', () => {
	let key: CryptoKey;
	let accounts: Account[];

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8181', randomSaltBase64());
		accounts = [];
		for (const [name, openingBalance] of [
			['Checking', 100_000],
			['Savings', 50_000],
			['Wallet', 0]
		] as const) {
			accounts.push(
				await AccountRepository.create(key, {
					name,
					type: 'bank',
					openingBalance,
					creditLimit: null,
					billingCycleDay: null
				})
			);
		}
	});

	async function assertInvariants(context: string) {
		const all = await TransactionRepository.search(key, { includeDeleted: true });
		const byId = new Map(all.map((tx) => [tx.id, tx]));
		for (const account of accounts) {
			const stored = (await AccountRepository.getById(key, account.id))!;
			const live = all.filter((tx) => tx.accountId === account.id && tx.deletedAt === null);
			const expected = account.openingBalance + live.reduce((sum, tx) => sum + tx.amount, 0);
			expect(stored.currentBalance, `${context}: balance of ${account.name}`).toBe(expected);
		}
		for (const tx of all) {
			const splits = await TransactionRepository.getSplits(key, tx.id);
			expect(
				splits.reduce((sum, s) => sum + s.amount, 0),
				`${context}: splits of ${tx.id}`
			).toBe(tx.amount);
			if (tx.type === 'transfer' && tx.transferPairId) {
				const pair = byId.get(tx.transferPairId);
				expect(pair, `${context}: pair of ${tx.id}`).toBeDefined();
				expect(pair!.transferPairId, `${context}: pairing is mutual`).toBe(tx.id);
				expect(pair!.amount, `${context}: legs cancel`).toBe(-tx.amount);
				expect(pair!.accountId).not.toBe(tx.accountId);
				expect(pair!.deletedAt === null, `${context}: legs live or trashed together`).toBe(
					tx.deletedAt === null
				);
			}
		}
	}

	it.each([1, 2, 3, 4])(
		'random create/edit/delete/restore/transfer sequence (seed %i)',
		async (seed) => {
			const random = mulberry32(seed);
			const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
			const money = () => (Math.floor(random() * 99_999) + 1) * (random() < 0.5 ? 1 : -1);
			const date = () => `2026-0${1 + Math.floor(random() * 9)}-${10 + Math.floor(random() * 18)}`;

			for (let step = 0; step < 60; step++) {
				const live = (await TransactionRepository.search(key)).filter(
					(tx) => tx.type !== 'transfer'
				);
				const trashed = (await TransactionRepository.search(key, { includeDeleted: true })).filter(
					(tx) => tx.deletedAt !== null
				);
				const roll = random();
				let label: string;
				if (roll < 0.3 || live.length === 0) {
					const amount = money();
					label = 'record';
					await TransactionEngine.recordTransaction(key, {
						accountId: pick(accounts).id,
						date: date(),
						amount,
						type: amount < 0 ? 'expense' : 'income'
					});
				} else if (roll < 0.45) {
					label = 'transfer';
					const [from, to] = [pick(accounts), pick(accounts)];
					if (from.id === to.id) continue;
					await TransactionEngine.recordTransfer(key, {
						fromAccountId: from.id,
						toAccountId: to.id,
						amount: Math.abs(money()),
						date: date()
					});
				} else if (roll < 0.6) {
					label = 'edit';
					const tx = pick(live);
					const amount = money();
					await TransactionEngine.editTransaction(
						key,
						tx.id,
						{
							amount,
							type: amount < 0 ? 'expense' : 'income',
							accountId: pick(accounts).id,
							date: date()
						},
						[{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount }]
					);
				} else if (roll < 0.72) {
					label = 'delete';
					const all = await TransactionRepository.search(key);
					await TransactionEngine.deleteTransaction(key, pick(all).id);
				} else if (roll < 0.82 && trashed.length > 0) {
					label = 'restore';
					await TransactionEngine.restoreTransaction(key, pick(trashed).id);
				} else if (roll < 0.9) {
					label = 'convert to transfer';
					const tx = pick(live);
					const target = pick(accounts.filter((a) => a.id !== tx.accountId));
					await TransactionEngine.convertToTransfer(key, tx.id, { accountId: target.id });
				} else {
					label = 'edit transfer';
					const transfers = (await TransactionRepository.search(key)).filter(
						(tx) => tx.type === 'transfer' && tx.transferPairId
					);
					if (transfers.length === 0) continue;
					await TransactionEngine.editTransferPair(key, pick(transfers).id, {
						amount: Math.abs(money()),
						date: date()
					});
				}
				await assertInvariants(`seed ${seed} step ${step} (${label})`);
			}
		},
		120_000
	);

	it('concurrent saves to one account still leave the balance equal to the ledger', async () => {
		const checking = accounts[0];
		await Promise.all(
			Array.from({ length: 12 }, (_, i) =>
				TransactionEngine.recordTransaction(key, {
					accountId: checking.id,
					date: '2026-03-05',
					amount: -(i + 1) * 100,
					type: 'expense'
				} satisfies Pick<Transaction, 'accountId' | 'date' | 'amount' | 'type'>)
			)
		);
		await assertInvariants('after 12 concurrent saves');
	});
});
