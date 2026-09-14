import { AccountRepository } from '../../data/dexie/accountRepository';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository,
	LiabilityRepository,
	NetWorthSnapshotRepository
} from '../../data/dexie/wealthRepository';
import {
	PersonRepository,
	PersonLoanRepository,
	LoanRepaymentRepository
} from '../../data/dexie/personLoanRepository';
import { computePendingBalance } from '../personLoans/loanProgress';
import type {
	Account,
	InvestmentHolding,
	InvestmentType,
	Liability,
	NetWorthSnapshot
} from '../../domain/entities';

/** FR-003 / spec Assumptions: a commonly-used default, revisitable without a data migration
 *  since it's never persisted — only ever computed at render time. */
export const HIGH_UTILIZATION_THRESHOLD_PERCENT = 90;

export interface CardUtilization {
	used: number;
	available: number | null;
	utilizationPercent: number | null;
	isOverLimit: boolean;
	isHighUtilization: boolean;
}

/**
 * Used/available/utilization for a credit card account (FR-002/FR-003/FR-004). `used` is never
 * negative — a temporarily positive `currentBalance` (overpayment/refund) clamps to 0 used /
 * 100% available rather than displaying a negative amount (spec Edge Cases).
 */
export function computeCardUtilization(account: {
	currentBalance: number;
	creditLimit: number | null;
}): CardUtilization {
	const used = Math.max(0, -account.currentBalance);
	if (account.creditLimit === null || account.creditLimit <= 0) {
		return {
			used,
			available: null,
			utilizationPercent: null,
			isOverLimit: false,
			isHighUtilization: false
		};
	}
	const available = Math.max(0, account.creditLimit - used);
	const utilizationPercent = Math.round((used / account.creditLimit) * 100);
	return {
		used,
		available,
		utilizationPercent,
		isOverLimit: used > account.creditLimit,
		isHighUtilization: utilizationPercent >= HIGH_UTILIZATION_THRESHOLD_PERCENT
	};
}

export type NetWorthItemSource = 'account' | 'liability' | 'investment' | 'personLoan';

export interface NetWorthCategoryItem {
	id: string;
	name: string;
	amount: number;
	source: NetWorthItemSource;
}

export interface NetWorthCategory {
	subtotal: number;
	items: NetWorthCategoryItem[];
}

function emptyCategory(): NetWorthCategory {
	return { subtotal: 0, items: [] };
}

function addItem(category: NetWorthCategory, item: NetWorthCategoryItem): void {
	category.items.push(item);
	category.subtotal += item.amount;
}

export interface NetWorthBreakdown {
	cash: NetWorthCategory;
	creditCardDebt: NetWorthCategory;
	investments: NetWorthCategory;
	loansLent: NetWorthCategory;
	loansBorrowed: NetWorthCategory;
	otherLiabilities: NetWorthCategory;
	totalAssets: number;
	totalLiabilities: number;
	netWorth: number;
}

const CASH_ACCOUNT_TYPES = new Set(['bank', 'cash', 'wallet']);

/**
 * Net worth broken into labeled, drillable categories (FR-005/FR-006, spec 017) that sum exactly
 * to the total (SC-002). A `credit_card` Account's used amount is its own category
 * (`creditCardDebt`), separate from `cash` — previously every account type, including credit
 * cards, was folded into one undifferentiated `cashBalance` figure (research.md §2). A
 * `Liability` of type `credit_card` that has been linked to a transaction-linked Account
 * (`linkedAccountId` set) is excluded here — that Account is the single source of truth for its
 * debt (FR-007/FR-009); an unlinked one still counts independently (FR-010).
 */
export async function computeNetWorth(key: CryptoKey): Promise<NetWorthBreakdown> {
	const [accounts, holdings, liabilities, openLoans, people] = await Promise.all([
		AccountRepository.list(key, false),
		InvestmentHoldingRepository.list(key),
		LiabilityRepository.list(key),
		PersonLoanRepository.listAllOpen(key),
		PersonRepository.list(key)
	]);
	const personNameById = new Map(people.map((p) => [p.id, p.name]));

	const cash = emptyCategory();
	const creditCardDebt = emptyCategory();
	for (const account of accounts) {
		if (CASH_ACCOUNT_TYPES.has(account.type)) {
			addItem(cash, {
				id: account.id,
				name: account.name,
				amount: account.currentBalance,
				source: 'account'
			});
		} else if (account.type === 'credit_card') {
			const { used } = computeCardUtilization(account);
			addItem(creditCardDebt, {
				id: account.id,
				name: account.name,
				amount: used,
				source: 'account'
			});
		}
	}

	const otherLiabilities = emptyCategory();
	for (const liability of liabilities) {
		if (liability.type === 'credit_card') {
			if (liability.linkedAccountId) continue; // FR-007/FR-009: the linked Account already counted it
			addItem(creditCardDebt, {
				id: liability.id,
				name: liability.name,
				amount: liability.outstandingBalance,
				source: 'liability'
			});
		} else {
			addItem(otherLiabilities, {
				id: liability.id,
				name: liability.name,
				amount: liability.outstandingBalance,
				source: 'liability'
			});
		}
	}

	const investments = emptyCategory();
	for (const holding of holdings) {
		const value = await InvestmentValuationRepository.latestValue(key, holding);
		addItem(investments, {
			id: holding.id,
			name: holding.name,
			amount: value,
			source: 'investment'
		});
	}

	const loansWithBalance = await Promise.all(
		openLoans.map(async (loan) => {
			const repayments = await LoanRepaymentRepository.listForLoan(key, loan.id);
			const pendingBalance = computePendingBalance({
				principalAmount: loan.principalAmount,
				writeOffAmount: loan.writeOffAmount,
				repayments
			});
			return { loan, pendingBalance };
		})
	);
	const loansLent = emptyCategory();
	const loansBorrowed = emptyCategory();
	for (const { loan, pendingBalance } of loansWithBalance) {
		if (pendingBalance <= 0) continue; // computeOpenLoanTotals' own semantics: fully settled loans don't count
		const item: NetWorthCategoryItem = {
			id: loan.id,
			name: personNameById.get(loan.personId) ?? 'Unknown',
			amount: pendingBalance,
			source: 'personLoan'
		};
		addItem(loan.direction === 'lent' ? loansLent : loansBorrowed, item);
	}

	const totalAssets = cash.subtotal + investments.subtotal + loansLent.subtotal;
	const totalLiabilities =
		creditCardDebt.subtotal + loansBorrowed.subtotal + otherLiabilities.subtotal;

	return {
		cash,
		creditCardDebt,
		investments,
		loansLent,
		loansBorrowed,
		otherLiabilities,
		totalAssets,
		totalLiabilities,
		netWorth: totalAssets - totalLiabilities
	};
}

/**
 * Finds credit_card Accounts that likely represent the same real card as a manually-entered
 * Liability, by name/nickname/last-4 matching (FR-008). Heuristic, not a guarantee (spec
 * Assumptions) — a false negative is acceptable, a detection must always be surfaced, never
 * silently auto-merged (plan.md Constraints).
 */
export function findLikelyDuplicateAccounts(
	liability: Pick<Liability, 'name' | 'type'>,
	accounts: Account[]
): Account[] {
	if (liability.type !== 'credit_card') return [];
	const normalizedLiabilityName = liability.name.trim().toLowerCase();
	return accounts.filter((account) => {
		if (account.type !== 'credit_card') return false;
		const normalizedAccountName = account.name.trim().toLowerCase();
		if (
			normalizedLiabilityName.includes(normalizedAccountName) ||
			normalizedAccountName.includes(normalizedLiabilityName)
		) {
			return true;
		}
		if (account.cardNickname) {
			const normalizedNickname = account.cardNickname.trim().toLowerCase();
			if (
				normalizedNickname &&
				(normalizedLiabilityName.includes(normalizedNickname) ||
					normalizedNickname.includes(normalizedLiabilityName))
			) {
				return true;
			}
		}
		if (account.cardLast4 && liability.name.includes(account.cardLast4)) {
			return true;
		}
		return false;
	});
}

/**
 * Merges a manually-entered Liability into an existing transaction-linked credit_card Account
 * (FR-009) — the Liability row is kept (for its own history / the Debt Payoff Planner,
 * research.md §3), only `linkedAccountId` is set so `computeNetWorth` stops double-counting it.
 */
export async function linkLiabilityToAccount(
	key: CryptoKey,
	liabilityId: string,
	accountId: string
): Promise<Liability> {
	const account = await AccountRepository.getById(key, accountId);
	if (!account || account.type !== 'credit_card') {
		throw new Error('Can only link a liability to a credit card account.');
	}
	return LiabilityRepository.update(key, liabilityId, { linkedAccountId: accountId });
}

/** Records that the user confirmed a flagged pair are NOT the same card (FR-010) — the warning
 *  stops reappearing; both continue to count independently (no change to net worth). */
export async function dismissDuplicateWarning(
	key: CryptoKey,
	liabilityId: string
): Promise<Liability> {
	return LiabilityRepository.update(key, liabilityId, { duplicateWarningDismissed: true });
}

/** Records today's net worth as a history point (FR-034's "history over time"). */
export async function recordNetWorthSnapshot(
	key: CryptoKey,
	date: string = new Date().toISOString().slice(0, 10)
): Promise<NetWorthSnapshot> {
	const breakdown = await computeNetWorth(key);
	return NetWorthSnapshotRepository.create(key, {
		date,
		totalAssets: breakdown.totalAssets,
		totalLiabilities: breakdown.totalLiabilities,
		netWorth: breakdown.netWorth
	});
}

export async function netWorthHistory(key: CryptoKey): Promise<NetWorthSnapshot[]> {
	return NetWorthSnapshotRepository.list(key);
}

/**
 * Records a purchase of additional units for an existing holding, recalculating the
 * weighted-average price and cost basis (spec 016, FR-017, contracts/wealth-engine.md).
 */
export async function recordPurchase(
	key: CryptoKey,
	holdingId: string,
	purchase: { units: number; price: number }
): Promise<InvestmentHolding> {
	if (purchase.units <= 0) throw new Error('Units must be positive.');
	if (purchase.price <= 0) throw new Error('Price must be positive.');

	const holding = await InvestmentHoldingRepository.getById(key, holdingId);
	if (!holding) throw new Error('Holding not found.');

	const existingUnits = holding.units ?? 0;
	const existingAvgPrice = holding.avgPrice ?? 0;

	const newUnits = existingUnits + purchase.units;
	const newAvgPrice = Math.round(
		(existingUnits * existingAvgPrice + purchase.units * purchase.price) / newUnits
	);
	const newCostBasis = newUnits * newAvgPrice;

	return InvestmentHoldingRepository.update(key, holdingId, {
		units: newUnits,
		avgPrice: newAvgPrice,
		costBasis: newCostBasis
	});
}

/**
 * Records a sale (decrease) of units for an existing holding. Average price is unchanged;
 * costBasis is recalculated as remaining units × avgPrice (spec 016, FR-019/020,
 * contracts/wealth-engine.md).
 */
export async function recordSale(
	key: CryptoKey,
	holdingId: string,
	sale: { units: number }
): Promise<InvestmentHolding> {
	if (sale.units <= 0) throw new Error('Units must be positive.');

	const holding = await InvestmentHoldingRepository.getById(key, holdingId);
	if (!holding) throw new Error('Holding not found.');

	const existingUnits = holding.units ?? 0;
	if (sale.units > existingUnits) {
		throw new Error('Cannot sell more units than currently held.');
	}

	const newUnits = existingUnits - sale.units;
	const avgPrice = holding.avgPrice ?? 0;
	const newCostBasis = newUnits * avgPrice;

	return InvestmentHoldingRepository.update(key, holdingId, {
		units: newUnits,
		costBasis: newCostBasis
	});
}

export interface PortfolioTypeSummary {
	currentValue: number;
	invested: number;
	gainLoss: number;
	gainLossPercent: number | null;
	hasEstimatedValue: boolean;
}

export interface PortfolioSummary {
	totalCurrentValue: number;
	totalInvested: number;
	totalGainLoss: number;
	totalGainLossPercent: number | null;
	byType: Partial<Record<InvestmentType, PortfolioTypeSummary>>;
}

/** Rounds to 2 decimal places without binary-float drift for a percentage display value —
 *  never used for a stored/persisted monetary amount (Constitution Principle VI still applies
 *  only to those). */
function gainLossPercent(gainLoss: number, invested: number): number | null {
	if (invested === 0) return null;
	return Math.round((gainLoss / invested) * 10000) / 100;
}

/**
 * Portfolio-level aggregate (FR-016/FR-017) computed purely over holdings and valuations the
 * caller already fetched (e.g. `InvestmentsPage`'s existing per-holding `latestValueWithSource`
 * calls) — no repository access of its own, per contracts/wealth-engine.md.
 */
export function computePortfolioSummary(
	holdings: Pick<InvestmentHolding, 'id' | 'name' | 'type' | 'costBasis'>[],
	values: Map<string, { value: number; isEstimate: boolean }>
): PortfolioSummary {
	let totalCurrentValue = 0;
	let totalInvested = 0;
	const byType: Partial<
		Record<InvestmentType, { currentValue: number; invested: number; hasEstimatedValue: boolean }>
	> = {};

	for (const holding of holdings) {
		const { value, isEstimate } = values.get(holding.id) ?? { value: 0, isEstimate: false };
		totalCurrentValue += value;
		totalInvested += holding.costBasis;

		const bucket = (byType[holding.type] ??= {
			currentValue: 0,
			invested: 0,
			hasEstimatedValue: false
		});
		bucket.currentValue += value;
		bucket.invested += holding.costBasis;
		bucket.hasEstimatedValue = bucket.hasEstimatedValue || isEstimate;
	}

	const byTypeSummary: Partial<Record<InvestmentType, PortfolioTypeSummary>> = {};
	for (const [type, bucket] of Object.entries(byType) as [
		InvestmentType,
		(typeof byType)[InvestmentType]
	][]) {
		if (!bucket) continue;
		const gainLoss = bucket.currentValue - bucket.invested;
		byTypeSummary[type] = {
			currentValue: bucket.currentValue,
			invested: bucket.invested,
			gainLoss,
			gainLossPercent: gainLossPercent(gainLoss, bucket.invested),
			hasEstimatedValue: bucket.hasEstimatedValue
		};
	}

	const totalGainLoss = totalCurrentValue - totalInvested;
	return {
		totalCurrentValue,
		totalInvested,
		totalGainLoss,
		totalGainLossPercent: gainLossPercent(totalGainLoss, totalInvested),
		byType: byTypeSummary
	};
}
