import type { Category } from '../entities';
import { topLevelAncestorId } from './categoryHierarchy';

/** Hues defined as `--cat-1` … `--cat-12` in index.css. */
export const CATEGORY_COLOR_COUNT = 12;

/** What an uncategorized or unknown category is drawn with. */
export const NEUTRAL_CATEGORY_COLOR = 'var(--muted-foreground)';

/**
 * A colour for every category, as a CSS value, so a category looks the same on every screen and
 * chart. Top-level categories take palette slots in creation order (no two share a hue until there
 * are more than twelve); a subcategory inherits its parent's colour, which keeps a branch of the
 * tree readable as one colour. Nothing is stored: the colour follows from the list, so it needs no
 * migration and cannot disagree with the data.
 */
export function buildCategoryColors(categories: Category[]): Map<string, string> {
	const topLevel = categories
		.filter((c) => topLevelAncestorId(categories, c.id) === c.id)
		.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	const colorByRoot = new Map(
		topLevel.map((c, i) => [c.id, `var(--cat-${(i % CATEGORY_COLOR_COUNT) + 1})`])
	);
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
