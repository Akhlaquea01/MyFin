// Moving everything that points at one category onto another, and removing the first. This is the
// one place that knows every thing a category can be attached to — transaction splits, budgets,
// recurring rules, categorization rules and the merchant-learning streaks — so that deleting or
// merging a category cannot leave a budget or a rule pointing at an id that no longer exists (the
// pages that print a category by id used to show the raw id).
//
// Steps are applied one after another, not in one transaction (each needs the data key to
// re-encrypt), and the category is removed LAST. A failure part-way therefore leaves the category
// in place with some references already moved, and running the same merge again finishes the job.
import { BudgetRepository } from '../../data/dexie/budgetRepository';
import { CategorizationRuleRepository } from '../../data/dexie/categorizationRuleRepository';
import { CategoryRepository } from '../../data/dexie/categoryRepository';
import { MerchantCategorySignalRepository } from '../../data/dexie/merchantCategorySignalRepository';
import { RecurringRepository } from '../../data/dexie/recurringRepository';
import { UNCATEGORIZED_CATEGORY_ID } from '../../data/dexie/transactionRepository';
import { categoryWithDescendantIds } from './categoryHierarchy';

export interface CategoryMoveResult {
	transactions: number;
	budgets: number;
	recurringRules: number;
	rules: number;
	subcategories: number;
}

export interface CategoryReferenceCounts {
	splits: number;
	budgets: number;
	recurring: number;
	/** Categorization rules and merchant-learning streaks that name the category. */
	rules: number;
}

/** What would have to move if the category went away: nothing of these is lost, but the user
 *  should know a budget or a rule is involved before it happens. */
export async function countCategoryReferences(
	key: CryptoKey,
	id: string
): Promise<CategoryReferenceCounts> {
	const [indexed, rules] = await Promise.all([
		CategoryRepository.countReferences(id),
		CategorizationRuleRepository.list(key)
	]);
	return { ...indexed, rules: rules.filter((r) => r.categoryId === id).length };
}

/**
 * Re-files everything attached to `fromId` under `toId` (null = Uncategorized) and deletes `fromId`.
 *
 * - Transactions: every split moves.
 * - Budgets: a budget moves with the category. If the target already has one, the target's is kept
 *   and this one is dropped (a category has a single budget). Moving to Uncategorized drops it.
 * - Recurring rules and categorization rules point at the target; rules for Uncategorized would
 *   never do anything, so those are removed instead.
 * - Subcategories: with \`moveSubcategories\`, they become subcategories of the target (or move up a
 *   level when the target is Uncategorized). Without it, a category that still has any is refused:
 *   deleting a parent out from under its children is how orphans were made.
 * - Merchant-learning streaks swap the id, or lose it when moving to Uncategorized.
 */
export async function moveAndRemoveCategory(
	key: CryptoKey,
	fromId: string,
	toId: string | null,
	options: { moveSubcategories?: boolean } = {}
): Promise<CategoryMoveResult> {
	const categories = await CategoryRepository.list(key);
	const from = categories.find((c) => c.id === fromId);
	if (!from) throw new Error('That category no longer exists.');
	const target =
		toId && toId !== UNCATEGORIZED_CATEGORY_ID ? categories.find((c) => c.id === toId) : null;
	if (toId && toId !== UNCATEGORIZED_CATEGORY_ID && !target) {
		throw new Error('The category to move into no longer exists.');
	}
	if (target && categoryWithDescendantIds(categories, fromId).includes(target.id)) {
		throw new Error(`Choose a category that is not ${from.name} or inside it.`);
	}

	const children = categories.filter((c) => c.parentId === fromId);
	if (children.length > 0 && !options.moveSubcategories) {
		throw new Error(
			`${from.name} still has ${children.length} ${children.length === 1 ? 'subcategory' : 'subcategories'}.`
		);
	}

	const destination = target ? target.id : UNCATEGORIZED_CATEGORY_ID;
	const result: CategoryMoveResult = {
		transactions: 0,
		budgets: 0,
		recurringRules: 0,
		rules: 0,
		subcategories: 0
	};

	// Subcategories first: they stay attached to a live parent for the whole operation.
	const newParentId = target ? target.id : from.parentId;
	for (const child of children) {
		await CategoryRepository.update(key, child.id, { parentId: newParentId });
		result.subcategories += 1;
	}

	result.transactions = await CategoryRepository.reassignSplits(key, fromId, destination);

	const budgets = await BudgetRepository.list(key);
	const targetHasBudget = !!target && budgets.some((b) => b.categoryId === target.id);
	for (const budget of budgets.filter((b) => b.categoryId === fromId)) {
		if (!target || targetHasBudget) await BudgetRepository.remove(budget.id);
		else await BudgetRepository.update(key, budget.id, { categoryId: target.id });
		result.budgets += 1;
	}

	for (const rule of (await RecurringRepository.list(key)).filter((r) => r.categoryId === fromId)) {
		await RecurringRepository.update(key, rule.id, { categoryId: destination });
		result.recurringRules += 1;
	}

	for (const rule of (await CategorizationRuleRepository.list(key)).filter(
		(r) => r.categoryId === fromId
	)) {
		if (target) await CategorizationRuleRepository.update(key, rule.id, { categoryId: target.id });
		else await CategorizationRuleRepository.remove(rule.id);
		result.rules += 1;
	}

	for (const signal of await MerchantCategorySignalRepository.listAll(key)) {
		if (!signal.recentCategoryIds.includes(fromId)) continue;
		const mapped = signal.recentCategoryIds
			.map((id) => (id === fromId ? (target ? target.id : null) : id))
			.filter((id): id is string => id !== null);
		await MerchantCategorySignalRepository.set(key, signal.id, mapped);
	}

	await CategoryRepository.remove(key, fromId);
	return result;
}
