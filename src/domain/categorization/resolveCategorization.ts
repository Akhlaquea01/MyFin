import { pickBestRule, deriveSuggestion, MIN_STREAK } from './categorizationEngine';
import { CategorizationRuleRepository } from '../../data/dexie/categorizationRuleRepository';
import { CategoryRepository } from '../../data/dexie/categoryRepository';
import { MerchantCategorySignalRepository } from '../../data/dexie/merchantCategorySignalRepository';
import type { CategorizationRule } from '../entities';
import type { CategorizationResult } from './types';

async function nonStaleRules(
	key: CryptoKey,
	rules: CategorizationRule[]
): Promise<CategorizationRule[]> {
	const results = await Promise.all(
		rules.map(async (rule) => {
			const category = await CategoryRepository.getById(key, rule.categoryId);
			const stale = !category || category.deletedAt !== null;
			return stale ? null : rule;
		})
	);
	return results.filter((rule): rule is CategorizationRule => rule !== null);
}

/**
 * Resolves what (if anything) should pre-fill a newly proposed transaction from this
 * merchant/alias, per contracts/categorization-engine.md: an explicit rule always wins
 * (FR-005); a rule whose target category was soft-deleted never applies (FR-009). Returns
 * `null` when nothing should be pre-filled — the caller falls through to today's
 * `__uncategorized__` default. Never throws for "nothing found" cases.
 */
export async function resolveCategorization(
	key: CryptoKey,
	merchantId: string,
	aliasId: string | null
): Promise<CategorizationResult | null> {
	const candidates = await CategorizationRuleRepository.listForMerchant(key, merchantId);
	const liveCandidates = await nonStaleRules(key, candidates);
	const rule = pickBestRule(liveCandidates, merchantId, aliasId);
	if (rule) {
		return { categoryId: rule.categoryId, tagIds: rule.tagIds, source: 'rule' };
	}

	// No rule — fall back to a learned suggestion (Story 2), only when it's active
	// (a real streak) and its category hasn't gone stale.
	const signal = await MerchantCategorySignalRepository.get(key, merchantId);
	if (signal) {
		const suggestedCategoryId = deriveSuggestion(signal.recentCategoryIds);
		if (suggestedCategoryId) {
			const category = await CategoryRepository.getById(key, suggestedCategoryId);
			if (category && category.deletedAt === null) {
				return { categoryId: suggestedCategoryId, tagIds: [], source: 'suggestion' };
			}
		}
	}

	return null;
}

/**
 * Feeds a transaction's final confirmed category back into its merchant's learning signal
 * (FR-003/FR-007) — called once per confirmation, regardless of whether the category came
 * from a rule, a suggestion, or the user's own manual choice/override. Capping the streak at
 * `MIN_STREAK` (FIFO) is a domain decision, not a storage concern — the repository just
 * persists whatever array it's given (research.md §3).
 */
export async function recordConfirmation(
	key: CryptoKey,
	merchantId: string,
	categoryId: string
): Promise<void> {
	const existing = await MerchantCategorySignalRepository.get(key, merchantId);
	const recentCategoryIds = [...(existing?.recentCategoryIds ?? []), categoryId].slice(
		-MIN_STREAK
	);
	await MerchantCategorySignalRepository.set(key, merchantId, recentCategoryIds);
}

/** Every merchant whose derived suggestion is non-null and whose category isn't stale — for
 *  the management UI (Story 3). */
export async function listSuggestions(
	key: CryptoKey
): Promise<{ merchantId: string; categoryId: string }[]> {
	const signals = await MerchantCategorySignalRepository.listAll(key);
	const results: { merchantId: string; categoryId: string }[] = [];
	for (const signal of signals) {
		const categoryId = deriveSuggestion(signal.recentCategoryIds);
		if (!categoryId) continue;
		const category = await CategoryRepository.getById(key, categoryId);
		if (!category || category.deletedAt !== null) continue;
		results.push({ merchantId: signal.id, categoryId });
	}
	return results;
}
