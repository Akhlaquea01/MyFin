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
import type { NetWorthSnapshot } from '../../domain/entities';

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
