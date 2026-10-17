// Turns the raw categories and a month's (and the month before's) activity into the rows the
// Categories page draws: one per top-level category with its subcategories folded in, the figures
// for the list the user is looking at (spending or income), and what changed since the month before.
// Pure, so the page stays a thin layer over it and the arithmetic can be tested without a screen.
import type { Category, CategoryKind } from '../entities';
import type { CategoryActivityItem } from '../analytics/analyticsEngine';
import { UNCATEGORIZED_CATEGORY_ID } from '../../data/dexie/transactionRepository';

export interface CategoryRow {
	category: Category;
	/** Filed directly under this category. */
	ownAmount: number;
	ownCount: number;
	/** This category plus everything below it. */
	totalAmount: number;
	totalCount: number;
	/** The same total for the month before, so the page can say whether it went up. */
	previousTotal: number;
	children: CategoryRow[];
	/** Which list the category belongs in. */
	kind: CategoryKind;
}

export interface CategoryOverview {
	kind: CategoryKind;
	rows: CategoryRow[];
	/** Everything shown, uncategorized included. */
	total: number;
	previousTotal: number;
	/** Money filed under no category at all (a placeholder, not a row the user can edit). */
	uncategorized: { amount: number; count: number; previousAmount: number };
}

const figures = (
	item: CategoryActivityItem | undefined,
	kind: CategoryKind
): { amount: number; count: number } =>
	item
		? kind === 'income'
			? { amount: item.income, count: item.incomeCount }
			: { amount: item.expense, count: item.expenseCount }
		: { amount: 0, count: 0 };

/** The categories whose parent is gone are drawn at the top level rather than lost. */
export function topLevelOf(categories: Category[]): Category[] {
	const live = new Set(categories.map((c) => c.id));
	return categories.filter((c) => c.parentId === null || !live.has(c.parentId));
}

/**
 * Which list a top-level category belongs in. A category made from the Income list says so; older
 * ones are placed by what has been filed under their tree — income if it only ever received money,
 * otherwise spending (the default for an empty one).
 */
function kindOfTree(
	root: Category,
	treeIds: string[],
	activity: Map<string, CategoryActivityItem>
): CategoryKind {
	if (root.kind) return root.kind;
	let income = 0;
	let expense = 0;
	for (const id of treeIds) {
		income += activity.get(id)?.income ?? 0;
		expense += activity.get(id)?.expense ?? 0;
	}
	return income > 0 && income >= expense ? 'income' : 'expense';
}

export function buildCategoryOverview(input: {
	categories: Category[];
	activity: CategoryActivityItem[];
	previous: CategoryActivityItem[];
	kind: CategoryKind;
}): CategoryOverview {
	const { categories, kind } = input;
	const now = new Map(input.activity.map((a) => [a.categoryId, a]));
	const before = new Map(input.previous.map((a) => [a.categoryId, a]));
	const byParent = new Map<string, Category[]>();
	for (const c of categories) {
		if (!c.parentId) continue;
		byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
	}

	function build(category: Category, rootKind: CategoryKind, seen: Set<string>): CategoryRow {
		seen.add(category.id);
		const own = figures(now.get(category.id), kind);
		const ownBefore = figures(before.get(category.id), kind);
		const children = (byParent.get(category.id) ?? [])
			.filter((child) => !seen.has(child.id))
			.map((child) => build(child, rootKind, seen))
			.sort(
				(a, b) => b.totalAmount - a.totalAmount || a.category.name.localeCompare(b.category.name)
			);
		return {
			category,
			ownAmount: own.amount,
			ownCount: own.count,
			totalAmount: own.amount + children.reduce((sum, c) => sum + c.totalAmount, 0),
			totalCount: own.count + children.reduce((sum, c) => sum + c.totalCount, 0),
			previousTotal: ownBefore.amount + children.reduce((sum, c) => sum + c.previousTotal, 0),
			children,
			kind: rootKind
		};
	}

	function treeIds(root: Category): string[] {
		const ids: string[] = [];
		const queue = [root];
		const seen = new Set<string>();
		while (queue.length > 0) {
			const next = queue.shift()!;
			if (seen.has(next.id)) continue;
			seen.add(next.id);
			ids.push(next.id);
			queue.push(...(byParent.get(next.id) ?? []));
		}
		return ids;
	}

	const rows = topLevelOf(categories)
		.filter((root) => kindOfTree(root, treeIds(root), now) === kind)
		.map((root) => build(root, kind, new Set()));

	const uncategorized = figures(now.get(UNCATEGORIZED_CATEGORY_ID), kind);
	const uncategorizedBefore = figures(before.get(UNCATEGORIZED_CATEGORY_ID), kind);
	return {
		kind,
		rows,
		total: rows.reduce((sum, r) => sum + r.totalAmount, 0) + uncategorized.amount,
		previousTotal: rows.reduce((sum, r) => sum + r.previousTotal, 0) + uncategorizedBefore.amount,
		uncategorized: {
			amount: uncategorized.amount,
			count: uncategorized.count,
			previousAmount: uncategorizedBefore.amount
		}
	};
}

/** Orders the top-level rows: biggest first (then by name), or alphabetically. */
export function sortCategoryRows(rows: CategoryRow[], sort: 'amount' | 'name'): CategoryRow[] {
	return [...rows].sort((a, b) =>
		sort === 'name'
			? a.category.name.localeCompare(b.category.name, undefined, { sensitivity: 'base' })
			: b.totalAmount - a.totalAmount ||
				a.category.name.localeCompare(b.category.name, undefined, { sensitivity: 'base' })
	);
}

/** The ids of every row (at any depth) whose full path matches the typed words, plus the ancestors
 *  that lead to them — what stays on screen while the user searches. */
export function idsMatching(
	rows: CategoryRow[],
	labels: Map<string, string>,
	matches: (label: string) => boolean
): { visible: Set<string>; direct: Set<string> } {
	const visible = new Set<string>();
	const direct = new Set<string>();
	function walk(row: CategoryRow): boolean {
		const own = matches(labels.get(row.category.id) ?? row.category.name);
		let childHit = false;
		for (const child of row.children) if (walk(child)) childHit = true;
		if (own) direct.add(row.category.id);
		if (own || childHit) visible.add(row.category.id);
		return own || childHit;
	}
	for (const row of rows) walk(row);
	return { visible, direct };
}
