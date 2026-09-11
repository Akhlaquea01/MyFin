import { AccountRepository } from '../../data/dexie/accountRepository';
import { TransactionRepository } from '../../data/dexie/transactionRepository';
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
 * Net worth here is cash-only (account balances) until User Story 7 (Wealth & Debt) adds
 * investments/liabilities into the calculation — see wealthEngine.ts once that lands.
 */
export async function getDashboardSummary(key: CryptoKey): Promise<DashboardSummary> {
	// Bounded queries only. This previously decrypted the entire ledger to show five rows and
	// a 14-point sparkline, and decrypted every unreviewed row just to read `.length` — on a
	// 10k+ transaction ledger (SC-008) that was the single slowest thing in the app.
	const [accounts, unreviewedCount, recentTransactions] = await Promise.all([
		AccountRepository.list(key, false),
		TransactionRepository.countUnreviewed(),
		TransactionRepository.listRecent(key, Math.max(RECENT_TRANSACTIONS_LIMIT, TREND_POINTS))
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
		netWorth: totalBalance,
		unreviewedCount,
		recentTransactions: recentTransactions.slice(0, RECENT_TRANSACTIONS_LIMIT),
		accounts,
		balanceTrend
	};
}
