import { MerchantRepository, MerchantAliasRepository } from '../../data/dexie/merchantRepository';

/**
 * Resolves raw parsed merchant text (e.g. "AMAZON") to a canonical Merchant, creating one
 * (and an alias pointing back to this exact raw text) the first time it's seen, and
 * reusing the existing Merchant on subsequent sightings of the same or a known alias.
 * This is what lets differently worded references from parsed text converge on one
 * merchant (data-model.md's MerchantAlias).
 */
export async function resolveMerchant(key: CryptoKey, rawMerchantText: string): Promise<string> {
	const existingAlias = await MerchantAliasRepository.findByAliasText(key, rawMerchantText);
	if (existingAlias) return existingAlias.merchantId;

	const merchant = await MerchantRepository.create(key, rawMerchantText.trim());
	await MerchantAliasRepository.create(key, merchant.id, rawMerchantText.trim());
	return merchant.id;
}
