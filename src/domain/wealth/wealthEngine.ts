import { AccountRepository } from '../../data/dexie/accountRepository';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository,
	LiabilityRepository,
	NetWorthSnapshotRepository
} from '../../data/dexie/wealthRepository';
import type { NetWorthSnapshot } from '../../domain/entities';

export interface NetWorthBreakdown {
	cashBalance: number;
	investmentValue: number;
	totalAssets: number;
	totalLiabilities: number;
	netWorth: number;
}

/** Net worth = (cash accounts + investments) − liabilities (FR-034). */
export async function computeNetWorth(key: CryptoKey): Promise<NetWorthBreakdown> {
	const [accounts, holdings, liabilities] = await Promise.all([
		AccountRepository.list(key, false),
		InvestmentHoldingRepository.list(key),
		LiabilityRepository.list(key)
	]);

	const cashBalance = accounts.reduce((sum, a) => sum + a.currentBalance, 0);

	const holdingValues = await Promise.all(
		holdings.map((h) => InvestmentValuationRepository.latestValue(key, h))
	);
	const investmentValue = holdingValues.reduce((sum, v) => sum + v, 0);

	const totalLiabilities = liabilities.reduce((sum, l) => sum + l.outstandingBalance, 0);
	const totalAssets = cashBalance + investmentValue;

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
