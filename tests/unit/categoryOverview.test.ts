import { describe, it, expect } from 'vitest';
import {
	buildCategoryOverview,
	idsMatching,
	sortCategoryRows
} from '../../src/domain/categories/categoryOverview';
import type { CategoryActivityItem } from '../../src/domain/analytics/analyticsEngine';
import type { Category } from '../../src/domain/entities';

const cat = (
	id: string,
	parentId: string | null = null,
	extra: Partial<Category> = {}
): Category => ({
	id,
	name: id,
	parentId,
	icon: null,
	createdAt: 0,
	updatedAt: 0,
	...extra
});
const act = (
	categoryId: string,
	expense: number,
	income = 0,
	expenseCount = expense > 0 ? 1 : 0,
	incomeCount = income > 0 ? 1 : 0
): CategoryActivityItem => ({ categoryId, expense, income, expenseCount, incomeCount });

const categories = [
	cat('food'),
	cat('groceries', 'food'),
	cat('dining', 'food'),
	cat('transport'),
	cat('salary'),
	cat('gifts', null, { kind: 'income' })
];

describe('buildCategoryOverview', () => {
	it('folds subcategories into their parent and totals this month against the last', () => {
		const overview = buildCategoryOverview({
			categories,
			kind: 'expense',
			activity: [
				act('food', 1_000),
				act('groceries', 5_000, 0, 3),
				act('dining', 2_000),
				act('transport', 4_000)
			],
			previous: [act('groceries', 4_000), act('transport', 6_000)]
		});
		const food = overview.rows.find((r) => r.category.id === 'food')!;
		expect(food).toMatchObject({
			ownAmount: 1_000,
			totalAmount: 8_000,
			totalCount: 5,
			previousTotal: 4_000
		});
		// Children are listed biggest first.
		expect(food.children.map((c) => c.category.id)).toEqual(['groceries', 'dining']);
		expect(overview.total).toBe(12_000);
		expect(overview.previousTotal).toBe(10_000);
	});

	it('puts a category in the list it belongs to: chosen, or inferred from what it received', () => {
		const activity = [act('salary', 0, 90_000), act('food', 100)];
		const spending = buildCategoryOverview({ categories, kind: 'expense', activity, previous: [] });
		const income = buildCategoryOverview({ categories, kind: 'income', activity, previous: [] });
		expect(spending.rows.map((r) => r.category.id).sort()).toEqual(['food', 'transport']);
		// "salary" only ever received money; "gifts" says so itself; an empty "transport" stays under Spending.
		expect(income.rows.map((r) => r.category.id).sort()).toEqual(['gifts', 'salary']);
		expect(income.total).toBe(90_000);
	});

	it('reports uncategorized money separately but counts it in the total', () => {
		const overview = buildCategoryOverview({
			categories,
			kind: 'expense',
			activity: [act('food', 1_000), act('__uncategorized__', 700, 0, 2)],
			previous: [act('__uncategorized__', 300)]
		});
		expect(overview.uncategorized).toEqual({ amount: 700, count: 2, previousAmount: 300 });
		expect(overview.total).toBe(1_700);
		expect(overview.previousTotal).toBe(300);
	});

	it('shows a category whose parent is gone at the top level', () => {
		const overview = buildCategoryOverview({
			categories: [cat('orphan', 'deleted-parent')],
			kind: 'expense',
			activity: [act('orphan', 50)],
			previous: []
		});
		expect(overview.rows.map((r) => r.category.id)).toEqual(['orphan']);
	});

	it('does not loop on a cycle in imported data', () => {
		const overview = buildCategoryOverview({
			categories: [cat('a', 'b'), cat('b', 'a')],
			kind: 'expense',
			activity: [act('a', 10), act('b', 20)],
			previous: []
		});
		// Neither is top-level, so neither is drawn — but it terminates.
		expect(overview.rows).toEqual([]);
	});
});

describe('sortCategoryRows', () => {
	it('orders biggest first by default, then by name, or alphabetically on request', () => {
		const { rows } = buildCategoryOverview({
			categories: [cat('b'), cat('a'), cat('c')],
			kind: 'expense',
			activity: [act('a', 100), act('b', 300), act('c', 100)],
			previous: []
		});
		expect(sortCategoryRows(rows, 'amount').map((r) => r.category.id)).toEqual(['b', 'a', 'c']);
		expect(sortCategoryRows(rows, 'name').map((r) => r.category.id)).toEqual(['a', 'b', 'c']);
	});
});

describe('idsMatching', () => {
	it('keeps a parent on screen when only its child matches, and says which ones matched', () => {
		const { rows } = buildCategoryOverview({
			categories,
			kind: 'expense',
			activity: [],
			previous: []
		});
		const labels = new Map([
			['food', 'food'],
			['groceries', 'food › groceries'],
			['dining', 'food › dining'],
			['transport', 'transport']
		]);
		const { visible, direct } = idsMatching(rows, labels, (label) => label.includes('groc'));
		expect([...visible].sort()).toEqual(['food', 'groceries']);
		expect([...direct]).toEqual(['groceries']);
	});
});
