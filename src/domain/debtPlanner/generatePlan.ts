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
 * Simulates a month-by-month payoff of `input.liabilities`, ordered by `input.strategy`,
 * with `input.extraMonthlyPayment` applied in full to the single highest-priority debt with
 * a remaining balance each month, waterfalling a paid-off debt's minimum payment into the
 * pool for subsequent months. Pure — never mutates its input (spec FR-007).
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

	let extraPool = input.extraMonthlyPayment;
	let month = 0;

	while (month < MAX_SIMULATION_MONTHS && states.some((s) => s.balance > 0)) {
		month += 1;
		const monthLabel = addMonthsISO(input.asOfDate, month);
		let extraAppliedThisMonth = false;
		let freedMinimumsThisMonth = 0;

		for (const state of states) {
			if (state.balance <= 0) continue;

			const startingBalance = state.balance;
			const interestAccrued = accrueMonthlyInterest(startingBalance, state.interestRate);
			const balanceAfterInterest = startingBalance + interestAccrued;

			let payment = Math.min(state.minimumPayment, balanceAfterInterest);
			if (!extraAppliedThisMonth) {
				payment = Math.min(payment + extraPool, balanceAfterInterest);
				extraAppliedThisMonth = true;
			}

			const endingBalance = Math.max(0, balanceAfterInterest - payment);

			state.schedule.push({
				month: monthLabel,
				startingBalance,
				interestAccrued,
				paymentApplied: payment,
				endingBalance
			});
			state.totalInterest += interestAccrued;
			state.balance = endingBalance;

			if (endingBalance === 0 && state.payoffMonth === null) {
				state.payoffMonth = month;
				freedMinimumsThisMonth += state.minimumPayment;
			}
		}

		extraPool += freedMinimumsThisMonth;
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
