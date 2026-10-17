// A short, sensible set of categories for someone starting from nothing. The app seeds none, and
// the larger "sample template" in sampleTemplate.ts carries a developer's test accounts and
// transactions, so first-run had no one-step way to get usable categories.
import { CategoryRepository } from '../dexie/categoryRepository';

/** A top-level category and its subcategories. Icons are keys from the Categories page's icon set. */
export interface StarterCategory {
	name: string;
	icon?: string;
	/** Income categories are listed under Income on the Categories page. */
	kind?: 'income';
	children?: { name: string; icon?: string }[];
}

export const STARTER_CATEGORIES: StarterCategory[] = [
	{
		name: 'Food & Dining',
		icon: 'utensils',
		children: [
			{ name: 'Groceries', icon: 'shopping-cart' },
			{ name: 'Restaurants', icon: 'coffee' }
		]
	},
	{
		name: 'Transport',
		icon: 'car',
		children: [
			{ name: 'Fuel', icon: 'fuel' },
			{ name: 'Public transport', icon: 'bus' }
		]
	},
	{
		name: 'Bills & Utilities',
		icon: 'receipt',
		children: [
			{ name: 'Electricity', icon: 'zap' },
			{ name: 'Mobile & internet', icon: 'smartphone' }
		]
	},
	{ name: 'Rent & Housing', icon: 'house' },
	{ name: 'Shopping', icon: 'shopping-bag' },
	{ name: 'Health', icon: 'heart-pulse' },
	{ name: 'Entertainment', icon: 'film' },
	{ name: 'Education', icon: 'graduation-cap' },
	{ name: 'Travel', icon: 'plane' },
	{ name: 'Salary', icon: 'briefcase', kind: 'income' },
	{ name: 'Other' }
];

/**
 * Adds the starter categories that do not exist yet (matched by name and parent, ignoring case),
 * so running it twice, or over categories the user already made, never creates duplicates.
 * Returns how many were added.
 */
export async function addStarterCategories(key: CryptoKey): Promise<number> {
	const existing = await CategoryRepository.list(key);
	const find = (name: string, parentId: string | null) =>
		existing.find(
			(c) => c.parentId === parentId && c.name.trim().toLowerCase() === name.toLowerCase()
		);

	let added = 0;
	for (const top of STARTER_CATEGORIES) {
		let parent = find(top.name, null);
		if (!parent) {
			parent = await CategoryRepository.create(key, {
				name: top.name,
				icon: top.icon ?? null,
				kind: top.kind
			});
			existing.push(parent);
			added += 1;
		}
		for (const childStarter of top.children ?? []) {
			if (find(childStarter.name, parent.id)) continue;
			const child = await CategoryRepository.create(key, {
				name: childStarter.name,
				parentId: parent.id,
				icon: childStarter.icon ?? null
			});
			existing.push(child);
			added += 1;
		}
	}
	return added;
}
