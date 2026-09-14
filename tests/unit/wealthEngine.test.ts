import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository,
	LiabilityRepository
} from '../../src/data/dexie/wealthRepository';
import {
	computeNetWorth,
	recordNetWorthSnapshot,
	netWorthHistory,
	recordPurchase,
	recordSale,
	computeCardUtilization,
	HIGH_UTILIZATION_THRESHOLD_PERCENT,
	findLikelyDuplicateAccounts,
	linkLiabilityToAccount,
	dismissDuplicateWarning,
	computePortfolioSummary
} from '../../src/domain/wealth/wealthEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import { PersonRepository, PersonLoanRepository } from '../../src/data/dexie/personLoanRepository';

describe('Wealth engine', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('1111', randomSaltBase64());
	});

	it('computes net worth as cash + investments - liabilities', async () => {
		await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const holding = await InvestmentHoldingRepository.create(key, {
			name: 'Index Fund',
			type: 'mutual fund',
			costBasis: 50000
		});
		await InvestmentValuationRepository.create(key, {
			holdingId: holding.id,
			date: '2026-03-01',
			value: 60000
		});
		await LiabilityRepository.create(key, {
			name: 'Car Loan',
			type: 'loan',
			outstandingBalance: 30000,
			emiAmount: null,
			emiDueDay: null
		});

		const breakdown = await computeNetWorth(key);
		expect(breakdown.cash.subtotal).toBe(100000);
		expect(breakdown.investments.subtotal).toBe(60000);
		expect(breakdown.totalAssets).toBe(160000);
		expect(breakdown.totalLiabilities).toBe(30000);
		expect(breakdown.netWorth).toBe(130000);
	});

	it('falls back to cost basis for a holding with no recorded valuation yet', async () => {
		await InvestmentHoldingRepository.create(key, {
			name: 'Gold',
			type: 'gold',
			costBasis: 20000
		});
		const breakdown = await computeNetWorth(key);
		expect(breakdown.investments.subtotal).toBe(20000);
	});

	it('records and lists net worth history sorted oldest to newest', async () => {
		await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 10000,
			creditLimit: null,
			billingCycleDay: null
		});
		await recordNetWorthSnapshot(key, '2026-02-01');
		await recordNetWorthSnapshot(key, '2026-01-01');

		const history = await netWorthHistory(key);
		expect(history.map((s) => s.date)).toEqual(['2026-01-01', '2026-02-01']);
		expect(history[0].netWorth).toBe(10000);
	});

	// Feature 010, FR-014/SC-006: open lending/borrowing balances count as a receivable/payable
	// so cash moving in/out for a loan doesn't distort net worth (quickstart.md Scenario 8).
	it('nets an open "lent" loan back in as a receivable, leaving net worth unchanged', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Cash',
			type: 'cash',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const before = await computeNetWorth(key);

		const person = await PersonRepository.create(key, { name: 'Asha' });
		await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 20000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});

		const after = await computeNetWorth(key);
		expect(after.cash.subtotal).toBe(before.cash.subtotal - 20000);
		expect(after.totalAssets).toBe(before.totalAssets);
		expect(after.netWorth).toBe(before.netWorth);
	});

	it('nets an open "borrowed" loan back out as a payable, leaving net worth unchanged', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Cash',
			type: 'cash',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const before = await computeNetWorth(key);

		const person = await PersonRepository.create(key, { name: 'Rohit' });
		await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'borrowed',
			principalAmount: 15000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});

		const after = await computeNetWorth(key);
		expect(after.cash.subtotal).toBe(before.cash.subtotal + 15000);
		expect(after.totalLiabilities).toBe(before.totalLiabilities + 15000);
		expect(after.netWorth).toBe(before.netWorth);
	});

	it('writing off a lent loan decreases net worth by the forgiven amount', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Cash',
			type: 'cash',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const person = await PersonRepository.create(key, { name: 'Meera' });
		const loan = await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 5000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});
		const beforeWriteOff = await computeNetWorth(key);

		await PersonLoanRepository.writeOff(key, loan.id);
		const afterWriteOff = await computeNetWorth(key);
		expect(afterWriteOff.netWorth).toBe(beforeWriteOff.netWorth - 5000);
	});

	// spec 016, FR-016/017/019/020: units + weighted-average price tracking on purchase/sale.
	describe('recordPurchase / recordSale (spec 016)', () => {
		it('sets units/avgPrice/costBasis from the first recorded purchase', async () => {
			const holding = await InvestmentHoldingRepository.create(key, {
				name: 'BEL',
				type: 'stock',
				costBasis: 0
			});

			const updated = await recordPurchase(key, holding.id, { units: 10, price: 2780 });
			expect(updated.units).toBe(10);
			expect(updated.avgPrice).toBe(2780);
			expect(updated.costBasis).toBe(27800);
		});

		it('recalculates a unit-weighted average price across two purchases', async () => {
			const holding = await InvestmentHoldingRepository.create(key, {
				name: 'COALINDIA',
				type: 'stock',
				costBasis: 0,
				units: 100,
				avgPrice: 400
			});

			// (100 * 400 + 50 * 700) / 150 = (40000 + 35000) / 150 = 500
			const updated = await recordPurchase(key, holding.id, { units: 50, price: 700 });
			expect(updated.units).toBe(150);
			expect(updated.avgPrice).toBe(500);
			expect(updated.costBasis).toBe(75000);
		});

		it('rejects a purchase with non-positive units or price', async () => {
			const holding = await InvestmentHoldingRepository.create(key, {
				name: 'ETERNAL',
				type: 'stock',
				costBasis: 0
			});
			await expect(recordPurchase(key, holding.id, { units: 0, price: 100 })).rejects.toThrow();
			await expect(recordPurchase(key, holding.id, { units: 10, price: 0 })).rejects.toThrow();
		});

		it('reduces units on a sale while leaving average price unchanged', async () => {
			const holding = await InvestmentHoldingRepository.create(key, {
				name: 'BEL',
				type: 'stock',
				costBasis: 27800,
				units: 10,
				avgPrice: 2780
			});

			const updated = await recordSale(key, holding.id, { units: 4 });
			expect(updated.units).toBe(6);
			expect(updated.avgPrice).toBe(2780);
			expect(updated.costBasis).toBe(16680);
		});

		it('rejects a sale that would take units below zero', async () => {
			const holding = await InvestmentHoldingRepository.create(key, {
				name: 'BEL',
				type: 'stock',
				costBasis: 27800,
				units: 10,
				avgPrice: 2780
			});

			await expect(recordSale(key, holding.id, { units: 11 })).rejects.toThrow();
			const unchanged = await InvestmentHoldingRepository.getById(key, holding.id);
			expect(unchanged?.units).toBe(10);
		});

		it('rejects any sale against a holding with no units yet', async () => {
			const holding = await InvestmentHoldingRepository.create(key, {
				name: 'Legacy Gold',
				type: 'other',
				costBasis: 20000
			});
			await expect(recordSale(key, holding.id, { units: 1 })).rejects.toThrow();
		});
	});

	// spec 017, FR-005/FR-006/FR-007/SC-002: net worth as labeled, drillable categories that sum
	// exactly to the total.
	describe('computeNetWorth category breakdown', () => {
		it('places each kind of balance in its own category, summing exactly to the total', async () => {
			const bank = await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 100000,
				creditLimit: null,
				billingCycleDay: null
			});
			const card = await AccountRepository.create(key, {
				name: 'HDFC Card',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: 100000,
				billingCycleDay: null
			});
			await AccountRepository.setBalance(key, card.id, -35000);

			const holding = await InvestmentHoldingRepository.create(key, {
				name: 'Index Fund',
				type: 'mutual fund',
				costBasis: 50000
			});
			await InvestmentValuationRepository.create(key, {
				holdingId: holding.id,
				date: '2026-03-01',
				value: 60000
			});

			await LiabilityRepository.create(key, {
				name: 'Car Loan',
				type: 'loan',
				outstandingBalance: 30000,
				emiAmount: null,
				emiDueDay: null
			});
			await LiabilityRepository.create(key, {
				name: 'Amex Card',
				type: 'credit_card',
				outstandingBalance: 5000,
				emiAmount: null,
				emiDueDay: null
			});

			const breakdown = await computeNetWorth(key);
			expect(breakdown.cash.subtotal).toBe(bank.currentBalance);
			expect(breakdown.creditCardDebt.subtotal).toBe(35000 + 5000); // account used + unlinked liability
			expect(breakdown.investments.subtotal).toBe(60000);
			expect(breakdown.otherLiabilities.subtotal).toBe(30000);
			expect(breakdown.loansLent.subtotal).toBe(0);
			expect(breakdown.loansBorrowed.subtotal).toBe(0);

			const sumOfSubtotals =
				breakdown.cash.subtotal +
				breakdown.investments.subtotal +
				breakdown.loansLent.subtotal -
				(breakdown.creditCardDebt.subtotal +
					breakdown.loansBorrowed.subtotal +
					breakdown.otherLiabilities.subtotal);
			expect(sumOfSubtotals).toBe(breakdown.netWorth);
			expect(breakdown.totalAssets - breakdown.totalLiabilities).toBe(breakdown.netWorth);
		});

		it('excludes a linked credit_card Liability from creditCardDebt (FR-007/FR-009 single source of truth)', async () => {
			const card = await AccountRepository.create(key, {
				name: 'HDFC Card',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: 100000,
				billingCycleDay: null
			});
			await AccountRepository.setBalance(key, card.id, -35000);
			const liability = await LiabilityRepository.create(key, {
				name: 'HDFC Card (manual)',
				type: 'credit_card',
				outstandingBalance: 35000,
				emiAmount: null,
				emiDueDay: null
			});

			const before = await computeNetWorth(key);
			expect(before.creditCardDebt.subtotal).toBe(70000); // both count independently

			await linkLiabilityToAccount(key, liability.id, card.id);
			const after = await computeNetWorth(key);
			expect(after.creditCardDebt.subtotal).toBe(35000); // only the linked Account counts
			expect(after.creditCardDebt.items).toHaveLength(1);
			expect(after.creditCardDebt.items[0].source).toBe('account');
		});
	});

	// spec 017, FR-008/FR-010: detect a manual debt entry that likely duplicates a tracked card.
	describe('findLikelyDuplicateAccounts', () => {
		it('matches by case-insensitive name containment', async () => {
			const card = await AccountRepository.create(key, {
				name: 'HDFC Regalia',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			const matches = findLikelyDuplicateAccounts(
				{ name: 'hdfc regalia card', type: 'credit_card' },
				[card]
			);
			expect(matches.map((a) => a.id)).toEqual([card.id]);
		});

		it('matches by nickname and by last-4 substring', async () => {
			const card = await AccountRepository.create(key, {
				name: 'Visa Signature',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			const withNickname = await AccountRepository.update(key, card.id, {
				cardNickname: 'Travel Card',
				cardLast4: '4321'
			});

			expect(
				findLikelyDuplicateAccounts({ name: 'My Travel Card debt', type: 'credit_card' }, [
					withNickname
				]).map((a) => a.id)
			).toEqual([card.id]);
			expect(
				findLikelyDuplicateAccounts({ name: 'Card ending 4321', type: 'credit_card' }, [
					withNickname
				]).map((a) => a.id)
			).toEqual([card.id]);
		});

		it('returns no matches for a dissimilar name', async () => {
			const card = await AccountRepository.create(key, {
				name: 'HDFC Regalia',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			expect(
				findLikelyDuplicateAccounts({ name: 'Axis Magnus', type: 'credit_card' }, [card])
			).toEqual([]);
		});

		it('short-circuits to no matches for a non-credit_card liability', async () => {
			const card = await AccountRepository.create(key, {
				name: 'Personal Loan',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			expect(findLikelyDuplicateAccounts({ name: 'Personal Loan', type: 'loan' }, [card])).toEqual(
				[]
			);
		});
	});

	describe('linkLiabilityToAccount / dismissDuplicateWarning', () => {
		it('rejects linking to an account that is not a credit_card', async () => {
			const bank = await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			const liability = await LiabilityRepository.create(key, {
				name: 'Some Card',
				type: 'credit_card',
				outstandingBalance: 1000,
				emiAmount: null,
				emiDueDay: null
			});
			await expect(linkLiabilityToAccount(key, liability.id, bank.id)).rejects.toThrow();
		});

		it('dismissDuplicateWarning sets the flag without changing net worth counting', async () => {
			const card = await AccountRepository.create(key, {
				name: 'HDFC Card',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			await AccountRepository.setBalance(key, card.id, -1000);
			const liability = await LiabilityRepository.create(key, {
				name: 'Different Card',
				type: 'credit_card',
				outstandingBalance: 2000,
				emiAmount: null,
				emiDueDay: null
			});

			const dismissed = await dismissDuplicateWarning(key, liability.id);
			expect(dismissed.duplicateWarningDismissed).toBe(true);

			const breakdown = await computeNetWorth(key);
			expect(breakdown.creditCardDebt.subtotal).toBe(3000); // still counted independently
		});
	});

	// spec 017, FR-002/FR-003/FR-004: used/available/utilization for a credit card account.
	describe('computeCardUtilization', () => {
		it('reports only the amount used, with everything else null, when no limit is set', () => {
			const result = computeCardUtilization({ currentBalance: -35000, creditLimit: null });
			expect(result).toEqual({
				used: 35000,
				available: null,
				utilizationPercent: null,
				isOverLimit: false,
				isHighUtilization: false
			});
		});

		it('computes used/available/utilization for normal spend within the limit', () => {
			const result = computeCardUtilization({ currentBalance: -35000, creditLimit: 100000 });
			expect(result.used).toBe(35000);
			expect(result.available).toBe(65000);
			expect(result.utilizationPercent).toBe(35);
			expect(result.isOverLimit).toBe(false);
			expect(result.isHighUtilization).toBe(false);
		});

		it('flags high utilization at or above the threshold', () => {
			const atThreshold = computeCardUtilization({ currentBalance: -90000, creditLimit: 100000 });
			expect(atThreshold.utilizationPercent).toBe(HIGH_UTILIZATION_THRESHOLD_PERCENT);
			expect(atThreshold.isHighUtilization).toBe(true);
			expect(atThreshold.isOverLimit).toBe(false);

			const belowThreshold = computeCardUtilization({
				currentBalance: -89000,
				creditLimit: 100000
			});
			expect(belowThreshold.isHighUtilization).toBe(false);
		});

		it('flags over-limit when used exceeds the limit, without going negative or blocking', () => {
			const result = computeCardUtilization({ currentBalance: -150000, creditLimit: 100000 });
			expect(result.used).toBe(150000);
			expect(result.available).toBe(0);
			expect(result.utilizationPercent).toBe(150);
			expect(result.isOverLimit).toBe(true);
			expect(result.isHighUtilization).toBe(true);
		});

		it('clamps used to 0 (never negative) when the balance is positive from an overpayment/refund', () => {
			const result = computeCardUtilization({ currentBalance: 500, creditLimit: 100000 });
			expect(result.used).toBe(0);
			expect(result.available).toBe(100000);
			expect(result.utilizationPercent).toBe(0);
			expect(result.isOverLimit).toBe(false);
			expect(result.isHighUtilization).toBe(false);
		});
	});

	// spec 017, FR-016/FR-017/FR-018: portfolio-level aggregate totals, broken down by type.
	describe('computePortfolioSummary', () => {
		it('sums total current value, total invested, and gain/loss across holdings', () => {
			const holdings = [
				{ id: 'h1', name: 'Index Fund', type: 'mutual_fund' as const, costBasis: 50000 },
				{ id: 'h2', name: 'Gold', type: 'other' as const, costBasis: 20000 }
			];
			const values = new Map([
				['h1', { value: 60000, isEstimate: false }],
				['h2', { value: 20000, isEstimate: true }]
			]);

			const summary = computePortfolioSummary(holdings, values);
			expect(summary.totalInvested).toBe(70000);
			expect(summary.totalCurrentValue).toBe(80000);
			expect(summary.totalGainLoss).toBe(10000);
			// 10000 / 70000 = 14.2857...% -> rounded to 14.29
			expect(summary.totalGainLossPercent).toBe(14.29);
		});

		it('breaks totals down by investment type, flagging a type with any estimated holding', () => {
			const holdings = [
				{ id: 'h1', name: 'BEL', type: 'stock' as const, costBasis: 10000 },
				{ id: 'h2', name: 'COALINDIA', type: 'stock' as const, costBasis: 5000 },
				{ id: 'h3', name: 'Gold', type: 'other' as const, costBasis: 20000 }
			];
			const values = new Map([
				['h1', { value: 12000, isEstimate: false }],
				['h2', { value: 5000, isEstimate: false }],
				['h3', { value: 20000, isEstimate: true }]
			]);

			const summary = computePortfolioSummary(holdings, values);
			expect(summary.byType.stock?.currentValue).toBe(17000);
			expect(summary.byType.stock?.invested).toBe(15000);
			expect(summary.byType.stock?.hasEstimatedValue).toBe(false);
			expect(summary.byType.other?.hasEstimatedValue).toBe(true);
		});

		it('reports a null gain/loss percent when nothing is invested yet', () => {
			const summary = computePortfolioSummary([], new Map());
			expect(summary.totalInvested).toBe(0);
			expect(summary.totalGainLossPercent).toBeNull();
		});
	});
});
