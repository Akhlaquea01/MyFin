/**
 * Debt Payoff Planner domain types.
 *
 * A DebtPayoffPlan is always derived on demand from current Liability records and the
 * user's strategy/extra-payment inputs — it is never itself persisted (spec FR-007).
 * Monetary amounts are integers in the smallest currency unit; interestRate is an integer
 * in basis points (research.md §2), matching the rest of the app's integer-money discipline
 * (Constitution Principle VI).
 */

import type { PayoffStrategy } from '../entities';

export type { PayoffStrategy };

/** A liability with the two planner-required fields present and non-null. */
export interface EligibleLiability {
	id: string;
	outstandingBalance: number;
	/** Annual rate in basis points, e.g. 1850 = 18.50% APR. */
	interestRate: number;
	/** Smallest currency unit. */
	minimumPayment: number;
}

export interface GeneratePlanInput {
	liabilities: EligibleLiability[];
	strategy: PayoffStrategy;
	/** Smallest currency unit, >= 0. */
	extraMonthlyPayment: number;
	/** Simulation start date; defaults to "today" in production use. */
	asOfDate: Date;
}

export interface MonthlyScheduleEntry {
	/** ISO date (first-of-month) this simulated step represents. */
	month: string;
	startingBalance: number;
	interestAccrued: number;
	paymentApplied: number;
	endingBalance: number;
}

export interface DebtPayoffPlanEntry {
	liabilityId: string;
	/** 1-based rank under the active strategy. */
	priorityOrder: number;
	/** ISO date this liability's balance reaches zero, or null if it never does within the simulation horizon. */
	payoffDate: string | null;
	/** Interest accrued on this liability over the simulated life of the plan. */
	totalInterest: number;
	/** True when this liability's balance does not reach zero within the simulation horizon (FR-010). */
	nonConverging: boolean;
	monthlySchedule: MonthlyScheduleEntry[];
}

export interface DebtPayoffPlan {
	strategy: PayoffStrategy;
	/** One entry per included liability, in priority order. */
	entries: DebtPayoffPlanEntry[];
	/** Latest payoff date among all entries, or null if entries is empty or any entry is non-converging. */
	payoffDate: string | null;
	/** Sum of totalInterest across all entries. */
	totalInterest: number;
	/** Liabilities excluded from this plan for missing interestRate/minimumPayment (FR-008). */
	excludedLiabilityIds: string[];
}
