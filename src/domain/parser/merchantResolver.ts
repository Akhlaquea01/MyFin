import { MerchantRepository, MerchantAliasRepository } from '../../data/dexie/merchantRepository';

export interface ResolvedMerchant {
	merchantId: string;
	aliasId: string;
}

/**
 * Resolves raw parsed merchant text (e.g. "AMAZON") to a canonical Merchant, creating one
 * (and an alias pointing back to this exact raw text) the first time it's seen, and
 * reusing the existing Merchant on subsequent sightings of the same or a known alias.
 * This is what lets differently worded references from parsed text converge on one
 * merchant (data-model.md's MerchantAlias).
 *
 * Returns the matched/created alias's id alongside the merchant id (spec 006, research.md
 * §1) so callers can pass both into the categorization engine, which needs to know
 * specifically *which* alias matched to support alias-scoped rules.
 */
export async function resolveMerchant(
	key: CryptoKey,
	rawMerchantText: string
): Promise<ResolvedMerchant> {
	const existingAlias = await MerchantAliasRepository.findByAliasText(key, rawMerchantText);
	if (existingAlias) return { merchantId: existingAlias.merchantId, aliasId: existingAlias.id };

	const merchant = await MerchantRepository.create(key, rawMerchantText.trim());
	const alias = await MerchantAliasRepository.create(key, merchant.id, rawMerchantText.trim());
	return { merchantId: merchant.id, aliasId: alias.id };
}
