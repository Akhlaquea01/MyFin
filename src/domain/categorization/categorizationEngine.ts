import type { CategorizationRule } from '../entities';

/** Consecutive confirmations to the same category required before a learned suggestion
 *  appears (spec.md's Assumption) — an internal constant, not user-facing (research.md §3),
 *  mirroring `quickAddParser.ts`'s `CONFIDENCE_THRESHOLD` precedent. */
export const MIN_STREAK = 3;

/**
 * Derives a learned suggestion from a merchant's recent confirmation history: the shared
 * category once `recentCategoryIds` has reached `minStreak` entries and every one of them
 * is identical, otherwise `null`. Because the caller (`MerchantCategorySignalRepository`)
 * caps the array at exactly `minStreak` entries, this can never assert a streak shorter
 * than `minStreak` (SC-003) and an alternating/inconsistent history (Edge Case) never
 * satisfies it, with no separate "dominance ratio" needed. Never mutates its input; no I/O.
 */
export function deriveSuggestion(
	recentCategoryIds: string[],
	minStreak: number = MIN_STREAK
): string | null {
	if (recentCategoryIds.length < minStreak) return null;
	const candidate = recentCategoryIds[0];
	return recentCategoryIds.every((id) => id === candidate) ? candidate : null;
}

/**
 * Picks the best-matching rule for a resolved merchant/alias, per spec 006 Edge Case #2:
 * an alias-scoped rule (exact match) always beats a merchant-scoped one. `rules` must
 * already be narrowed to live, non-stale candidates for this merchant (see
 * `resolveCategorization`) — this function performs no filtering beyond precedence and no
 * I/O, and never mutates its input.
 */
export function pickBestRule(
	rules: CategorizationRule[],
	merchantId: string,
	aliasId: string | null
): CategorizationRule | null {
	const aliasMatch = rules.find(
		(rule) => rule.merchantAliasId !== null && rule.merchantAliasId === aliasId
	);
	if (aliasMatch) return aliasMatch;

	const merchantMatch = rules.find(
		(rule) => rule.merchantId === merchantId && rule.merchantAliasId === null
	);
	return merchantMatch ?? null;
}
