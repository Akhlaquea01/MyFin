import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { getDashboardSummary } from '../../src/domain/analytics/dashboardService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Dashboard aggregation', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('4444', randomSaltBase64());
	});

	it('reconciles total balance and net worth with the underlying ledger', async () => {
		const checking = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		await AccountRepository.create(key, {
			name: 'Savings',
			type: 'bank',
			openingBalance: 50000,
			creditLimit: null,
			billingCycleDay: null
		});
		await TransactionEngine.recordTransaction(key, {
			accountId: checking.id,
			date: '2026-02-01',
			amount: -2000,
			type: 'expense'
		});

		const summary = await getDashboardSummary(key);
		expect(summary.totalBalance).toBe(100000 - 2000 + 50000);
		expect(summary.netWorth).toBe(summary.totalBalance);
	});

	it('counts unreviewed transactions', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		await TransactionEngine.recordTransaction(key, {
			accountId: account.id,
			date: '2026-02-01',
			amount: -500,
			type: 'expense',
			reviewStatus: 'unreviewed'
		});
		await TransactionEngine.recordTransaction(key, {
			accountId: account.id,
			date: '2026-02-02',
			amount: -100,
			type: 'expense'
		});

		const summary = await getDashboardSummary(key);
		expect(summary.unreviewedCount).toBe(1);
	});

	it('returns the most recent transactions, newest first, capped at 5', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		for (let i = 1; i <= 7; i++) {
			await TransactionEngine.recordTransaction(key, {
				accountId: account.id,
				date: `2026-01-${String(i).padStart(2, '0')}`,
				amount: -100,
				type: 'expense'
			});
		}

		const summary = await getDashboardSummary(key);
		expect(summary.recentTransactions).toHaveLength(5);
		expect(summary.recentTransactions[0].date).toBe('2026-01-07');
	});

	it('produces a balance trend that ends at the current total balance', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 1000,
			creditLimit: null,
			billingCycleDay: null
		});
		await TransactionEngine.recordTransaction(key, {
			accountId: account.id,
			date: '2026-01-01',
			amount: -100,
			type: 'expense'
		});
		await TransactionEngine.recordTransaction(key, {
			accountId: account.id,
			date: '2026-01-02',
			amount: 200,
			type: 'income'
		});

		const summary = await getDashboardSummary(key);
		expect(summary.balanceTrend.at(-1)).toBe(summary.totalBalance);
		expect(summary.balanceTrend).toEqual([900, 1100]);
	});
});
