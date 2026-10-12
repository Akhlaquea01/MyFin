// A short, sensible set of categories for someone starting from nothing. The app seeds none, and
// the larger "sample template" in sampleTemplate.ts carries a developer's test accounts and
// transactions, so first-run had no one-step way to get usable categories.
import { CategoryRepository } from '../dexie/categoryRepository';

/** A top-level category and its subcategories. */
export interface StarterCategory {
	name: string;
	children?: string[];
}

export const STARTER_CATEGORIES: StarterCategory[] = [
	{ name: 'Food & Dining', children: ['Groceries', 'Restaurants'] },
	{ name: 'Transport', children: ['Fuel', 'Public transport'] },
	{ name: 'Bills & Utilities', children: ['Electricity', 'Mobile & internet'] },
	{ name: 'Rent & Housing' },
	{ name: 'Shopping' },
	{ name: 'Health' },
	{ name: 'Entertainment' },
	{ name: 'Education' },
	{ name: 'Travel' },
	{ name: 'Salary' },
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
			parent = await CategoryRepository.create(key, { name: top.name });
			existing.push(parent);
			added += 1;
		}
		for (const childName of top.children ?? []) {
			if (find(childName, parent.id)) continue;
			const child = await CategoryRepository.create(key, { name: childName, parentId: parent.id });
			existing.push(child);
			added += 1;
		}
	}
	return added;
}
