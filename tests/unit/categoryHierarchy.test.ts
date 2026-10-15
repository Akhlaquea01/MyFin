import { describe, it, expect } from 'vitest';
import {
	ancestorIds,
	buildCategoryLabels,
	categoryOptions,
	categoryWithDescendantIds,
	filterCategoryOptions,
	sortCategoriesByLabel,
	topLevelAncestorId
} from '../../src/domain/categories/categoryHierarchy';
import type { Category } from '../../src/domain/entities';

function cat(id: string, name: string, parentId: string | null = null): Category {
	return { id, name, parentId, icon: null, createdAt: 0, updatedAt: 0, deletedAt: null };
}

const food = cat('food', 'Food');
const groceries = cat('groceries', 'Groceries', 'food');
const dining = cat('dining', 'Dining out', 'food');
const fruit = cat('fruit', 'Fruit', 'groceries'); // a third level
const travel = cat('travel', 'Travel');
const travelOther = cat('travel-other', 'Other', 'travel');
const foodOther = cat('food-other', 'Other', 'food');
const all = [travel, foodOther, fruit, dining, groceries, food, travelOther];

describe('buildCategoryLabels', () => {
	it('shows the full path for a child and the plain name for a top-level category', () => {
		const labels = buildCategoryLabels(all);
		expect(labels.get('food')).toBe('Food');
		expect(labels.get('groceries')).toBe('Food › Groceries');
		expect(labels.get('fruit')).toBe('Food › Groceries › Fruit');
	});

	it('tells two categories with the same name apart', () => {
		const labels = buildCategoryLabels(all);
		expect(labels.get('food-other')).toBe('Food › Other');
		expect(labels.get('travel-other')).toBe('Travel › Other');
	});

	it('treats a child whose parent is no longer there as top-level', () => {
		const labels = buildCategoryLabels([groceries]); // "Food" deleted
		expect(labels.get('groceries')).toBe('Groceries');
	});

	it('does not loop on a cycle', () => {
		const a = cat('a', 'A', 'b');
		const b = cat('b', 'B', 'a');
		const labels = buildCategoryLabels([a, b]);
		expect(labels.get('a')).toBe('B › A');
		expect(labels.get('b')).toBe('A › B');
	});
});

describe('sortCategoriesByLabel', () => {
	it('puts every child directly under its parent', () => {
		const sorted = sortCategoriesByLabel(all).map((c) => c.id);
		expect(sorted).toEqual([
			'food',
			'dining', // Food › Dining out
			'groceries', // Food › Groceries
			'fruit', // Food › Groceries › Fruit
			'food-other', // Food › Other
			'travel',
			'travel-other'
		]);
	});

	it('does not mutate its input', () => {
		const copy = [...all];
		sortCategoriesByLabel(all);
		expect(all).toEqual(copy);
	});
});

describe('categoryWithDescendantIds', () => {
	it('returns the category and everything below it, at any depth', () => {
		expect(new Set(categoryWithDescendantIds(all, 'food'))).toEqual(
			new Set(['food', 'groceries', 'dining', 'fruit', 'food-other'])
		);
		expect(new Set(categoryWithDescendantIds(all, 'groceries'))).toEqual(
			new Set(['groceries', 'fruit'])
		);
	});

	it('is just the category itself when it has no children', () => {
		expect(categoryWithDescendantIds(all, 'fruit')).toEqual(['fruit']);
		expect(categoryWithDescendantIds(all, 'unknown')).toEqual(['unknown']);
	});

	it('never includes a sibling branch', () => {
		expect(categoryWithDescendantIds(all, 'food')).not.toContain('travel-other');
	});

	it('does not loop on a cycle', () => {
		const a = cat('a', 'A', 'b');
		const b = cat('b', 'B', 'a');
		expect(new Set(categoryWithDescendantIds([a, b], 'a'))).toEqual(new Set(['a', 'b']));
	});
});

describe('ancestorIds / topLevelAncestorId', () => {
	it('lists ancestors nearest first and finds the top level', () => {
		expect(ancestorIds(all, 'fruit')).toEqual(['groceries', 'food']);
		expect(ancestorIds(all, 'food')).toEqual([]);
		expect(topLevelAncestorId(all, 'fruit')).toBe('food');
		expect(topLevelAncestorId(all, 'food')).toBe('food');
		expect(topLevelAncestorId(all, 'travel-other')).toBe('travel');
	});

	it('stops at a deleted parent and returns the id itself when unknown', () => {
		expect(topLevelAncestorId([groceries, fruit], 'fruit')).toBe('groceries');
		expect(topLevelAncestorId(all, 'deleted-category')).toBe('deleted-category');
	});
});

describe('filterCategoryOptions', () => {
	const options = categoryOptions(all);
	const labels = (query: string) => filterCategoryOptions(options, query).map((o) => o.label);

	it('returns every option, in tree order, for an empty query', () => {
		expect(labels('')).toEqual(options.map((o) => o.label));
		expect(labels('   ')).toEqual(options.map((o) => o.label));
	});

	it('matches the start of any word of the full path', () => {
		expect(labels('gro')).toEqual(['Food › Groceries', 'Food › Groceries › Fruit']);
		expect(labels('fruit')).toEqual(['Food › Groceries › Fruit']);
		expect(labels('out')).toEqual(['Food › Dining out']);
	});

	it('needs every typed word, in any order, to begin a word of the path', () => {
		expect(labels('food oth')).toEqual(['Food › Other']);
		expect(labels('oth food')).toEqual(['Food › Other']);
		expect(labels('travel gro')).toEqual([]);
	});

	it('does not match inside a word', () => {
		expect(labels('ood')).toEqual([]);
	});

	it('ignores case and punctuation, and lists paths that start with the query first', () => {
		expect(labels('  OTHER ')).toEqual(['Food › Other', 'Travel › Other']);
		expect(labels('travel › oth')).toEqual(['Travel › Other']);
		// "food" starts the path "Food › …" but only appears mid-path in none of these.
		expect(labels('food')[0]).toBe('Food');
	});

	it('puts a path that begins with the whole query ahead of one that merely contains its words', () => {
		const extra = [
			{ id: 'a', label: 'Gifts › Food' },
			{ id: 'b', label: 'Food › Gifts' }
		];
		expect(filterCategoryOptions(extra, 'food').map((o) => o.id)).toEqual(['b', 'a']);
	});
});
