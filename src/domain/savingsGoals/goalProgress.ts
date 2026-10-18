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

	// A non-positive target has no meaningful progress: `savedAmount / 0` yields NaN (rendered
	// as "NaN%") or Infinity, and `0 >= 0` would report the goal as already achieved. The entry
	// form rejects it, but this is a documented pure function with its own contract — a restored
	// backup or a future caller can reach it directly, so it must not depend on a form.
	if (goal.targetAmount <= 0) {
		return {
			goalId: goal.id,
			savedAmount,
			progressPercent: 0,
			achieved: false,
			projectedCompletionDate: null,
			status: 'insufficient-data'
		};
	}

	// Floored at 0: a negative correction contribution (see GoalContribution's doc comment)
	// can push savedAmount below zero, which would otherwise render as a confusing "-5%" for
	// what is, from the user's perspective, simply "no progress yet."
	const achieved = savedAmount >= goal.targetAmount;
	// Rounded, but never shown as 100% before the goal is actually met: 99.6% saved is not "done".
	const roundedPercent = Math.round((savedAmount / goal.targetAmount) * 100);
	const progressPercent = Math.max(0, achieved ? roundedPercent : Math.min(99, roundedPercent));

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

	// The first deposit marks where the clock starts: it was not saved over the months after it.
	// Counting it as well read two deposits of 1,000 a month apart as 2,000 a month (and 12 monthly
	// deposits as 9% too fast), so the pace is what came in AFTER the first day, over the time since.
	const onFirstDay = contributions
		.filter((c) => c.date === dates[0])
		.reduce((sum, c) => sum + c.amount, 0);
	const monthlyRate = (savedAmount - onFirstDay) / monthSpan;
	if (monthlyRate <= 0) return null;

	const remaining = Math.max(0, goal.targetAmount - savedAmount);
	const monthsToGo = Math.ceil(remaining / monthlyRate);
	return addMonthsISO(asOfDate, monthsToGo);
}
