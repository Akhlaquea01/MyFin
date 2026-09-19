import { TransactionRepository } from '../../data/dexie/transactionRepository';
import { MerchantRepository } from '../../data/dexie/merchantRepository';
import { normalizeMerchantText } from '../parser/merchantResolver';
import type { Transaction } from '../entities';

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionCadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/** [minDays, targetDays, maxDays] per recognized cadence bucket (FR-001, spec Edge Cases:
 *  a bucket only matches within this tolerance window, never an exact day count). */
const CADENCE_WINDOWS: Record<SubscriptionCadence, [number, number, number]> = {
	weekly: [5, 7, 10],
	monthly: [24, 30, 36],
	quarterly: [80, 91, 100],
	yearly: [340, 365, 390]
};

/** Amount tolerance band (FR: variable-rate bills like taxes/FX must still be detected). */
const DEFAULT_TOLERANCE_RATIO = 0.05;

export interface DetectedSubscription {
	/** The grouping key: a real Merchant.id, or a synthetic `text:<normalized>` key when no
	 *  merchant was resolved on any transaction in the group. */
	merchantId: string;
	merchantName: string;
	cadence: SubscriptionCadence;
	averageAmountMinor: number;
	monthlyCostMinor: number;
	lastChargedDate: string;
	chargeCount: number;
	isLapsed: boolean;
	dismissed: boolean;
}

function daysBetween(fromISO: string, toISO: string): number {
	return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / DAY_MS);
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function classifyCadence(medianDeltaDays: number): SubscriptionCadence | null {
	for (const [cadence, [min, , max]] of Object.entries(CADENCE_WINDOWS) as [
		SubscriptionCadence,
		[number, number, number]
	][]) {
		if (medianDeltaDays >= min && medianDeltaDays <= max) return cadence;
	}
	return null;
}

/** Normalizes any cadence's average charge to a monthly-equivalent figure. */
function toMonthlyCost(averageAmountMinor: number, cadence: SubscriptionCadence): number {
	switch (cadence) {
		case 'weekly':
			return Math.round((averageAmountMinor * 52) / 12);
		case 'monthly':
			return averageAmountMinor;
		case 'quarterly':
			return Math.round(averageAmountMinor / 3);
		case 'yearly':
			return Math.round(averageAmountMinor / 12);
	}
}

function groupKey(tx: Transaction): string | null {
	if (tx.merchantId) return tx.merchantId;
	const normalized = tx.notes ? normalizeMerchantText(tx.notes) : null;
	return normalized ? `text:${normalized}` : null;
}

/**
 * Detects merchants with a repeating amount/interval charge pattern, entirely from existing
 * transaction history — no manual recurring-rule setup required (FR-001–FR-004,
 * contracts/subscription-detection.md). Fetches its own bounded window of transactions (trailing
 * ~13 months, enough to see 2+ occurrences of a yearly charge) narrowed on the indexed `date`
 * column before decrypting, matching this codebase's established narrow-then-decrypt pattern
 * (see budgetEngine.recalcActualAmount).
 */
export async function detectSubscriptions(
	key: CryptoKey,
	options: { toleranceRatio?: number; asOf?: Date } = {}
): Promise<DetectedSubscription[]> {
	const toleranceRatio = options.toleranceRatio ?? DEFAULT_TOLERANCE_RATIO;
	const asOf = options.asOf ?? new Date();
	const dateFrom = new Date(asOf.getTime() - 400 * DAY_MS).toISOString().slice(0, 10);

	const [transactions, merchants] = await Promise.all([
		TransactionRepository.search(key, { dateFrom }),
		MerchantRepository.list(key)
	]);
	const merchantById = new Map(merchants.map((m) => [m.id, m]));

	const groups = new Map<string, Transaction[]>();
	for (const tx of transactions) {
		// Only expenses represent a "charge" — income/transfer transactions are never subscriptions.
		if (tx.type !== 'expense' || tx.transferPairId) continue;
		const gKey = groupKey(tx);
		if (!gKey) continue;
		const list = groups.get(gKey) ?? [];
		list.push(tx);
		groups.set(gKey, list);
	}

	const results: DetectedSubscription[] = [];
	for (const [groupId, group] of groups) {
		if (group.length < 2) continue;

		const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
		const amounts = sorted.map((tx) => Math.abs(tx.amount));
		const meanAmount = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
		const withinTolerance = amounts.every(
			(a) => Math.abs(a - meanAmount) <= meanAmount * toleranceRatio
		);
		if (!withinTolerance) continue;

		const deltas: number[] = [];
		for (let i = 1; i < sorted.length; i++) {
			deltas.push(daysBetween(sorted[i - 1].date, sorted[i].date));
		}
		const cadence = classifyCadence(median(deltas));
		if (!cadence) continue;

		const merchant = groupId.startsWith('text:') ? null : merchantById.get(groupId);
		if (merchant?.subscriptionDismissed) continue;

		const lastChargedDate = sorted[sorted.length - 1].date;
		const [, , maxWindow] = CADENCE_WINDOWS[cadence];
		const isLapsed = daysBetween(lastChargedDate, asOf.toISOString().slice(0, 10)) > maxWindow;
		const averageAmountMinor = Math.round(meanAmount);

		results.push({
			merchantId: groupId,
			merchantName: merchant?.name ?? groupId.replace(/^text:/, ''),
			cadence,
			averageAmountMinor,
			monthlyCostMinor: toMonthlyCost(averageAmountMinor, cadence),
			lastChargedDate,
			chargeCount: sorted.length,
			isLapsed,
			dismissed: false
		});
	}

	return results.sort((a, b) => b.monthlyCostMinor - a.monthlyCostMinor);
}
