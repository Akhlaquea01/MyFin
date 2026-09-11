import { MerchantRepository, MerchantAliasRepository } from '../../data/dexie/merchantRepository';

export interface ResolvedMerchant {
	merchantId: string;
	aliasId: string;
}

/** Rails and instrument codes that prefix most Indian bank descriptions and carry no
 *  merchant identity. */
const RAIL_TOKENS = /\b(?:UPI|IMPS|NEFT|RTGS|POS|ATM|ACH|ECS|EMI|CHQ|DR|CR|REF|TXN|TRF|PMT)\b/gi;

/** The shortest string still worth treating as a merchant name. */
const MIN_MERCHANT_LENGTH = 3;

/**
 * Reduces a raw bank/statement description to something that can actually converge across
 * sightings — stripping the reference numbers, dates, and rail codes that make every line
 * unique.
 *
 * Without this, file import passed the full description straight to `resolveMerchant`, so a
 * 2,000-row statement produced ~2,000 Merchants and ~2,000 MerchantAliases: the alias model
 * never matched anything, the per-merchant learning signal could never reach a streak, and
 * every merchant picker in the UI filled with noise.
 *
 * Returns `null` when nothing name-like survives, which the caller treats as "no merchant"
 * rather than inventing one. The full original text is still kept on the transaction's notes.
 */
export function normalizeMerchantText(raw: string): string | null {
	// Order matters: dates must go before the long-digit-run rule, or that rule eats only the
	// year and leaves "12 08" behind as if it were part of the name.
	const cleaned = raw
		.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ') // embedded dates
		.replace(RAIL_TOKENS, ' ')
		.replace(/\b[\w-]*\d{4,}[\w-]*\b/g, ' ') // reference numbers / long digit runs
		.replace(/[^A-Za-z0-9 &.'-]+/g, ' ')
		.replace(/\b\d{1,3}\b/g, ' ') // short numeric fragments left over from the above
		.replace(/\s+/g, ' ')
		// Punctuation is kept mid-name ("M&S", "O'Brien", "St. Jude") but a leading or trailing
		// separator is always debris from a removed token, e.g. "NEFT-AMAZON" -> "-AMAZON".
		.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
		.trim();
	// Require a letter: "12 34" or "- ." is not a merchant name.
	if (cleaned.length < MIN_MERCHANT_LENGTH || !/[A-Za-z]/.test(cleaned)) return null;
	return cleaned.toUpperCase();
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
