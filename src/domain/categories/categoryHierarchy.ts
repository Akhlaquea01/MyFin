import type { Category } from '../entities';
import { normalizeMatchText } from '../categorization/keywordMatching';

// Categories form a tree (`parentId`), and until now nothing but the Categories page knew it: a
// budget on "Food" counted only spending filed directly under "Food", a chart showed "Groceries"
// with no hint it belonged to anything, and two parents each with an "Other" child produced two
// indistinguishable "Other" slices. These pure helpers are the one place that understands the tree.
//
// Every function takes the LIVE categories (what `CategoryRepository.list` returns). A child whose
// parent has been deleted is treated as top-level rather than as an error — its parent is simply
// not there to be a parent any more — and a cycle (which the UI cannot produce but a hand-edited
// import could) is cut instead of looping forever.

export const CATEGORY_PATH_SEPARATOR = ' › ';

function indexById(categories: Category[]): Map<string, Category> {
	return new Map(categories.map((c) => [c.id, c]));
}

/** The chain from `id` up to its topmost live ancestor, nearest first, `id` itself included. */
function chainToRoot(byId: Map<string, Category>, id: string): Category[] {
	const chain: Category[] = [];
	const seen = new Set<string>();
	let current = byId.get(id);
	while (current && !seen.has(current.id)) {
		seen.add(current.id);
		chain.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return chain;
}

/** "Food › Groceries" for a child, plain "Food" for a top-level category. */
export function buildCategoryLabels(categories: Category[]): Map<string, string> {
	const byId = indexById(categories);
	const labels = new Map<string, string>();
	for (const category of categories) {
		labels.set(
			category.id,
			chainToRoot(byId, category.id)
				.map((c) => c.name)
				.reverse()
				.join(CATEGORY_PATH_SEPARATOR)
		);
	}
	return labels;
}

/** `categories` ordered by their full label, so every child sits directly under its parent. */
export function sortCategoriesByLabel(
	categories: Category[],
	labels: Map<string, string> = buildCategoryLabels(categories)
): Category[] {
	return [...categories].sort((a, b) =>
		(labels.get(a.id) ?? a.name).localeCompare(labels.get(b.id) ?? b.name, undefined, {
			sensitivity: 'base'
		})
	);
}

/** `rootId` plus every live category below it, at any depth. Just `[rootId]` if it has none. */
export function categoryWithDescendantIds(categories: Category[], rootId: string): string[] {
	const childrenByParent = new Map<string, string[]>();
	for (const category of categories) {
		if (!category.parentId) continue;
		const siblings = childrenByParent.get(category.parentId) ?? [];
		siblings.push(category.id);
		childrenByParent.set(category.parentId, siblings);
	}
	const result: string[] = [];
	const seen = new Set<string>();
	const queue = [rootId];
	while (queue.length > 0) {
		const id = queue.shift()!;
		if (seen.has(id)) continue;
		seen.add(id);
		result.push(id);
		queue.push(...(childrenByParent.get(id) ?? []));
	}
	return result;
}

/** Live ancestors of `id`, nearest first (parent, grandparent, …). Empty for a top-level category. */
export function ancestorIds(categories: Category[], id: string): string[] {
	return chainToRoot(indexById(categories), id)
		.slice(1)
		.map((c) => c.id);
}

/** The topmost live ancestor of `id` — `id` itself when it is top-level, orphaned or unknown. */
export function topLevelAncestorId(categories: Category[], id: string): string {
	const chain = chainToRoot(indexById(categories), id);
	return chain.length > 0 ? chain[chain.length - 1].id : id;
}

/** What a category picker shows: every category with its full-path label, children under parents. */
export function categoryOptions(categories: Category[]): { id: string; label: string }[] {
	const labels = buildCategoryLabels(categories);
	return sortCategoriesByLabel(categories, labels).map((c) => ({
		id: c.id,
		label: labels.get(c.id) ?? c.name
	}));
}

/**
 * The picker options matching what the user typed. Every typed word must begin a word of the
 * full path, so "gro" finds "Food › Groceries" and "fo gr" narrows to it, while "ood" finds
 * nothing. Options that start with the whole query come first; otherwise tree order is kept.
 */
export function filterCategoryOptions<T extends { label: string }>(
	options: T[],
	query: string
): T[] {
	const words = normalizeMatchText(query).split(' ').filter(Boolean);
	if (words.length === 0) return options;
	const whole = words.join(' ');
	const matches = options.filter((option) => {
		const labelWords = normalizeMatchText(option.label).split(' ');
		return words.every((word) => labelWords.some((labelWord) => labelWord.startsWith(word)));
	});
	const startsWithQuery = (option: T) => normalizeMatchText(option.label).startsWith(whole);
	return [...matches.filter(startsWithQuery), ...matches.filter((o) => !startsWithQuery(o))];
}
