import { RecurringRepository, ExpectedEventRepository } from '../../data/dexie/recurringRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../data/dexie/transactionRepository';
import { localDateAsUtc, todayLocalISO } from '../shared/dateMath';
import { yearlyMonthDay } from './recurringDay';
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

/**
 * The date a yearly rule falls on in `year`: its month and day of the month, held to the month's
 * length the way a monthly rule's 31st is (so 29 February is the 28th in an ordinary year). A calendar
 * date needs no leap-year handling of its own.
 */
function yearlyOccurrence(year: number, rule: RecurringRule): Date {
	const { month, day } = yearlyMonthDay(rule);
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return new Date(Date.UTC(year, month - 1, Math.min(day, lastDay)));
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

	// yearly: a month and a day of that month (see yearlyOccurrence).
	const year = d.getUTCFullYear();
	const candidate = yearlyOccurrence(year, rule);
	if (candidate >= d) return candidate;
	return yearlyOccurrence(year + 1, rule);
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
	if (transaction.type === 'transfer') return null;
	const rules = await RecurringRepository.list(key);
	// A paused rule is not expecting anything, so it must not claim an entry either.
	const candidateRules = rules.filter(
		(r) =>
			r.isActive !== false &&
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

/** How far from a bill's due date an entry the user explicitly tied to it may be. Wider than the
 *  automatic window: here the user has said which bill it is, so only a payment clearly meant for a
 *  different month is turned down. */
const LINK_WINDOW_DAYS = 20;

/**
 * Marks the nearest unpaid expected payment of rule `ruleId` as paid by `transaction`, because the
 * user said so (marking the entry as a bill and choosing which). Unlike `matchTransaction` this does
 * not insist on the same amount or category. Returns the event, or null if the rule has no unpaid
 * payment within `LINK_WINDOW_DAYS` of the entry's date.
 */
export async function linkTransactionToRule(
	key: CryptoKey,
	transaction: Transaction,
	ruleId: string
): Promise<ExpectedEvent | null> {
	if (transaction.type === 'transfer') return null;
	const events = await ExpectedEventRepository.listForRule(key, ruleId);
	const already = events.find((e) => e.matchedTransactionId === transaction.id);
	if (already) return already;

	const txDate = new Date(transaction.date).getTime();
	const windowMs = LINK_WINDOW_DAYS * DAY_MS;
	let best: { event: ExpectedEvent; distance: number } | null = null;
	for (const event of events) {
		if (event.status === 'matched') continue;
		const distance = Math.abs(new Date(event.expectedDate).getTime() - txDate);
		if (distance > windowMs) continue;
		if (!best || distance < best.distance) best = { event, distance };
	}
	if (!best) return null;
	return ExpectedEventRepository.update(key, best.event.id, {
		status: 'matched',
		matchedTransactionId: transaction.id
	});
}

/** A payment is only ever matched to an event due within the wider of the two matching windows of its
 *  date, so that is as far from the entry's date as a release needs to look. */
const RELEASE_WINDOW_DAYS = LINK_WINDOW_DAYS + 5;

/**
 * Detaches every expected event matched to `transactionId` — the transaction was deleted, edited,
 * or turned into a transfer. A past-due event goes back to `missed`, a future one to `pending`, so
 * the schedule never keeps claiming a payment that no longer exists. Returns how many were freed.
 *
 * `nearDates` are the dates the entry has had (its current one and, after an edit, the one it had
 * when it was matched): only paid events due around them are looked at, instead of every event ever
 * generated. Without them every paid event is checked.
 */
export async function releaseMatches(
	key: CryptoKey,
	transactionId: string,
	asOf: Date = new Date(),
	nearDates?: string[]
): Promise<number> {
	const candidates = await ExpectedEventRepository.listMatched(
		key,
		nearDates && nearDates.length > 0
			? { dates: nearDates, windowDays: RELEASE_WINDOW_DAYS }
			: undefined
	);
	if (candidates.length === 0) return 0;
	const today = todayLocalISO(asOf);
	let freed = 0;
	for (const event of candidates) {
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
 * (confirmed from Review with a category, edited): frees whatever it was
 * matched to, then matches it afresh. Best effort — never throws, so it can never fail the edit or
 * confirmation that triggered it.
 */
export async function rematchTransaction(
	key: CryptoKey,
	transaction: Transaction,
	/** The date the entry had before this change, when it changed: that is the date it was matched at. */
	previousDate?: string
): Promise<ExpectedEvent | null> {
	try {
		await releaseMatches(
			key,
			transaction.id,
			undefined,
			previousDate ? [transaction.date, previousDate] : [transaction.date]
		);
		if (transaction.type === 'transfer') return null;
		// A bill the user tied to a specific recurring rule stays tied to it. Only once the entry is
		// confirmed: one still in Review has not claimed anything yet.
		if (
			transaction.purpose?.kind === 'bills' &&
			transaction.purpose.targetId &&
			transaction.reviewStatus === 'confirmed'
		) {
			const linked = await linkTransactionToRule(key, transaction, transaction.purpose.targetId);
			if (linked) return linked;
		}
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

/** The parts of a rule that decide on which dates a payment is expected. */
const SCHEDULE_FIELDS = ['frequency', 'dayOfPeriod', 'monthOfYear'] as const;

/**
 * Saves changes to a rule (any of its fields). Changing when it recurs makes the reminders still
 * waiting for the old dates wrong, so those are dropped and come back on the new dates the next time
 * the schedule is read (the Upcoming page, the forecast and the reminder check all generate them).
 * Pausing a rule drops them for the same reason: a paused bill expects nothing, and left in place
 * they kept raising "Upcoming" alerts for a payment the user had switched off. Resuming brings the
 * schedule back the same way.
 * What already happened is kept: a payment that was matched stays matched, and a due date that was
 * missed stays missed, because those describe the past, not the plan.
 */
export async function updateRecurringRule(
	key: CryptoKey,
	ruleId: string,
	changes: Partial<
		Pick<
			RecurringRule,
			| 'accountId'
			| 'categoryId'
			| 'amount'
			| 'frequency'
			| 'dayOfPeriod'
			| 'monthOfYear'
			| 'label'
			| 'isSubscription'
			| 'isActive'
		>
	>
): Promise<RecurringRule> {
	const before = (await RecurringRepository.list(key)).find((r) => r.id === ruleId);
	if (!before) throw new Error('That recurring rule no longer exists.');
	const scheduleChanged =
		SCHEDULE_FIELDS.some((field) => field in changes && changes[field] !== before[field]) ||
		(changes.isActive === false && before.isActive !== false);
	const updated = await RecurringRepository.update(key, ruleId, changes);
	if (scheduleChanged) {
		const stale = (await ExpectedEventRepository.listForRule(key, ruleId))
			.filter((event) => event.status === 'pending')
			.map((event) => event.id);
		await ExpectedEventRepository.removeMany(stale);
	}
	return updated;
}

/**
 * Deletes a rule for good, with its reminders. Nothing the user recorded is touched, but entries
 * that pointed at the rule stop doing so: a bill marked "paid" by the rule keeps its place in the
 * ledger, the entry that created the rule is no longer "already recurring", and an entry tagged as
 * this bill keeps its Bills tag but no longer names a rule that is gone.
 */
export async function deleteRecurringRule(key: CryptoKey, ruleId: string): Promise<void> {
	const rule = (await RecurringRepository.list(key)).find((r) => r.id === ruleId);
	if (!rule) return;
	for (const tx of await TransactionRepository.search(key)) {
		const sourced = tx.recurringRuleId === ruleId;
		const tagged = tx.purpose?.kind === 'bills' && tx.purpose.targetId === ruleId;
		if (!sourced && !tagged) continue;
		await TransactionRepository.update(key, tx.id, {
			...(sourced ? { recurringRuleId: null } : {}),
			...(tagged && tx.purpose ? { purpose: { kind: 'bills', targetId: null } } : {})
		});
	}
	await RecurringRepository.remove(ruleId);
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
	details: {
		frequency: RecurringFrequency;
		dayOfPeriod: number;
		/** Yearly rules: the month the day belongs to. */
		monthOfYear?: number;
		categoryId?: string;
	}
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
		monthOfYear: details.monthOfYear,
		label: transaction.notes || undefined
	});

	// Link the source transaction to the new rule
	await TransactionRepository.update(key, transaction.id, {
		recurringRuleId: rule.id
	});

	return rule;
}
