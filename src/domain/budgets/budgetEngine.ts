import { db } from '../../data/dexie/db';
import { decryptRows } from '../../data/dexie/encryptedTable';
import { BudgetItemRepository, BudgetRepository } from '../../data/dexie/budgetRepository';
import { CategoryRepository } from '../../data/dexie/categoryRepository';
import { categoryWithDescendantIds } from '../categories/categoryHierarchy';
import type { TransactionSplitRow } from '../../data/dexie/db';
import type {
	Budget,
	BudgetItem,
	BudgetPeriodType,
	BudgetRolloverMode,
	Category,
	TransactionSplit
} from '../../domain/entities';

/** How many empty periods to walk back through when looking for a rollover source, scaled by
 *  period type so both bound to roughly the same two years — a flat cap applied to yearly
 *  budgets too would let a pathological case walk back 24 *years* instead of 2. */
const MAX_ROLLOVER_LOOKBACK: Record<BudgetPeriodType, number> = {
	monthly: 24,
	yearly: 2
};

export interface PeriodRange {
	periodStart: string;
	periodEnd: string;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** The monthly/yearly period containing `referenceDate` (FR-023). */
export function getCurrentPeriodRange(
	periodType: Budget['periodType'],
	referenceDate: Date = new Date()
): PeriodRange {
	// Local calendar accessors, not UTC. Transaction dates come from `<input type="date">`,
	// which yields the user's *local* day, so deriving period bounds in UTC put the boundary in
	// the wrong place: in IST (UTC+5:30) the first 5.5 hours of every month were still measured
	// against the previous month's budget.
	const year = referenceDate.getFullYear();
	if (periodType === 'yearly') {
		return { periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` };
	}
	const month = referenceDate.getMonth();
	const lastDay = new Date(year, month + 1, 0).getDate();
	return {
		periodStart: `${year}-${pad(month + 1)}-01`,
		periodEnd: `${year}-${pad(month + 1)}-${pad(lastDay)}`
	};
}

/** The period immediately before the given one, for rollover lookups (FR-025). */
export function getPreviousPeriodRange(
	periodType: Budget['periodType'],
	currentStart: string
): PeriodRange {
	const [y, m] = currentStart.split('-').map(Number);
	if (periodType === 'yearly') {
		return { periodStart: `${y - 1}-01-01`, periodEnd: `${y - 1}-12-31` };
	}
	const prevMonthDate = new Date(y, m - 2, 1);
	return getCurrentPeriodRange('monthly', prevMonthDate);
}

export interface ActualAmountOptions {
	/**
	 * Count spending in the category's subcategories too (default true). A budget on "Food" is a
	 * budget for food — "Groceries" and "Dining out" included. Counting only entries filed directly
	 * under "Food" made a parent budget show almost nothing spent while the money went out under its
	 * children, which is where nearly all of it is filed in practice.
	 */
	includeSubcategories?: boolean;
	/** The live categories, when the caller already has them (saves a read per call). */
	categories?: Category[];
}

/**
 * Sums how much was actually spent in `categoryId` within [periodStart, periodEnd]
 * (FR-024): the magnitude of net negative (expense) split amounts on non-deleted
 * transactions. Income booked to the same category nets against spend rather than
 * inflating it, but the result never reports "negative spending".
 *
 * By default this includes every subcategory of `categoryId` (see `ActualAmountOptions`).
 */
export async function recalcActualAmount(
	key: CryptoKey,
	categoryId: string,
	periodStart: string,
	periodEnd: string,
	options: ActualAmountOptions = {}
): Promise<number> {
	// Narrow on the `date` index first, then join. This previously loaded every split ever
	// recorded for the category and issued one `db.transactions.get(id)` per split — so the cost
	// grew with total history rather than with the period being calculated, on a path that runs
	// for every budget on every app unlock (runNotificationCheck).
	const txRows = await db.transactions
		.where('date')
		.between(periodStart, periodEnd, true, true)
		.toArray();
	if (txRows.length === 0) return 0;

	const categoryIds =
		options.includeSubcategories === false
			? [categoryId]
			: categoryWithDescendantIds(
					options.categories ?? (await CategoryRepository.list(key)),
					categoryId
				);

	const idsInPeriod = new Set(txRows.map((r) => r.id));
	const splitRows = (
		await db.transactionSplits.where('categoryId').anyOf(categoryIds).toArray()
	).filter((row) => idsInPeriod.has(row.transactionId));
	if (splitRows.length === 0) return 0;

	const splits = await decryptRows<TransactionSplitRow, TransactionSplit>(key, splitRows);
	const net = splits.reduce((sum, split) => sum + split.amount, 0);
	return Math.max(0, -net);
}

/**
 * A sinking fund's balance carried through periods nobody opened, oldest first: each one adds its
 * allowance and loses what was spent in it, and never goes below zero (FR-026). `skipped` is newest
 * first, the order the walk back finds them in. Counting only the allowance, as this used to, left
 * money spent in an unopened month still sitting in the fund.
 */
async function accrueThroughSkippedPeriods(
	key: CryptoKey,
	budget: Budget,
	startingBalance: number,
	skipped: PeriodRange[]
): Promise<number> {
	let balance = startingBalance;
	for (const range of [...skipped].reverse()) {
		const spent = await recalcActualAmount(
			key,
			budget.categoryId,
			range.periodStart,
			range.periodEnd
		);
		balance = Math.max(0, balance + budget.amount - spent);
	}
	return balance;
}

/**
 * spec 019 (envelope rollover, research.md R4): `rolloverMode` is the new authoritative field.
 * Absent (every pre-existing Budget row) falls back to the legacy `rolloverEnabled` boolean, which was
 * always positive-only — so old data's behavior is unchanged with no migration. Only an explicit
 * `'full'` additionally carries a *deficit* forward.
 */
function effectiveRolloverMode(budget: Budget): BudgetRolloverMode {
	return budget.rolloverMode ?? (budget.rolloverEnabled ? 'positive-only' : 'off');
}

/** Whether anything rolls into a new period of this budget: sinking funds always do. */
function rollsOver(budget: Budget): boolean {
	return effectiveRolloverMode(budget) !== 'off' || budget.isSinkingFund;
}

/**
 * What rolls into the period starting `periodStart`, read from the closest earlier period that has an
 * item; null when there is none to read it from (a new budget, or a gap longer than the lookback).
 */
async function computeRolloverIn(
	key: CryptoKey,
	budget: Budget,
	periodStart: string
): Promise<number | null> {
	// Walk back past periods the user never opened the app in. Items are created lazily, so
	// looking exactly one period back found nothing after any gap and silently reset the
	// accumulated balance to zero — which, for a sinking fund, destroys the entire point of
	// the feature (FR-026).
	let cursor = getPreviousPeriodRange(budget.periodType, periodStart);
	let prevItem = await BudgetItemRepository.findForPeriod(key, budget.id, cursor.periodStart);
	const skippedPeriods: PeriodRange[] = [];
	while (!prevItem && skippedPeriods.length < MAX_ROLLOVER_LOOKBACK[budget.periodType]) {
		skippedPeriods.push(cursor);
		cursor = getPreviousPeriodRange(budget.periodType, cursor.periodStart);
		prevItem = await BudgetItemRepository.findForPeriod(key, budget.id, cursor.periodStart);
	}
	if (!prevItem) return null;

	// What rolls over is what was REALLY left, not what the item said the last time somebody
	// looked at it: spending recorded since (Quick Add, an import, a captured message) never
	// touches the stored item, so a month that was last opened early on would hand its whole
	// budget to the next month as "unspent". The closed month is brought up to date first.
	const prevActual = await recalcActualAmount(
		key,
		budget.categoryId,
		prevItem.periodStart,
		prevItem.periodEnd
	);
	if (prevActual !== prevItem.actualAmount) {
		prevItem = await BudgetItemRepository.update(key, prevItem.id, { actualAmount: prevActual });
	}
	const rawDelta = prevItem.plannedAmount - prevItem.actualAmount;
	// A sinking fund's allowance is never negative, regardless of rolloverMode — only a
	// plain envelope budget in 'full' mode carries a deficit (overspend) forward.
	const unspent =
		budget.isSinkingFund || effectiveRolloverMode(budget) !== 'full'
			? Math.max(0, rawDelta)
			: rawDelta;
	// A sinking fund keeps accruing its allowance through the skipped periods; a plain
	// rollover budget only carries forward what was actually left over (positive or, in
	// 'full' mode, negative).
	return budget.isSinkingFund
		? accrueThroughSkippedPeriods(key, budget, unspent, skippedPeriods)
		: unspent;
}

/**
 * Gets (or creates) the BudgetItem for the period containing `referenceDate`, applying
 * rollover from the previous period when enabled (FR-025) — sinking funds (FR-026) always
 * roll over their unused amount, since accumulating toward a goal is the point.
 *
 * Generalized from the original `ensureCurrentBudgetItem` (spec 016, FR-010/011) to accept
 * any reference date, enabling month-wise history navigation and correct import recomputation.
 */
export async function ensureBudgetItemForPeriod(
	key: CryptoKey,
	budget: Budget,
	referenceDate: Date = new Date()
): Promise<BudgetItem> {
	const { periodStart, periodEnd } = getCurrentPeriodRange(budget.periodType, referenceDate);
	const existing = await BudgetItemRepository.findForPeriod(key, budget.id, periodStart);
	if (existing) {
		const actualAmount = await recalcActualAmount(key, budget.categoryId, periodStart, periodEnd);

		// FR-012, spec 017 (research.md §4): a period that has already closed relative to the
		// *real* current date keeps its historical plannedAmount, even when this function is
		// asked to recompute it (e.g. BudgetsPage's month-history selector, spec 016, browsing a
		// past month after the budget's amount was edited today). Only actualAmount — what was
		// really spent — keeps recomputing unconditionally, since a backdated transaction/import
		// can legitimately change it for any period regardless of age.
		const { periodStart: currentPeriodStart } = getCurrentPeriodRange(
			budget.periodType,
			new Date()
		);
		const isClosedPeriod = periodStart < currentPeriodStart;

		// The current/future period follows an edit to the parent Budget's amount, and — while the
		// budget still rolls over — what is left of the period before it: spending back-filled into last
		// month (an import, a captured message) changes what rolls in. Turning rollover off keeps what
		// had already rolled in (FR-016), and a period with nothing earlier to read it from keeps what
		// it was created with.
		let rolloverInAmount = existing.rolloverInAmount;
		if (!isClosedPeriod && rollsOver(budget)) {
			rolloverInAmount =
				(await computeRolloverIn(key, budget, periodStart)) ?? existing.rolloverInAmount;
		}
		const plannedAmount = isClosedPeriod
			? existing.plannedAmount
			: budget.amount + rolloverInAmount;
		if (
			actualAmount !== existing.actualAmount ||
			plannedAmount !== existing.plannedAmount ||
			rolloverInAmount !== existing.rolloverInAmount
		) {
			return BudgetItemRepository.update(key, existing.id, {
				actualAmount,
				plannedAmount,
				rolloverInAmount
			});
		}
		return existing;
	}

	const rolloverInAmount = rollsOver(budget)
		? ((await computeRolloverIn(key, budget, periodStart)) ?? 0)
		: 0;
	const plannedAmount = budget.amount + rolloverInAmount;
	const actualAmount = await recalcActualAmount(key, budget.categoryId, periodStart, periodEnd);

	return BudgetItemRepository.create(key, {
		budgetId: budget.id,
		periodStart,
		periodEnd,
		plannedAmount,
		actualAmount,
		rolloverInAmount
	});
}

/** Thin wrapper — calls ensureBudgetItemForPeriod with today's date. */
export async function ensureCurrentBudgetItem(
	key: CryptoKey,
	budget: Budget,
	referenceDate: Date = new Date()
): Promise<BudgetItem> {
	return ensureBudgetItemForPeriod(key, budget, referenceDate);
}

/**
 * Whether a budget already exists for `categoryId`, other than
 * `excludeBudgetId` itself (FR-015, spec 017) — used both when creating a new budget and when
 * editing an existing one's category, to block/warn against two active budgets double-counting
 * the same category's actuals.
 */
export async function hasActiveBudgetForCategory(
	key: CryptoKey,
	categoryId: string,
	excludeBudgetId?: string
): Promise<boolean> {
	const budgets = await BudgetRepository.list(key);
	return budgets.some((b) => b.categoryId === categoryId && b.id !== excludeBudgetId);
}

/**
 * Saves changes to a budget. Its items are periods of one shape — calendar months or calendar years —
 * so switching the period type drops them: left in place they sat beside the new ones, and a monthly
 * item from before the switch was listed (and counted by the dashboard and health score) under what
 * was now a yearly budget. The new period's item is created the next time the budget is read.
 */
export async function updateBudget(
	key: CryptoKey,
	id: string,
	changes: Partial<Budget>
): Promise<Budget> {
	const before = await BudgetRepository.getById(key, id);
	if (!before) throw new Error('That budget no longer exists.');
	const updated = await BudgetRepository.update(key, id, changes);
	if (updated.periodType !== before.periodType) await BudgetItemRepository.removeForBudget(id);
	return updated;
}
