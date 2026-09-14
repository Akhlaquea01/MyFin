import { AccountRepository } from '../../data/dexie/accountRepository';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository,
	LiabilityRepository,
	NetWorthSnapshotRepository
} from '../../data/dexie/wealthRepository';
import {
	PersonLoanRepository,
	LoanRepaymentRepository
} from '../../data/dexie/personLoanRepository';
import { computePendingBalance, computeOpenLoanTotals } from '../personLoans/loanProgress';
import type { InvestmentHolding, NetWorthSnapshot } from '../../domain/entities';

export interface NetWorthBreakdown {
	cashBalance: number;
	investmentValue: number;
	totalAssets: number;
	totalLiabilities: number;
	netWorth: number;
}

/**
 * Net worth = (cash accounts + investments + open amounts lent) − (liabilities + open amounts
 * borrowed) (FR-034; open-loan terms per spec 010 FR-014, research.md §5). Money lent out
 * already left the relevant account's `currentBalance`, so without adding it back as a
 * receivable here, net worth would understate the user's true wealth by that amount; money
 * borrowed already arrived in `currentBalance`, so without counting it as a payable here, net
 * worth would overstate it.
 */
export async function computeNetWorth(key: CryptoKey): Promise<NetWorthBreakdown> {
	const [accounts, holdings, liabilities, openLoans] = await Promise.all([
		AccountRepository.list(key, false),
		InvestmentHoldingRepository.list(key),
		LiabilityRepository.list(key),
		PersonLoanRepository.listAllOpen(key)
	]);

	const cashBalance = accounts.reduce((sum, a) => sum + a.currentBalance, 0);

	const holdingValues = await Promise.all(
		holdings.map((h) => InvestmentValuationRepository.latestValue(key, h))
	);
	const investmentValue = holdingValues.reduce((sum, v) => sum + v, 0);

	const loansWithBalance = await Promise.all(
		openLoans.map(async (loan) => {
			const repayments = await LoanRepaymentRepository.listForLoan(key, loan.id);
			return {
				direction: loan.direction,
				pendingBalance: computePendingBalance({
					principalAmount: loan.principalAmount,
					writeOffAmount: loan.writeOffAmount,
					repayments
				})
			};
		})
	);
	const { totalLent, totalBorrowed } = computeOpenLoanTotals({ loans: loansWithBalance });

	const totalLiabilities =
		liabilities.reduce((sum, l) => sum + l.outstandingBalance, 0) + totalBorrowed;
	const totalAssets = cashBalance + investmentValue + totalLent;

	return {
		cashBalance,
		investmentValue,
		totalAssets,
		totalLiabilities,
		netWorth: totalAssets - totalLiabilities
	};
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
