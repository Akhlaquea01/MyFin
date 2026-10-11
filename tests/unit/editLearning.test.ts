import { describe, it, expect } from 'vitest';
import { shouldLearnFromEdit } from '../../src/domain/transactions/editLearning';

const base = {
	reviewStatus: 'confirmed' as const,
	isSplit: false,
	categoryChanged: true,
	categoryId: 'cat-food',
	uncategorizedId: 'uncategorized',
	hasMerchant: true
};

describe('shouldLearnFromEdit', () => {
	it('learns from a category corrected by hand on a confirmed entry', () => {
		expect(shouldLearnFromEdit(base)).toBe(true);
	});

	it('does not learn from an entry still waiting in Review, where Confirm records the choice', () => {
		expect(shouldLearnFromEdit({ ...base, reviewStatus: 'unreviewed' })).toBe(false);
	});

	it('needs an actual category change', () => {
		expect(shouldLearnFromEdit({ ...base, categoryChanged: false })).toBe(false);
	});

	it('does not learn "uncategorized"', () => {
		expect(shouldLearnFromEdit({ ...base, categoryId: 'uncategorized' })).toBe(false);
	});

	it('needs a merchant to attach the lesson to', () => {
		expect(shouldLearnFromEdit({ ...base, hasMerchant: false })).toBe(false);
	});

	it('does not learn from a split entry', () => {
		expect(shouldLearnFromEdit({ ...base, isSplit: true })).toBe(false);
	});
});
