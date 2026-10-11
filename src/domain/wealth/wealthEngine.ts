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
import { TransactionEngine } from '../transactions/transactionEngine';
import { todayLocalISO } from '../shared/dateMath';
import { formatMinorUnits } from '../shared/money';
import type {
	Account,
	InvestmentHolding,
	InvestmentType,
	InvestmentValuation,
	Liability,
	LiabilityPayment,
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

/**
 * Records a payment toward a liability (a loan EMI, or a card tracked only as a liability) from one
 * of the user's accounts: ONE action that posts the money leaving the account AND brings the
 * balance owed down by the same amount. Until now a liability was a static number — paying an EMI
 * from the bank left the loan's balance untouched, and the only way to keep it right was to delete
 * and re-add the liability by hand.
 *
 * Net worth is unchanged by a payment (cash and debt fall together), which is exactly why both
 * halves have to move in one step. The ledger entry is an ordinary expense — so cash-flow, the
 * forecast and the financial-health score all see the outflow — linked to the payment record so it
 * cannot be edited or deleted on its own and leave the two disagreeing.
 *
 * A card that is already tracked as an account (`linkedAccountId`) is refused: that account is the
 * single source of truth for its debt, and it is paid with "Pay bill" on the Accounts page.
 */
export async function recordLiabilityPayment(
	key: CryptoKey,
	input: {
		liabilityId: string;
		amount: number;
		date: string;
		accountId: string;
		categoryId?: string | null;
	}
): Promise<{ liability: Liability; payment: LiabilityPayment }> {
	if (input.amount <= 0) throw new Error('Payment amount must be greater than zero.');
	const liability = await LiabilityRepository.getById(key, input.liabilityId);
	if (!liability) throw new Error('Liability not found.');
	if (liability.linkedAccountId) {
		throw new Error(
			'This card is tracked as an account, so pay it with "Pay bill" on the Accounts page.'
		);
	}
	if (input.amount > liability.outstandingBalance) {
		throw new Error(
			`That is more than the ${formatMinorUnits(liability.outstandingBalance)} still owed. Enter the amount actually paid, or at most the balance.`
		);
	}
	const account = await AccountRepository.getById(key, input.accountId);
	if (!account || account.deletedAt !== null) throw new Error('Account not found.');
	if (account.type === 'credit_card') {
		throw new Error('Pay from a bank, cash or wallet account, not from a credit card.');
	}

	const transaction = await TransactionEngine.recordTransaction(
		key,
		{
			accountId: input.accountId,
			date: input.date,
			amount: -input.amount,
			type: 'expense',
			notes: `Payment to ${liability.name}`,
			source: 'manual',
			reviewStatus: 'confirmed'
		},
		input.categoryId ? [{ categoryId: input.categoryId, amount: -input.amount }] : []
	);

	const payment: LiabilityPayment = {
		id: crypto.randomUUID(),
		amount: input.amount,
		date: input.date,
		accountId: input.accountId,
		transactionId: transaction.id
	};
	try {
		const updated = await LiabilityRepository.update(key, liability.id, {
			outstandingBalance: liability.outstandingBalance - input.amount,
			payments: [...(liability.payments ?? []), payment]
		});
		return { liability: updated, payment };
	} catch (err) {
		// Never leave money taken out of the account with the debt unchanged.
		await TransactionEngine.deleteTransaction(key, transaction.id).catch(() => undefined);
		throw err;
	}
}

/**
 * Reverses a payment recorded with `recordLiabilityPayment`: the amount is owed again and the
 * ledger entry moves to Trash, returning the money to the account. The way to correct a payment
 * recorded with the wrong amount, date or account (its ledger entry is deliberately not editable).
 */
export async function undoLiabilityPayment(
	key: CryptoKey,
	liabilityId: string,
	paymentId: string
): Promise<Liability> {
	const liability = await LiabilityRepository.getById(key, liabilityId);
	if (!liability) throw new Error('Liability not found.');
	const payment = liability.payments?.find((p) => p.id === paymentId);
	if (!payment) throw new Error('Payment not found.');

	// Ledger first, then the balance — and put the entry back if the second step fails, so the money
	// and the debt are never left moved by only one half.
	await TransactionEngine.deleteTransaction(key, payment.transactionId);
	let updated: Liability;
	try {
		updated = await LiabilityRepository.update(key, liabilityId, {
			outstandingBalance: liability.outstandingBalance + payment.amount,
			payments: (liability.payments ?? []).filter((p) => p.id !== paymentId)
		});
	} catch (err) {
		await TransactionEngine.restoreTransaction(key, payment.transactionId).catch(() => undefined);
		throw err;
	}
	return updated;
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
	date: string = todayLocalISO()
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
 * What `units` held at `avgPrice` (smallest currency unit per unit) cost. Units may be fractional
 * (0.333 of a fund), so the product is rounded to a whole minor unit — a cost basis is money, and
 * money here is always an integer.
 */
function costBasisFor(units: number, avgPrice: number): number {
	return Math.round(units * avgPrice);
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
	const newCostBasis = costBasisFor(newUnits, newAvgPrice);

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
	const newCostBasis = costBasisFor(newUnits, avgPrice);

	return InvestmentHoldingRepository.update(key, holdingId, {
		units: newUnits,
		costBasis: newCostBasis
	});
}

/** What can be corrected on a holding. A holding tracked in units is corrected through its units and
 *  average price (the cost basis follows); a legacy one that only ever had a cost basis, through that. */
export type HoldingEdit = { name: string; type: InvestmentType } & (
	{ units: number; avgPrice: number } | { costBasis: number }
);

/**
 * Corrects a holding's details as entered — a misspelled name, the wrong type, a units or price typo.
 * It is not how a purchase or sale is recorded (those weight the average price / reduce the units
 * and keep the history coherent); it overwrites the numbers outright.
 */
export async function editHolding(
	key: CryptoKey,
	holdingId: string,
	edit: HoldingEdit
): Promise<InvestmentHolding> {
	const name = edit.name.trim();
	if (!name) throw new Error('Name is required.');
	const holding = await InvestmentHoldingRepository.getById(key, holdingId);
	if (!holding || holding.deletedAt !== null) throw new Error('Holding not found.');

	if ('units' in edit) {
		if (!Number.isFinite(edit.units) || edit.units < 0)
			throw new Error('Units cannot be negative.');
		if (!Number.isInteger(edit.avgPrice) || edit.avgPrice < 0) {
			throw new Error('The average price cannot be negative.');
		}
		return InvestmentHoldingRepository.update(key, holdingId, {
			name,
			type: edit.type,
			units: edit.units,
			avgPrice: edit.avgPrice,
			costBasis: costBasisFor(edit.units, edit.avgPrice)
		});
	}
	if (!Number.isInteger(edit.costBasis) || edit.costBasis < 0) {
		throw new Error('The cost basis cannot be negative.');
	}
	return InvestmentHoldingRepository.update(key, holdingId, {
		name,
		type: edit.type,
		costBasis: edit.costBasis
	});
}

/**
 * Records what a holding is worth on `date`. One value per holding per day: entering it again the
 * same day REPLACES that day's value rather than adding a second one — which is how a mistyped value
 * is corrected, and what keeps "the latest value" unambiguous.
 */
export async function recordValuation(
	key: CryptoKey,
	holdingId: string,
	input: { date: string; value: number }
): Promise<InvestmentValuation> {
	if (!Number.isInteger(input.value) || input.value < 0) {
		throw new Error('The value cannot be negative.');
	}
	const holding = await InvestmentHoldingRepository.getById(key, holdingId);
	if (!holding || holding.deletedAt !== null) throw new Error('Holding not found.');

	const [sameDay, ...extras] = (
		await InvestmentValuationRepository.listForHolding(key, holdingId)
	).filter((valuation) => valuation.date === input.date);
	if (!sameDay) {
		return InvestmentValuationRepository.create(key, {
			holdingId,
			date: input.date,
			value: input.value
		});
	}
	// Older data may already hold several for the day; fold them into the one that counts.
	for (const extra of extras) await InvestmentValuationRepository.delete(extra.id);
	return InvestmentValuationRepository.update(key, sameDay.id, { value: input.value });
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
