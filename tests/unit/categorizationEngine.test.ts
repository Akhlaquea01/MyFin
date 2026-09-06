import { describe, it, expect } from 'vitest';
import { pickBestRule, deriveSuggestion, MIN_STREAK } from '../../src/domain/categorization/categorizationEngine';
import type { CategorizationRule } from '../../src/domain/entities';

function makeRule(overrides: Partial<CategorizationRule>): CategorizationRule {
	const now = Date.now();
	return {
		id: overrides.id ?? crypto.randomUUID(),
		merchantId: 'merchant-1',
		merchantAliasId: null,
		categoryId: 'category-1',
		tagIds: [],
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
		...overrides
	};
}

describe('pickBestRule', () => {
	it('prefers an alias-scoped rule over a merchant-scoped rule for the same merchant', () => {
		const merchantRule = makeRule({ id: 'r-merchant', categoryId: 'cat-broad' });
		const aliasRule = makeRule({
			id: 'r-alias',
			merchantAliasId: 'alias-1',
			categoryId: 'cat-specific'
		});
		const result = pickBestRule([merchantRule, aliasRule], 'merchant-1', 'alias-1');
		expect(result?.id).toBe('r-alias');
	});

	it('falls back to a merchant-scoped rule when no alias-scoped rule matches', () => {
		const merchantRule = makeRule({ id: 'r-merchant' });
		const otherAliasRule = makeRule({ id: 'r-other-alias', merchantAliasId: 'alias-2' });
		const result = pickBestRule([merchantRule, otherAliasRule], 'merchant-1', 'alias-1');
		expect(result?.id).toBe('r-merchant');
	});

	it('returns null when no rule matches at all', () => {
		const result = pickBestRule([], 'merchant-1', 'alias-1');
		expect(result).toBeNull();
	});

	it('returns null when only rules for a different merchant exist', () => {
		const otherMerchantRule = makeRule({ id: 'r-other', merchantId: 'merchant-2' });
		const result = pickBestRule([otherMerchantRule], 'merchant-1', 'alias-1');
		expect(result).toBeNull();
	});
});

describe('deriveSuggestion', () => {
	it('returns the shared category once MIN_STREAK identical entries are present', () => {
		const ids = Array(MIN_STREAK).fill('category-a');
		expect(deriveSuggestion(ids)).toBe('category-a');
	});

	it('returns null below the streak threshold', () => {
		const ids = Array(MIN_STREAK - 1).fill('category-a');
		expect(deriveSuggestion(ids)).toBeNull();
	});

	it('returns null for an alternating (non-dominant) history, however long', () => {
		const ids = ['category-a', 'category-b', 'category-a', 'category-b', 'category-a'];
		expect(deriveSuggestion(ids)).toBeNull();
	});

	it('returns null for an empty history', () => {
		expect(deriveSuggestion([])).toBeNull();
	});
});
