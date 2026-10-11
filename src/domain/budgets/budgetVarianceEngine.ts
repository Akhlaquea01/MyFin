import { BudgetRepository } from '../../data/dexie/budgetRepository';
import { CategoryRepository } from '../../data/dexie/categoryRepository';
import {
	ensureBudgetItemForPeriod,
	getCurrentPeriodRange,
	recalcActualAmount
} from './budgetEngine';
import { ancestorIds } from '../categories/categoryHierarchy';
import type { Budget } from '../entities';

export type VarianceStatus = 'unbudgeted' | 'under' | 'on-track' | 'over';

export interface CategoryVariance {
	categoryId: string;
	month: string; // "YYYY-MM"
	budgetedMinor: number | null;
	actualMinor: number;
	varianceMinor: number | null;
	status: VarianceStatus;
}

function monthToReferenceDate(month: string): Date {
	const [year, monthIndex] = month.split('-').map(Number);
	return new Date(year, monthIndex - 1, 1);
}

/**
 * Computes budgeted vs. actual vs. variance per category across `months` (FR-010–FR-012,
 * contracts/budget-variance-report.md). Reuses `budgetEngine.ensureBudgetItemForPeriod`
 * unchanged for categories that have a budget, and `recalcActualAmount` directly for categories
 * that don't — so a category with real spend but no budget is reported as `'unbudgeted'` with
 * its actual spend, never silently folded into zero-variance or omitted. A category with a
 * budget and zero actual transactions is still included (full under-spend), never omitted.
 *
 * A budget covers its subcategories (see `recalcActualAmount`), so:
 *  - a budgeted category's actual includes everything filed under its subcategories;
 *  - a category with no budget of its own, but a budgeted ANCESTOR, is not "unbudgeted" — its spend
 *    is already inside that ancestor's row, and listing it again as unbudgeted would both
 *    contradict that and show the same money twice;
 *  - a category that is genuinely unbudgeted reports only what is filed directly under it, since
 *    each of its subcategories gets a row of its own.
 */
export async function computeVarianceReport(
	key: CryptoKey,
	months: string[]
): Promise<CategoryVariance[]> {
	const [budgets, categories] = await Promise.all([
		BudgetRepository.list(key),
		CategoryRepository.list(key)
	]);
	const budgetByCategory = new Map<string, Budget>(budgets.map((b) => [b.categoryId, b]));
	const coveredByAncestorBudget = new Set(
		categories
			.filter((c) => ancestorIds(categories, c.id).some((id) => budgetByCategory.has(id)))
			.map((c) => c.id)
	);

	const results: CategoryVariance[] = [];
	for (const month of months) {
		const referenceDate = monthToReferenceDate(month);
		const { periodStart, periodEnd } = getCurrentPeriodRange('monthly', referenceDate);

		for (const category of categories) {
			const budget = budgetByCategory.get(category.id);
			if (budget) {
				const item = await ensureBudgetItemForPeriod(key, budget, referenceDate);
				const status: VarianceStatus =
					item.actualAmount > item.plannedAmount
						? 'over'
						: item.actualAmount === item.plannedAmount
							? 'on-track'
							: 'under';
				results.push({
					categoryId: category.id,
					month,
					budgetedMinor: item.plannedAmount,
					actualMinor: item.actualAmount,
					varianceMinor: item.plannedAmount - item.actualAmount,
					status
				});
			} else {
				// No budget covers this category this month — only worth a row if it actually has
				// spend, or every never-budgeted category would clutter every month's report.
				if (coveredByAncestorBudget.has(category.id)) continue;
				const actualMinor = await recalcActualAmount(key, category.id, periodStart, periodEnd, {
					includeSubcategories: false,
					categories
				});
				if (actualMinor === 0) continue;
				results.push({
					categoryId: category.id,
					month,
					budgetedMinor: null,
					actualMinor,
					varianceMinor: null,
					status: 'unbudgeted'
				});
			}
		}
	}
	return results;
}
