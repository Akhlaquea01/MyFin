import type { Liability } from '../entities';
import { addMonthsISO } from '../shared/dateMath';
import type {
	DebtPayoffPlan,
	DebtPayoffPlanEntry,
	EligibleLiability,
	GeneratePlanInput,
	MonthlyScheduleEntry,
	PayoffStrategy
} from './types';

/** Safety cap so a genuinely non-converging debt (FR-010) terminates the simulation
 *  instead of looping forever. */
const MAX_SIMULATION_MONTHS = 600;

/**
 * Splits liabilities into those with both `interestRate` and `minimumPayment` set
 * (eligible for a payoff plan) and those missing either (excluded per FR-008). The caller
 * is responsible for surfacing `excludedLiabilityIds` to the user — `generateDebtPayoffPlan`
 * itself assumes a fully-eligible input list (contracts/debt-payoff-engine.md).
 */
export function partitionEligibleLiabilities(liabilities: Liability[]): {
	eligible: EligibleLiability[];
	excludedLiabilityIds: string[];
} {
	const eligible: EligibleLiability[] = [];
	const excludedLiabilityIds: string[] = [];

	for (const liability of liabilities) {
		if (liability.interestRate == null || liability.minimumPayment == null) {
			excludedLiabilityIds.push(liability.id);
			continue;
		}
		eligible.push({
			id: liability.id,
			outstandingBalance: liability.outstandingBalance,
			interestRate: liability.interestRate,
			minimumPayment: liability.minimumPayment
		});
	}

	return { eligible, excludedLiabilityIds };
}

function orderByStrategy(
	liabilities: EligibleLiability[],
	strategy: PayoffStrategy
): EligibleLiability[] {
	const sorted = [...liabilities];
	if (strategy === 'avalanche') {
		sorted.sort(
			(a, b) => b.interestRate - a.interestRate || b.outstandingBalance - a.outstandingBalance
		);
	} else {
		sorted.sort(
			(a, b) => a.outstandingBalance - b.outstandingBalance || b.interestRate - a.interestRate
		);
	}
	return sorted;
}

/** research.md §2: integer basis-point rate, rounded once per step against an integer balance. */
function accrueMonthlyInterest(balance: number, interestRateBasisPoints: number): number {
	return Math.round((balance * interestRateBasisPoints) / 10000 / 12);
}

interface SimulationState {
	id: string;
	balance: number;
	minimumPayment: number;
	interestRate: number;
	schedule: MonthlyScheduleEntry[];
	totalInterest: number;
	payoffMonth: number | null;
}

/**
 * Simulates a month-by-month payoff of `input.liabilities`, ordered by `input.strategy`.
 * Each month every debt gets its minimum, and the rest of a fixed budget (all the minimums plus
 * `input.extraMonthlyPayment`) goes to the highest-priority debt still owing, spilling over to the
 * next one when that debt needs less. Pure — never mutates its input (spec FR-007).
 */
export function generateDebtPayoffPlan(input: GeneratePlanInput): DebtPayoffPlan {
	const ordered = orderByStrategy(input.liabilities, input.strategy);

	if (ordered.length === 0) {
		return {
			strategy: input.strategy,
			entries: [],
			payoffDate: null,
			totalInterest: 0,
			excludedLiabilityIds: []
		};
	}

	const states: SimulationState[] = ordered.map((l) => ({
		id: l.id,
		balance: l.outstandingBalance,
		minimumPayment: l.minimumPayment,
		interestRate: l.interestRate,
		schedule: [],
		totalInterest: 0,
		payoffMonth: null
	}));

	// A fixed monthly budget: every minimum plus the extra. A debt that is paid off frees its
	// minimum automatically (the budget stays the same while its payment drops to zero), and
	// whatever a debt does not need in its final month flows on to the next one in priority order
	// the same month. Handing the extra only to the first debt left the rest of that month's
	// budget unspent, so each payoff date and the total interest came out too pessimistic.
	const monthlyBudget =
		states.reduce((sum, state) => sum + state.minimumPayment, 0) + input.extraMonthlyPayment;
	let month = 0;

	while (month < MAX_SIMULATION_MONTHS && states.some((s) => s.balance > 0)) {
		month += 1;
		const monthLabel = addMonthsISO(input.asOfDate, month);

		const rows = states
			.filter((state) => state.balance > 0)
			.map((state) => {
				const interestAccrued = accrueMonthlyInterest(state.balance, state.interestRate);
				const owed = state.balance + interestAccrued;
				return { state, interestAccrued, owed, payment: Math.min(state.minimumPayment, owed) };
			});

		let remaining = monthlyBudget - rows.reduce((sum, row) => sum + row.payment, 0);
		for (const row of rows) {
			const extra = Math.max(0, Math.min(remaining, row.owed - row.payment));
			row.payment += extra;
			remaining -= extra;
		}

		for (const { state, interestAccrued, owed, payment } of rows) {
			const startingBalance = state.balance;
			const endingBalance = owed - payment;
			state.schedule.push({
				month: monthLabel,
				startingBalance,
				interestAccrued,
				paymentApplied: payment,
				endingBalance
			});
			state.totalInterest += interestAccrued;
			state.balance = endingBalance;
			if (endingBalance === 0 && state.payoffMonth === null) state.payoffMonth = month;
		}
	}

	const entries: DebtPayoffPlanEntry[] = states.map((s, index) => ({
		liabilityId: s.id,
		priorityOrder: index + 1,
		payoffDate: s.payoffMonth !== null ? addMonthsISO(input.asOfDate, s.payoffMonth) : null,
		totalInterest: s.totalInterest,
		nonConverging: s.balance > 0,
		monthlySchedule: s.schedule
	}));

	const anyNonConverging = entries.some((e) => e.nonConverging);
	const payoffDate = anyNonConverging
		? null
		: entries.reduce<string | null>((latest, e) => {
				if (!e.payoffDate) return latest;
				return !latest || e.payoffDate > latest ? e.payoffDate : latest;
			}, null);

	return {
		strategy: input.strategy,
		entries,
		payoffDate,
		totalInterest: entries.reduce((sum, e) => sum + e.totalInterest, 0),
		excludedLiabilityIds: []
	};
}

/**
 * Runs `generateDebtPayoffPlan` once per strategy for the same liabilities and extra
 * payment amount, for the side-by-side comparison view (FR-006).
 */
export function compareStrategies(input: Omit<GeneratePlanInput, 'strategy'>): {
	avalanche: DebtPayoffPlan;
	snowball: DebtPayoffPlan;
} {
	return {
		avalanche: generateDebtPayoffPlan({ ...input, strategy: 'avalanche' }),
		snowball: generateDebtPayoffPlan({ ...input, strategy: 'snowball' })
	};
}
