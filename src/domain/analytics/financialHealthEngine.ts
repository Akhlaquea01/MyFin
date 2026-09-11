/**
 * Pure math for the Financial Health Insights panel (spec 007). No I/O, no `CryptoKey`, no
 * repository import — every figure here is a plain function of already-computed numbers, so
 * it is unit-testable without touching Dexie. The impure orchestrator that supplies those
 * numbers (from the *existing* `incomeExpenseTrend`/`budgetPerformance` in
 * `analyticsEngine.ts` — never a new query) lives in `financialHealthService.ts`.
 */

/** Minimum consecutive months with income activity before a composite score counts as
 *  'full' confidence (research.md §5) — matches the existing minimum-sample-size convention
 *  already established by `MIN_STREAK` in `../categorization/categorizationEngine.ts`. */
export const MIN_HEALTH_SCORE_PERIODS = 3;

/** One month's derived figures (data-model.md). `null` fields mean "not applicable", never a
 *  computed-but-nonsensical value (FR-003). */
export interface FinancialHealthMetrics {
	month: string; // "YYYY-MM"
	income: number; // paise
	expense: number; // paise, positive magnitude
	savingsRate: number | null;
	expenseToIncomeRatio: number | null;
	budgetAdherence: number | null; // percent, 0-100
	budgetsConsidered: number;
}

export interface FinancialHealthScoreComponent {
	value: number | null;
	component: number | null; // clamped 0-100 contribution
	weight: number;
}

export interface FinancialHealthScore {
	score: number | null; // 0-100
	dataQuality: 'full' | 'limited';
	breakdown: {
		savingsRate: FinancialHealthScoreComponent;
		budgetAdherence: FinancialHealthScoreComponent;
	};
}

const SAVINGS_RATE_WEIGHT = 0.6;
const BUDGET_ADHERENCE_WEIGHT = 0.4;

/** `(income - expense) / income`, or `null` when income can't meaningfully be divided by
 *  (FR-003) — never `Infinity`/`NaN`/a negative-from-negative-income artifact. */
export function computeSavingsRate(income: number, expense: number): number | null {
	if (income <= 0) return null;
	return (income - expense) / income;
}

/** `expense / income`, or `null` under the same guard as `computeSavingsRate` — both derive
 *  from the same denominator and must be null/non-null together (data-model.md). */
export function computeExpenseToIncomeRatio(income: number, expense: number): number | null {
	if (income <= 0) return null;
	return expense / income;
}

/**
 * Percent of budget-period rows within their limit. `<=` deliberately matches
 * `AnalyticsPage.tsx`'s existing "Over budget" check (`actualAmount > plannedAmount`) exactly,
 * so a budget flagged over there is never counted as "adhered to" here (FR-007, research.md
 * §2). `null` when there are no rows to judge (Edge Cases — no active budgets is not a
 * penalty, not a `0%`).
 */
export function computeBudgetAdherence(items: { plannedAmount: number; actualAmount: number }[]): {
	adherence: number | null;
	considered: number;
} {
	const considered = items.length;
	if (considered === 0) return { adherence: null, considered };
	const withinLimit = items.filter((i) => i.actualAmount <= i.plannedAmount).length;
	return { adherence: (100 * withinLimit) / considered, considered };
}

/** Composes the three functions above into one `FinancialHealthMetrics` row (`month` is
 *  filled in by the caller, which already knows it from the trend bucket it came from). */
export function buildMonthlyMetrics(
	income: number,
	expense: number,
	budgetItems: { plannedAmount: number; actualAmount: number }[]
): Omit<FinancialHealthMetrics, 'month'> {
	const { adherence, considered } = computeBudgetAdherence(budgetItems);
	return {
		income,
		expense,
		savingsRate: computeSavingsRate(income, expense),
		expenseToIncomeRatio: computeExpenseToIncomeRatio(income, expense),
		budgetAdherence: adherence,
		budgetsConsidered: considered
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

const EMPTY_SCORE: FinancialHealthScore = {
	score: null,
	dataQuality: 'limited',
	breakdown: {
		savingsRate: { value: null, component: null, weight: SAVINGS_RATE_WEIGHT },
		budgetAdherence: { value: null, component: null, weight: BUDGET_ADHERENCE_WEIGHT }
	}
};

/**
 * Composite 0-100 score derived from the *last* point of `trend` (research.md §4), weighted
 * 60/40 savings-rate/budget-adherence when both are available (research.md §5) — the sole
 * available component alone, unweighted, when only one is. `dataQuality` is `'full'` only
 * when both components are present AND at least `MIN_HEALTH_SCORE_PERIODS` months in the
 * whole trend have `income > 0`; otherwise `'limited'` (FR-006) rather than a falsely precise
 * number with no caveat.
 */
export function computeFinancialHealthScore(trend: FinancialHealthMetrics[]): FinancialHealthScore {
	if (trend.length === 0) return EMPTY_SCORE;

	const latest = trend[trend.length - 1];
	const savingsRateComponent =
		latest.savingsRate === null ? null : clamp(latest.savingsRate * 100, 0, 100);
	const budgetAdherenceComponent =
		latest.budgetAdherence === null ? null : clamp(latest.budgetAdherence, 0, 100);

	const breakdown = {
		savingsRate: {
			value: latest.savingsRate,
			component: savingsRateComponent,
			weight: SAVINGS_RATE_WEIGHT
		},
		budgetAdherence: {
			value: latest.budgetAdherence,
			component: budgetAdherenceComponent,
			weight: BUDGET_ADHERENCE_WEIGHT
		}
	};

	let score: number | null;
	if (savingsRateComponent !== null && budgetAdherenceComponent !== null) {
		score = Math.round(
			SAVINGS_RATE_WEIGHT * savingsRateComponent +
				BUDGET_ADHERENCE_WEIGHT * budgetAdherenceComponent
		);
	} else if (savingsRateComponent !== null) {
		score = Math.round(savingsRateComponent);
	} else if (budgetAdherenceComponent !== null) {
		score = Math.round(budgetAdherenceComponent);
	} else {
		score = null;
	}

	const periodsWithIncome = trend.filter((m) => m.income > 0).length;
	const dataQuality: 'full' | 'limited' =
		savingsRateComponent !== null &&
		budgetAdherenceComponent !== null &&
		periodsWithIncome >= MIN_HEALTH_SCORE_PERIODS
			? 'full'
			: 'limited';

	return { score, dataQuality, breakdown };
}
