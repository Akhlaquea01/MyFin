/**
 * Savings Goals domain types. A GoalProgress is always derived on demand from a SavingsGoal
 * and its GoalContribution[] — it is never itself persisted (research.md §5).
 */

export type GoalStatus = 'achieved' | 'insufficient-data' | 'behind' | 'on-track';

export interface GoalProgress {
	goalId: string;
	/** Sum of the goal's contribution amounts (smallest currency unit); may include negative corrections. */
	savedAmount: number;
	/** round(savedAmount / targetAmount * 100); uncapped above 100 on overshoot. */
	progressPercent: number;
	achieved: boolean;
	/** ISO date; null when insufficient data, a non-positive rate, or already achieved. */
	projectedCompletionDate: string | null;
	status: GoalStatus;
}
