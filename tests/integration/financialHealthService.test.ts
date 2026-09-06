import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { BudgetRepository } from '../../src/data/dexie/budgetRepository';
import { ensureCurrentBudgetItem } from '../../src/domain/budgets/budgetEngine';
import {
	getFinancialHealthTrend,
	getFinancialHealthScore
} from '../../src/domain/analytics/financialHealthService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('financialHealthService against Dexie (via the existing analyticsEngine functions)', () => {
	let key: CryptoKey;
	let accountId: string;
	let groceriesId: string;
	let diningId: string;
	let salaryId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('6666', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
		groceriesId = (await CategoryRepository.create(key, { name: 'Groceries' })).id;
		diningId = (await CategoryRepository.create(key, { name: 'Dining' })).id;
		salaryId = (await CategoryRepository.create(key, { name: 'Salary' })).id;
	});

	it('matches manual computation for a month with income, expense, and mixed budget adherence (quickstart Scenario 1)', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-10', amount: 50000, type: 'income' },
			[{ categoryId: salaryId, amount: 50000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-05', amount: -15000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -15000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-06', amount: -5000, type: 'expense' },
			[{ categoryId: diningId, amount: -5000 }]
		);

		// Within-limit budget: planned 20000, actual 15000 (groceries).
		const groceriesBudget = await BudgetRepository.create(key, {
			categoryId: groceriesId,
			periodType: 'monthly',
			amount: 20000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await ensureCurrentBudgetItem(key, groceriesBudget, new Date('2026-01-15T00:00:00Z'));

		// Over-limit budget: planned 3000, actual 5000 (dining).
		const diningBudget = await BudgetRepository.create(key, {
			categoryId: diningId,
			periodType: 'monthly',
			amount: 3000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await ensureCurrentBudgetItem(key, diningBudget, new Date('2026-01-15T00:00:00Z'));

		const trend = await getFinancialHealthTrend(key, '2026-01-01', '2026-01-31');
		expect(trend).toHaveLength(1);
		const january = trend[0];
		expect(january.month).toBe('2026-01');
		expect(january.income).toBe(50000);
		expect(january.expense).toBe(20000);
		expect(january.savingsRate).toBeCloseTo((50000 - 20000) / 50000);
		expect(january.expenseToIncomeRatio).toBeCloseTo(20000 / 50000);
		expect(january.budgetsConsidered).toBe(2);
		expect(january.budgetAdherence).toBeCloseTo(50); // 1 of 2 within limit
	});

	it('reports null ratios for a month with only expense transactions (quickstart Scenario 2)', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-02-05', amount: -4000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -4000 }]
		);

		const trend = await getFinancialHealthTrend(key, '2026-02-01', '2026-02-28');
		expect(trend).toHaveLength(1);
		expect(trend[0].savingsRate).toBeNull();
		expect(trend[0].expenseToIncomeRatio).toBeNull();
	});

	it('reports null budget adherence with budgetsConsidered=0 for a month with no active budgets (quickstart Scenario 3)', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-03-10', amount: 30000, type: 'income' },
			[{ categoryId: salaryId, amount: 30000 }]
		);

		const trend = await getFinancialHealthTrend(key, '2026-03-01', '2026-03-31');
		expect(trend).toHaveLength(1);
		expect(trend[0].budgetAdherence).toBeNull();
		expect(trend[0].budgetsConsidered).toBe(0);
	});

	it('returns one point per month, sorted ascending, each matching its own single-month figures (quickstart Scenario 4)', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-10', amount: 40000, type: 'income' },
			[{ categoryId: salaryId, amount: 40000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-02-10', amount: 45000, type: 'income' },
			[{ categoryId: salaryId, amount: 45000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-02-15', amount: -10000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -10000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-03-10', amount: 50000, type: 'income' },
			[{ categoryId: salaryId, amount: 50000 }]
		);

		const trend = await getFinancialHealthTrend(key, '2026-01-01', '2026-03-31');
		expect(trend.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);

		// Each month's figures must match what a single-month query for that month alone gives.
		const januaryAlone = await getFinancialHealthTrend(key, '2026-01-01', '2026-01-31');
		const februaryAlone = await getFinancialHealthTrend(key, '2026-02-01', '2026-02-28');
		expect(trend[0]).toEqual(januaryAlone[0]);
		expect(trend[1]).toEqual(februaryAlone[0]);
	});

	it('bucketes a yearly budget into only its start month, not spread across the range (research.md §3)', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-10', amount: 100000, type: 'income' },
			[{ categoryId: salaryId, amount: 100000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-02-10', amount: 100000, type: 'income' },
			[{ categoryId: salaryId, amount: 100000 }]
		);
		const yearlyBudget = await BudgetRepository.create(key, {
			categoryId: groceriesId,
			periodType: 'yearly',
			amount: 120000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await ensureCurrentBudgetItem(key, yearlyBudget, new Date('2026-01-15T00:00:00Z'));

		const trend = await getFinancialHealthTrend(key, '2026-01-01', '2026-02-28');
		expect(trend[0].budgetsConsidered).toBe(1); // January (period start)
		expect(trend[1].budgetsConsidered).toBe(0); // February gets nothing
	});

	it('derives the composite score from the same trend the UI renders (getFinancialHealthScore)', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-10', amount: 50000, type: 'income' },
			[{ categoryId: salaryId, amount: 50000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-05', amount: -20000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -20000 }]
		);

		const trend = await getFinancialHealthTrend(key, '2026-01-01', '2026-01-31');
		const score = await getFinancialHealthScore(key, '2026-01-01', '2026-01-31');
		expect(score.breakdown.savingsRate.value).toBe(trend[trend.length - 1].savingsRate);
	});
});
