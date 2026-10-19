import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../data/dexie/transactionRepository';
import type { NewRecurringRule } from '../../data/dexie/recurringRepository';
import { MerchantRepository } from '../../data/dexie/merchantRepository';
import { normalizeMerchantText } from '../parser/merchantResolver';
import { looksLikeCardPayment } from '../parser/cardPaymentDetector';
import { parseCapturedMessage } from '../capture/captureParser';
import { originalMessageOf } from '../capture/originalMessage';
import { defaultDayFor, defaultMonthFor } from './recurringDay';
import type { RecurringFrequency, RecurringRule, Transaction } from '../entities';
import { todayLocalISO } from '../shared/dateMath';

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
	/** The most recent charge, exactly: what a tracked rule is created with, so that next month's
	 *  charge matches it to the paisa. */
	lastAmountMinor: number;
	/** Where, and under which category, the latest charge was filed — what Track creates the rule on. */
	accountId: string;
	categoryId: string;
	lastTransactionId: string;
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

/** Normalizes any cadence's charge to a monthly-equivalent figure. */
export function toMonthlyCost(averageAmountMinor: number, cadence: SubscriptionCadence): number {
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
	if (normalized) return `text:${normalized}`;
	// An entry the Android app captured keeps its message in `capture.text` and no notes. When no
	// merchant was resolved at the time (the parser has improved since, or it simply missed), read
	// the name out of the message now rather than leaving every card charge ungrouped.
	if (tx.capture) {
		const merchantText = parseCapturedMessage({
			channel: tx.capture.channel,
			sender: tx.capture.sender,
			body: tx.capture.text,
			receivedAt: tx.capture.receivedAt
		})?.merchantText;
		const fromMessage = merchantText ? normalizeMerchantText(merchantText) : null;
		if (fromMessage) return `text:${fromMessage}`;
	}
	return null;
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
	const dateFrom = todayLocalISO(new Date(asOf.getTime() - 400 * DAY_MS));

	const [transactions, merchants] = await Promise.all([
		TransactionRepository.search(key, { dateFrom }),
		MerchantRepository.list(key)
	]);
	const merchantById = new Map(merchants.map((m) => [m.id, m]));

	const groups = new Map<string, Transaction[]>();
	for (const tx of transactions) {
		// Only expenses represent a "charge" — income/transfer transactions are never subscriptions.
		if (tx.type !== 'expense' || tx.transferPairId) continue;
		// A loan EMI, a monthly SIP or a savings transfer repeats like a subscription but is money the
		// user is putting toward a debt, a goal or an investment, not a service they pay for. Only a
		// bill keeps its place: that is a payment for something.
		if (tx.purpose && tx.purpose.kind !== 'bills') continue;
		// Paying a credit card bill is a movement between the user's own accounts, not a service they
		// subscribe to. When one is still recorded as a plain expense (an imported "CREDIT CARD
		// PAYMENT" line, an SMS), its monthly rhythm made the card bill the biggest "subscription".
		// (originalMessageOf also reads a captured entry's message, which has no notes.)
		if (looksLikeCardPayment(originalMessageOf(tx))) continue;
		const merchantName = tx.merchantId ? merchantById.get(tx.merchantId)?.name : undefined;
		if (looksLikeCardPayment(merchantName)) continue;
		const gKey = groupKey(tx);
		if (!gKey) continue;
		const list = groups.get(gKey) ?? [];
		list.push(tx);
		groups.set(gKey, list);
	}

	const results: DetectedSubscription[] = [];
	const pending: { group: Transaction[]; result: DetectedSubscription }[] = [];
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
		const isLapsed = daysBetween(lastChargedDate, todayLocalISO(asOf)) > maxWindow;
		const averageAmountMinor = Math.round(meanAmount);

		const last = sorted[sorted.length - 1];
		pending.push({
			group: sorted,
			result: {
				merchantId: groupId,
				merchantName: merchant?.name ?? groupId.replace(/^text:/, ''),
				cadence,
				averageAmountMinor,
				lastAmountMinor: Math.abs(last.amount),
				accountId: last.accountId,
				categoryId: UNCATEGORIZED_CATEGORY_ID,
				lastTransactionId: last.id,
				monthlyCostMinor: toMonthlyCost(averageAmountMinor, cadence),
				lastChargedDate,
				chargeCount: sorted.length,
				isLapsed,
				dismissed: false
			}
		});
	}

	// The category of each latest charge, read for the few groups that qualified.
	const splitsByTx =
		pending.length > 0
			? await TransactionRepository.splitsByTransaction(
					key,
					pending.map((p) => p.result.lastTransactionId)
				)
			: new Map();
	for (const { result } of pending) {
		const category = splitsByTx.get(result.lastTransactionId)?.[0]?.categoryId;
		if (category) result.categoryId = category;
		results.push(result);
	}

	return results.sort((a, b) => b.monthlyCostMinor - a.monthlyCostMinor);
}

/** A rule the user already tracks stands for the detected charge: same account, same rhythm, an
 *  amount within the detection tolerance. Quarterly charges can never be tracked (a rule recurs
 *  weekly, monthly or yearly), so they are never hidden by one. */
function isTrackedBy(rule: RecurringRule, subscription: DetectedSubscription): boolean {
	if (rule.amount >= 0 || rule.accountId !== subscription.accountId) return false;
	if (subscription.cadence === 'quarterly' || rule.frequency !== subscription.cadence) return false;
	return (
		Math.abs(Math.abs(rule.amount) - subscription.averageAmountMinor) <=
		subscription.averageAmountMinor * DEFAULT_TOLERANCE_RATIO
	);
}

/** What is left to offer once the charges the user already tracks as recurring rules are removed. */
export function excludeTracked(
	detected: DetectedSubscription[],
	rules: RecurringRule[]
): DetectedSubscription[] {
	return detected.filter((subscription) => !rules.some((rule) => isTrackedBy(rule, subscription)));
}

/** Whether a detected charge can become a recurring rule: rules recur weekly, monthly or yearly. */
export function canTrack(
	subscription: DetectedSubscription
): subscription is DetectedSubscription & { cadence: RecurringFrequency } {
	return subscription.cadence !== 'quarterly';
}

/** The rule that tracks a detected subscription: its latest charge, due on the same day it fell. */
export function ruleFromDetected(
	subscription: DetectedSubscription & { cadence: RecurringFrequency }
): NewRecurringRule {
	return {
		accountId: subscription.accountId,
		categoryId: subscription.categoryId,
		amount: -subscription.lastAmountMinor,
		frequency: subscription.cadence,
		dayOfPeriod: defaultDayFor(subscription.cadence, subscription.lastChargedDate),
		...(subscription.cadence === 'yearly'
			? { monthOfYear: defaultMonthFor(subscription.lastChargedDate) ?? undefined }
			: {}),
		label: subscription.merchantName,
		isSubscription: true
	};
}
