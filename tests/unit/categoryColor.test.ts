import { describe, it, expect } from 'vitest';
import {
	buildCategoryColors,
	categoryColorOf,
	CATEGORY_COLOR_COUNT,
	NEUTRAL_CATEGORY_COLOR
} from '../../src/domain/categories/categoryColor';
import type { Category } from '../../src/domain/entities';

const cat = (id: string, createdAt: number, parentId: string | null = null): Category => ({
	id,
	name: id,
	parentId,
	icon: null,
	createdAt,
	updatedAt: 0
});

describe('buildCategoryColors', () => {
	it('gives top-level categories distinct hues in creation order', () => {
		const colors = buildCategoryColors([cat('b', 20), cat('a', 10), cat('c', 30)]);
		expect(colors.get('a')).toBe('var(--cat-1)');
		expect(colors.get('b')).toBe('var(--cat-2)');
		expect(colors.get('c')).toBe('var(--cat-3)');
	});

	it('does not move an existing category when a newer one is added', () => {
		const before = buildCategoryColors([cat('a', 10), cat('b', 20)]);
		const after = buildCategoryColors([cat('a', 10), cat('b', 20), cat('c', 30)]);
		expect(after.get('a')).toBe(before.get('a'));
		expect(after.get('b')).toBe(before.get('b'));
	});

	it('lets a subcategory, at any depth, inherit its top-level category colour', () => {
		const colors = buildCategoryColors([
			cat('food', 10),
			cat('groceries', 11, 'food'),
			cat('fruit', 12, 'groceries'),
			cat('travel', 20)
		]);
		expect(colors.get('groceries')).toBe(colors.get('food'));
		expect(colors.get('fruit')).toBe(colors.get('food'));
		expect(colors.get('travel')).not.toBe(colors.get('food'));
	});

	it('treats a child whose parent is gone as top-level', () => {
		const colors = buildCategoryColors([cat('orphan', 10, 'deleted-parent'), cat('b', 20)]);
		expect(colors.get('orphan')).toBe('var(--cat-1)');
		expect(colors.get('b')).toBe('var(--cat-2)');
	});

	it('leaves categories past the palette neutral instead of repeating a hue', () => {
		const many = Array.from({ length: CATEGORY_COLOR_COUNT + 2 }, (_, i) => cat(`c${i}`, i));
		const colors = buildCategoryColors(many);
		expect(colors.get(`c${CATEGORY_COLOR_COUNT - 1}`)).toBe(`var(--cat-${CATEGORY_COLOR_COUNT})`);
		expect(colors.get(`c${CATEGORY_COLOR_COUNT}`)).toBe(NEUTRAL_CATEGORY_COLOR);
		expect(colors.get(`c${CATEGORY_COLOR_COUNT + 1}`)).toBe(NEUTRAL_CATEGORY_COLOR);
		const coloured = [...colors.values()].filter((c) => c !== NEUTRAL_CATEGORY_COLOR);
		expect(new Set(coloured).size).toBe(CATEGORY_COLOR_COUNT);
	});
});

describe('categoryColorOf', () => {
	it('falls back to a neutral colour for uncategorized, unknown or missing ids', () => {
		const colors = buildCategoryColors([cat('a', 1)]);
		expect(categoryColorOf(colors, 'a')).toBe('var(--cat-1)');
		expect(categoryColorOf(colors, '__uncategorized__')).toBe(NEUTRAL_CATEGORY_COLOR);
		expect(categoryColorOf(colors, undefined)).toBe(NEUTRAL_CATEGORY_COLOR);
		expect(categoryColorOf(colors, null)).toBe(NEUTRAL_CATEGORY_COLOR);
	});
});
