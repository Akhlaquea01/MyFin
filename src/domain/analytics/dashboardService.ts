import { AccountRepository } from '../../data/dexie/accountRepository';
import { TransactionRepository } from '../../data/dexie/transactionRepository';
import { computeNetWorth } from '../wealth/wealthEngine';
import type { Account, Transaction } from '../../domain/entities';

export interface DashboardSummary {
	totalBalance: number;
	netWorth: number;
	unreviewedCount: number;
	recentTransactions: Transaction[];
	accounts: Account[];
	/** Cumulative running balance over the most recent transactions, oldest to newest. */
	balanceTrend: number[];
}

const RECENT_TRANSACTIONS_LIMIT = 5;
const TREND_POINTS = 14;

/**
 * Aggregates the dashboard's headline figures directly from the ledger (User Story 3).
 * Net worth mirrors the full breakdown on the Net Worth page (spec 017's `computeNetWorth`) —
 * cash, credit card debt, investments, and loans lent/borrowed — so the two pages never disagree.
 */
export async function getDashboardSummary(key: CryptoKey): Promise<DashboardSummary> {
	// Bounded queries only. This previously decrypted the entire ledger to show five rows and
	// a 14-point sparkline, and decrypted every unreviewed row just to read `.length` — on a
	// 10k+ transaction ledger (SC-008) that was the single slowest thing in the app.
	const [accounts, unreviewedCount, recentTransactions, netWorthBreakdown] = await Promise.all([
		AccountRepository.list(key, false),
		TransactionRepository.countUnreviewed(),
		TransactionRepository.listRecent(key, Math.max(RECENT_TRANSACTIONS_LIMIT, TREND_POINTS)),
		computeNetWorth(key)
	]);

	const totalBalance = accounts.reduce((sum, a) => sum + a.currentBalance, 0);

	// recentTransactions is sorted newest-first; walk backwards from the current total to
	// build an oldest-to-newest cumulative trend over the last TREND_POINTS transactions.
	const trendSource = recentTransactions.slice(0, TREND_POINTS);
	const balanceTrend: number[] = [];
	let runningBalance = totalBalance;
	for (const tx of trendSource) {
		balanceTrend.unshift(runningBalance);
		runningBalance -= tx.amount;
	}

	return {
		totalBalance,
		netWorth: netWorthBreakdown.netWorth,
		unreviewedCount,
		recentTransactions: recentTransactions.slice(0, RECENT_TRANSACTIONS_LIMIT),
		accounts,
		balanceTrend
	};
}
