import { addMonthsISO, monthsBetween } from '../shared/dateMath';
import type { GoalProgress, GoalStatus } from './types';

export interface ComputeGoalProgressInput {
	goal: {
		id: string;
		targetAmount: number;
		targetDate: string | null;
	};
	contributions: { amount: number; date: string }[];
	/** "Today"; a parameter for testability. */
	asOfDate: Date;
}

/**
 * Pure, derived progress/projection for a single goal — per
 * contracts/goal-progress-engine.md (spec 003). Never mutates its input or performs I/O.
 */
export function computeGoalProgress(input: ComputeGoalProgressInput): GoalProgress {
	const { goal, contributions, asOfDate } = input;

	const savedAmount = contributions.reduce((sum, c) => sum + c.amount, 0);
	const progressPercent = Math.round((savedAmount / goal.targetAmount) * 100);
	const achieved = savedAmount >= goal.targetAmount;

	if (achieved) {
		return {
			goalId: goal.id,
			savedAmount,
			progressPercent,
			achieved: true,
			projectedCompletionDate: null,
			status: 'achieved'
		};
	}

	const projectedCompletionDate = projectCompletionDate(goal, contributions, savedAmount, asOfDate);

	let status: GoalStatus;
	if (projectedCompletionDate === null) {
		status = 'insufficient-data';
	} else if (goal.targetDate !== null && projectedCompletionDate > goal.targetDate) {
		status = 'behind';
	} else {
		status = 'on-track';
	}

	return {
		goalId: goal.id,
		savedAmount,
		progressPercent,
		achieved: false,
		projectedCompletionDate,
		status
	};
}

function projectCompletionDate(
	goal: ComputeGoalProgressInput['goal'],
	contributions: ComputeGoalProgressInput['contributions'],
	savedAmount: number,
	asOfDate: Date
): string | null {
	if (contributions.length < 2) return null;

	const dates = contributions.map((c) => c.date).sort();
	const monthSpan = monthsBetween(dates[0], dates[dates.length - 1]);
	if (monthSpan <= 0) return null;

	const monthlyRate = savedAmount / monthSpan;
	if (monthlyRate <= 0) return null;

	const remaining = Math.max(0, goal.targetAmount - savedAmount);
	const monthsToGo = Math.ceil(remaining / monthlyRate);
	return addMonthsISO(asOfDate, monthsToGo);
}
