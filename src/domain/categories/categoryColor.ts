import type { Category } from '../entities';
import { topLevelAncestorId } from './categoryHierarchy';

/** Hues defined as `--cat-1` … `--cat-8` in index.css: the most that stay tellable apart. */
export const CATEGORY_COLOR_COUNT = 8;

/** The palette keys a category can be given: `cat-1` … `cat-8`. */
export const CATEGORY_COLOR_KEYS = Array.from(
	{ length: CATEGORY_COLOR_COUNT },
	(_, i) => `cat-${i + 1}`
);

/** The CSS value for a palette key, or null if `key` is not one. */
export function cssColorForKey(key: string | null | undefined): string | null {
	return key && CATEGORY_COLOR_KEYS.includes(key) ? `var(--${key})` : null;
}

/** What an uncategorized or unknown category is drawn with. */
export const NEUTRAL_CATEGORY_COLOR = 'var(--muted-foreground)';

/**
 * A colour for every category, as a CSS value, so a category looks the same on every screen and
 * chart. A top-level category the user gave a colour keeps it; the others take the remaining
 * palette slots in creation order, so an automatic colour never repeats a chosen one. A subcategory
 * inherits its parent's colour, which keeps a branch of the tree readable as one colour. Past eight
 * top-level categories the rest stay neutral instead of repeating a hue (a repeated hue would make
 * two categories look like one). With no colour chosen anywhere nothing is stored: the colour
 * follows from the list, so it needs no migration and cannot disagree with the data.
 */
export function buildCategoryColors(categories: Category[]): Map<string, string> {
	const topLevel = categories
		.filter((c) => topLevelAncestorId(categories, c.id) === c.id)
		.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	const colorByRoot = new Map<string, string>();
	const taken = new Set<string>();
	for (const root of topLevel) {
		const chosen = cssColorForKey(root.color);
		if (chosen) {
			colorByRoot.set(root.id, chosen);
			taken.add(chosen);
		}
	}
	const free = CATEGORY_COLOR_KEYS.map((k) => `var(--${k})`).filter((c) => !taken.has(c));
	let next = 0;
	for (const root of topLevel) {
		if (colorByRoot.has(root.id)) continue;
		colorByRoot.set(root.id, next < free.length ? free[next++] : NEUTRAL_CATEGORY_COLOR);
	}
	return new Map(
		categories.map((c) => [
			c.id,
			colorByRoot.get(topLevelAncestorId(categories, c.id)) ?? NEUTRAL_CATEGORY_COLOR
		])
	);
}

export function categoryColorOf(
	colors: Map<string, string>,
	id: string | null | undefined
): string {
	return (id && colors.get(id)) || NEUTRAL_CATEGORY_COLOR;
}
