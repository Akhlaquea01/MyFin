import { RecurringRepository, ExpectedEventRepository } from '../../data/dexie/recurringRepository';
import type { RecurringRule, ExpectedEvent, Transaction } from '../../domain/entities';

const MATCH_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function toDateOnly(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/** Next occurrence on/after `from` for the rule's frequency/dayOfPeriod (FR-028). */
function nextOccurrenceOnOrAfter(rule: RecurringRule, from: Date): Date {
	const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));

	if (rule.frequency === 'weekly') {
		const target = rule.dayOfPeriod % 7;
		const diff = (target - d.getUTCDay() + 7) % 7;
		d.setUTCDate(d.getUTCDate() + diff);
		return d;
	}

	if (rule.frequency === 'monthly') {
		const lastDayThisMonth = new Date(
			Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
		).getUTCDate();
		const day = Math.min(rule.dayOfPeriod, lastDayThisMonth);
		const candidate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day));
		if (candidate >= d) return candidate;
		const lastDayNextMonth = new Date(
			Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)
		).getUTCDate();
		return new Date(
			Date.UTC(
				d.getUTCFullYear(),
				d.getUTCMonth() + 1,
				Math.min(rule.dayOfPeriod, lastDayNextMonth)
			)
		);
	}

	// yearly: dayOfPeriod is a 1-366 day-of-year.
	const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
	const candidate = new Date(startOfYear + (rule.dayOfPeriod - 1) * DAY_MS);
	if (candidate >= d) return candidate;
	const startOfNextYear = Date.UTC(d.getUTCFullYear() + 1, 0, 1);
	return new Date(startOfNextYear + (rule.dayOfPeriod - 1) * DAY_MS);
}

function addOnePeriod(rule: RecurringRule, date: Date): Date {
	const d = new Date(date);
	if (rule.frequency === 'weekly') {
		d.setUTCDate(d.getUTCDate() + 7);
		return d;
	}
	if (rule.frequency === 'monthly') {
		return nextOccurrenceOnOrAfter(rule, new Date(d.getTime() + DAY_MS));
	}
	return nextOccurrenceOnOrAfter(rule, new Date(d.getTime() + DAY_MS));
}

/**
 * Generates ExpectedEvents for `rule` from today through `throughDate` (FR-029),
 * skipping dates that already have an event so this can be called repeatedly (e.g. every
 * time the Recurring page loads) without creating duplicates.
 */
export async function generateExpectedEvents(
	key: CryptoKey,
	rule: RecurringRule,
	throughDate: Date,
	fromDate: Date = new Date()
): Promise<ExpectedEvent[]> {
	const existing = await ExpectedEventRepository.listForRule(key, rule.id);
	const existingDates = new Set(existing.map((e) => e.expectedDate));

	const created: ExpectedEvent[] = [];
	let cursor = nextOccurrenceOnOrAfter(rule, fromDate);
	let guard = 0;
	while (cursor <= throughDate && guard < 200) {
		guard++;
		const dateStr = toDateOnly(cursor);
		if (!existingDates.has(dateStr)) {
			const event = await ExpectedEventRepository.create(key, {
				recurringRuleId: rule.id,
				expectedDate: dateStr,
				status: 'pending',
				matchedTransactionId: null
			});
			created.push(event);
			existingDates.add(dateStr);
		}
		cursor = addOnePeriod(rule, cursor);
	}
	return created;
}

/**
 * Tries to match a newly recorded transaction to a pending expected event on the same
 * account+category+amount within ±MATCH_WINDOW_DAYS (FR-030). Returns the matched event,
 * or null if none qualified.
 */
export async function matchTransaction(
	key: CryptoKey,
	transaction: Transaction,
	categoryId: string | null
): Promise<ExpectedEvent | null> {
	if (!categoryId) return null;
	const rules = await RecurringRepository.list(key);
	const candidateRules = rules.filter(
		(r) => r.accountId === transaction.accountId && r.categoryId === categoryId
	);
	if (candidateRules.length === 0) return null;

	const txDate = new Date(transaction.date).getTime();

	for (const rule of candidateRules) {
		if (Math.abs(rule.amount) !== Math.abs(transaction.amount)) continue;
		const pending = (await ExpectedEventRepository.listForRule(key, rule.id)).filter(
			(e) => e.status === 'pending'
		);
		const match = pending.find(
			(e) => Math.abs(new Date(e.expectedDate).getTime() - txDate) <= MATCH_WINDOW_DAYS * DAY_MS
		);
		if (match) {
			return ExpectedEventRepository.update(key, match.id, {
				status: 'matched',
				matchedTransactionId: transaction.id
			});
		}
	}
	return null;
}

/** Flags pending events whose due date has passed as missed (FR-031). */
export async function markMissedPastDue(key: CryptoKey, asOf: Date = new Date()): Promise<number> {
	const pending = await ExpectedEventRepository.listPending(key);
	const cutoff = toDateOnly(asOf);
	let count = 0;
	for (const event of pending) {
		if (event.expectedDate < cutoff) {
			await ExpectedEventRepository.update(key, event.id, { status: 'missed' });
			count++;
		}
	}
	return count;
}
