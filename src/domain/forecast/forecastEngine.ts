import { AccountRepository } from '../../data/dexie/accountRepository';
import { RecurringRepository, ExpectedEventRepository } from '../../data/dexie/recurringRepository';
import { TransactionRepository } from '../../data/dexie/transactionRepository';
import { generateExpectedEvents } from '../recurring/recurringEngine';
import type { BalanceForecast, ForecastHorizonDays, ForecastPoint, ForecastWarning } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const DRIFT_LOOKBACK_DAYS = 90;
const MIN_EVENTS_FOR_CONFIDENCE = 2;
const MIN_TRANSACTIONS_FOR_CONFIDENCE = 10;

function toDateOnly(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Projects an account's balance forward through `horizonDays` (FR-006–FR-009,
 * contracts/cashflow-forecast.md), combining two contributions per day: (a) deterministic —
 * this account's active `RecurringRule`s' pending `ExpectedEvent`s landing inside the horizon
 * (reusing `recurringEngine.generateExpectedEvents`, never re-deriving it), and (b) drift — the
 * trailing 90-day average daily net of transactions *not* already linked to a recurring rule,
 * spread evenly across the horizon. `warning` is the first day the trajectory crosses the
 * account's low-balance threshold (default 0).
 */
export async function projectAccountBalance(
	key: CryptoKey,
	accountId: string,
	horizonDays: ForecastHorizonDays,
	asOf: Date = new Date()
): Promise<BalanceForecast> {
	const account = await AccountRepository.getById(key, accountId);
	if (!account) throw new Error(`Account ${accountId} not found`);

	const horizonEnd = new Date(asOf.getTime() + horizonDays * DAY_MS);
	const asOfDateOnly = toDateOnly(asOf);
	const horizonEndDateOnly = toDateOnly(horizonEnd);

	const rules = (await RecurringRepository.listActive(key)).filter(
		(r) => r.accountId === accountId
	);

	// Ensure expected events exist through the horizon (idempotent — the same call
	// RecurringUpcomingPage already makes on every load), then collect the pending ones landing
	// inside it.
	const eventsInHorizon: { date: string; amountMinor: number }[] = [];
	for (const rule of rules) {
		await generateExpectedEvents(key, rule, horizonEnd, asOf);
		const events = await ExpectedEventRepository.listForRule(key, rule.id);
		for (const event of events) {
			if (event.status !== 'pending') continue;
			if (event.expectedDate < asOfDateOnly || event.expectedDate > horizonEndDateOnly) continue;
			eventsInHorizon.push({ date: event.expectedDate, amountMinor: rule.amount });
		}
	}

	// Drift: transactions NOT already linked to a recurring rule (Transaction.recurringRuleId,
	// spec 016) — those are already counted deterministically above via expected events, so
	// counting them again here would double-count them.
	const driftFrom = toDateOnly(new Date(asOf.getTime() - DRIFT_LOOKBACK_DAYS * DAY_MS));
	const recentTransactions = (
		await TransactionRepository.search(key, { accountId, dateFrom: driftFrom })
	).filter((tx) => tx.type !== 'transfer' && !tx.recurringRuleId);
	const driftNet = recentTransactions.reduce((sum, tx) => sum + tx.amount, 0);
	const driftPerDay = recentTransactions.length > 0 ? driftNet / DRIFT_LOOKBACK_DAYS : 0;

	const eventAmountByDate = new Map<string, number>();
	for (const event of eventsInHorizon) {
		eventAmountByDate.set(event.date, (eventAmountByDate.get(event.date) ?? 0) + event.amountMinor);
	}

	const threshold = account.lowBalanceThresholdMinor ?? 0;
	const points: ForecastPoint[] = [];
	let warning: ForecastWarning | null = null;
	let cumulative = account.currentBalance;

	for (let i = 1; i <= horizonDays; i++) {
		const date = toDateOnly(new Date(asOf.getTime() + i * DAY_MS));
		cumulative += eventAmountByDate.get(date) ?? 0;
		cumulative += driftPerDay;
		const projectedBalanceMinor = Math.round(cumulative);
		points.push({ date, projectedBalanceMinor });
		if (!warning && projectedBalanceMinor < threshold) {
			warning = { date, shortfallAmountMinor: threshold - projectedBalanceMinor };
		}
	}

	const confidence: 'normal' | 'low' =
		eventsInHorizon.length >= MIN_EVENTS_FOR_CONFIDENCE ||
		recentTransactions.length >= MIN_TRANSACTIONS_FOR_CONFIDENCE
			? 'normal'
			: 'low';

	return { accountId, horizonDays, points, warning, confidence };
}
