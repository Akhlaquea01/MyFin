import { RecurringRepository, ExpectedEventRepository } from '../../data/dexie/recurringRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../data/dexie/transactionRepository';
import { localDateAsUtc, todayLocalISO } from '../shared/dateMath';
import type {
	RecurringRule,
	RecurringFrequency,
	ExpectedEvent,
	Transaction
} from '../../domain/entities';

const MATCH_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function toDateOnly(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInYear(year: number): number {
	return isLeapYear(year) ? 366 : 365;
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

	// yearly: dayOfPeriod is a 1-366 day-of-year, clamped to the target year's actual length
	// (366 only exists in a leap year — without this clamp, a rule set to day 366 rolls into
	// Jan 1 of the following year in a non-leap year and skips that year's occurrence entirely).
	const year = d.getUTCFullYear();
	const startOfYear = Date.UTC(year, 0, 1);
	const dayThisYear = Math.min(rule.dayOfPeriod, daysInYear(year));
	const candidate = new Date(startOfYear + (dayThisYear - 1) * DAY_MS);
	if (candidate >= d) return candidate;
	const nextYear = year + 1;
	const startOfNextYear = Date.UTC(nextYear, 0, 1);
	const dayNextYear = Math.min(rule.dayOfPeriod, daysInYear(nextYear));
	return new Date(startOfNextYear + (dayNextYear - 1) * DAY_MS);
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
	let cursor = nextOccurrenceOnOrAfter(rule, localDateAsUtc(fromDate));
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
 * Tries to match a transaction to an expected event on the same account within
 * ±MATCH_WINDOW_DAYS, for the same amount and direction (FR-030). Returns the matched event, or
 * null if none qualified.
 *
 * Two things here exist because bills are usually paid and *recorded* in different orders:
 *  - An "Uncategorized" entry matches regardless of the rule's category. A bill that arrives from a
 *    bank statement, an SMS or Quick Add has no category yet, so insisting on one meant such a
 *    bill could never match anything and every recurring payment recorded that way was reported
 *    "missed". An entry with a real category must still agree with the rule's.
 *  - A `missed` event can still be matched. "Missed" is a judgement made when the due date passes
 *    with nothing recorded; a statement imported later is exactly the evidence that overturns it.
 *
 * Transfers (a card payment, a person-loan movement) are never bills and never match.
 */
export async function matchTransaction(
	key: CryptoKey,
	transaction: Transaction,
	categoryId: string | null
): Promise<ExpectedEvent | null> {
	if (!categoryId) return null;
	if (transaction.type === 'transfer' || transaction.deletedAt !== null) return null;
	const rules = await RecurringRepository.list(key);
	const candidateRules = rules.filter(
		(r) =>
			r.accountId === transaction.accountId &&
			(categoryId === UNCATEGORIZED_CATEGORY_ID || r.categoryId === categoryId)
	);
	if (candidateRules.length === 0) return null;

	const txDate = new Date(transaction.date).getTime();
	const windowMs = MATCH_WINDOW_DAYS * DAY_MS;
	let best: { event: ExpectedEvent; distance: number } | null = null;

	for (const rule of candidateRules) {
		// Compare magnitude and direction separately: rule.amount follows the same sign
		// convention as Transaction.amount (negative = expense), so an income transaction must
		// never satisfy an expense rule of the same magnitude, or vice versa.
		if (Math.abs(rule.amount) !== Math.abs(transaction.amount)) continue;
		if (rule.amount < 0 !== transaction.amount < 0) continue;
		const events = await ExpectedEventRepository.listForRule(key, rule.id);
		// Already matched to this very transaction (re-running after an edit/confirm): keep it.
		const already = events.find((e) => e.matchedTransactionId === transaction.id);
		if (already) return already;
		for (const event of events) {
			if (event.status === 'matched') continue;
			const distance = Math.abs(new Date(event.expectedDate).getTime() - txDate);
			if (distance > windowMs) continue;
			// Closest due date wins; on a tie prefer a still-pending event over a missed one.
			if (
				!best ||
				distance < best.distance ||
				(distance === best.distance &&
					event.status === 'pending' &&
					best.event.status !== 'pending')
			) {
				best = { event, distance };
			}
		}
	}

	if (!best) return null;
	return ExpectedEventRepository.update(key, best.event.id, {
		status: 'matched',
		matchedTransactionId: transaction.id
	});
}

/**
 * Detaches every expected event matched to `transactionId` — the transaction was deleted, edited,
 * or turned into a transfer. A past-due event goes back to `missed`, a future one to `pending`, so
 * the schedule never keeps claiming a payment that no longer exists. Returns how many were freed.
 */
export async function releaseMatches(
	key: CryptoKey,
	transactionId: string,
	asOf: Date = new Date()
): Promise<number> {
	if ((await RecurringRepository.list(key)).length === 0) return 0;
	const today = todayLocalISO(asOf);
	let freed = 0;
	for (const event of await ExpectedEventRepository.listAll(key)) {
		if (event.matchedTransactionId !== transactionId) continue;
		await ExpectedEventRepository.update(key, event.id, {
			status: event.expectedDate < today ? 'missed' : 'pending',
			matchedTransactionId: null
		});
		freed++;
	}
	return freed;
}

/**
 * Re-evaluates a transaction against the recurring schedule after something about it changed
 * (confirmed from Review with a category, edited, restored from Trash): frees whatever it was
 * matched to, then matches it afresh. Best effort — never throws, so it can never fail the edit or
 * confirmation that triggered it.
 */
export async function rematchTransaction(
	key: CryptoKey,
	transaction: Transaction
): Promise<ExpectedEvent | null> {
	try {
		await releaseMatches(key, transaction.id);
		if (transaction.deletedAt !== null || transaction.type === 'transfer') return null;
		const splits = await TransactionRepository.getSplits(key, transaction.id);
		for (const split of splits) {
			const matched = await matchTransaction(key, transaction, split.categoryId);
			if (matched) return matched;
		}
	} catch {
		// Recurring matching is a convenience layered on top of the ledger.
	}
	return null;
}

/** Flags pending events whose due date has passed as missed (FR-031). */
export async function markMissedPastDue(key: CryptoKey, asOf: Date = new Date()): Promise<number> {
	const pending = await ExpectedEventRepository.listPending(key);
	const cutoff = todayLocalISO(asOf);
	let count = 0;
	for (const event of pending) {
		if (event.expectedDate < cutoff) {
			await ExpectedEventRepository.update(key, event.id, { status: 'missed' });
			count++;
		}
	}
	return count;
}

/**
 * Creates a RecurringRule pre-filled from an existing transaction's data and
 * links the source transaction via `recurringRuleId` (FR-005, spec 016).
 * Called from ReviewPage's "Mark as Recurring" confirm action.
 */
export async function createRuleFromTransaction(
	key: CryptoKey,
	transaction: Transaction,
	details: { frequency: RecurringFrequency; dayOfPeriod: number; categoryId?: string }
): Promise<RecurringRule> {
	// Build a RecurringRule using the same shape RecurringPage.tsx already builds via its form,
	// plus the new optional `label` field. Prefer the caller's explicit categoryId (e.g. Review's
	// currently-selected category, which may not be committed yet) over the transaction's
	// already-persisted split.
	let categoryId = details.categoryId;
	if (!categoryId) {
		const splits = await TransactionRepository.getSplits(key, transaction.id);
		categoryId = splits[0]?.categoryId ?? '';
	}

	const rule = await RecurringRepository.create(key, {
		accountId: transaction.accountId,
		categoryId,
		amount: transaction.amount,
		frequency: details.frequency,
		dayOfPeriod: details.dayOfPeriod,
		label: transaction.notes || undefined
	});

	// Link the source transaction to the new rule
	await TransactionRepository.update(key, transaction.id, {
		recurringRuleId: rule.id
	});

	return rule;
}
