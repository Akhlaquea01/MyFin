import { pickBestRule, deriveSuggestion, MIN_STREAK } from './categorizationEngine';
import { normalizeMatchText, pickKeywordRule, textMatchesKeyword } from './keywordMatching';
import { CategorizationRuleRepository } from '../../data/dexie/categorizationRuleRepository';
import { CategoryRepository } from '../../data/dexie/categoryRepository';
import { MerchantRepository } from '../../data/dexie/merchantRepository';
import { MerchantCategorySignalRepository } from '../../data/dexie/merchantCategorySignalRepository';
import { TransactionRepository } from '../../data/dexie/transactionRepository';
import { TransactionTagRepository } from '../../data/dexie/tagRepository';
import type { CategorizationRule } from '../entities';
import type { CategorizationResult } from './types';

async function nonStaleRules(
	key: CryptoKey,
	rules: CategorizationRule[]
): Promise<CategorizationRule[]> {
	const results = await Promise.all(
		rules.map(async (rule) => {
			const category = await CategoryRepository.getById(key, rule.categoryId);
			return category ? rule : null;
		})
	);
	return results.filter((rule): rule is CategorizationRule => rule !== null);
}

/** Live keyword rules whose target category still exists. */
async function loadKeywordRules(key: CryptoKey): Promise<CategorizationRule[]> {
	return nonStaleRules(key, await CategorizationRuleRepository.listKeywordRules(key));
}

/** What the resolver is asked about: the entry's merchant (if any) and its description. */
export interface CategorizationInput {
	merchantId: string | null;
	aliasId?: string | null;
	/** The entry's description — what a keyword rule is matched against. */
	notes?: string | null;
	/** The merchant's name, when the caller already has it (saves a lookup). */
	merchantName?: string | null;
}

export interface CategorizationResolver {
	resolve(input: CategorizationInput): Promise<CategorizationResult | null>;
}

/**
 * A resolver loads the keyword rules once and remembers every per-merchant lookup, so a bulk
 * caller (a 2,000-row statement import, "apply rules to the queue") pays for each merchant and
 * each rule once instead of once per row. Its lifetime is one operation: rules are not re-read,
 * so a resolver must not outlive the rule edits it would otherwise have seen.
 *
 * Precedence, most to least specific — an explicit rule always beats a guess (FR-005), and a rule
 * whose target category was deleted never applies (FR-009):
 *   1. a rule for this exact alias of the merchant, then a merchant-wide rule;
 *   2. a keyword rule matching the description or merchant name (longest keyword wins);
 *   3. a learned suggestion from the merchant's confirmation streak.
 */
export async function createCategorizationResolver(
	key: CryptoKey
): Promise<CategorizationResolver> {
	const keywordRules = await loadKeywordRules(key);
	const rulesByMerchant = new Map<string, Promise<CategorizationRule[]>>();
	const suggestionByMerchant = new Map<string, Promise<string | null>>();
	const nameByMerchant = new Map<string, Promise<string>>();

	function merchantRules(merchantId: string): Promise<CategorizationRule[]> {
		let cached = rulesByMerchant.get(merchantId);
		if (!cached) {
			cached = CategorizationRuleRepository.listForMerchant(key, merchantId).then((rules) =>
				nonStaleRules(key, rules)
			);
			rulesByMerchant.set(merchantId, cached);
		}
		return cached;
	}

	function suggestionFor(merchantId: string): Promise<string | null> {
		let cached = suggestionByMerchant.get(merchantId);
		if (!cached) {
			cached = (async () => {
				const signal = await MerchantCategorySignalRepository.get(key, merchantId);
				const suggested = signal ? deriveSuggestion(signal.recentCategoryIds) : null;
				if (!suggested) return null;
				const category = await CategoryRepository.getById(key, suggested);
				return category ? suggested : null;
			})();
			suggestionByMerchant.set(merchantId, cached);
		}
		return cached;
	}

	function merchantNameFor(merchantId: string): Promise<string> {
		let cached = nameByMerchant.get(merchantId);
		if (!cached) {
			cached = MerchantRepository.getById(key, merchantId).then((m) => m?.name ?? '');
			nameByMerchant.set(merchantId, cached);
		}
		return cached;
	}

	return {
		async resolve({ merchantId, aliasId = null, notes = null, merchantName = null }) {
			if (merchantId) {
				const rule = pickBestRule(await merchantRules(merchantId), merchantId, aliasId);
				if (rule) {
					return {
						categoryId: rule.categoryId,
						tagIds: rule.tagIds,
						source: 'rule',
						ruleId: rule.id
					};
				}
			}

			if (keywordRules.length > 0) {
				const name = merchantName ?? (merchantId ? await merchantNameFor(merchantId) : '');
				const keywordRule = pickKeywordRule(keywordRules, [notes, name].filter(Boolean).join(' '));
				if (keywordRule) {
					return {
						categoryId: keywordRule.categoryId,
						tagIds: keywordRule.tagIds,
						source: 'rule',
						ruleId: keywordRule.id
					};
				}
			}

			// No rule — fall back to a learned suggestion (Story 2), only when it's active
			// (a real streak) and its category hasn't gone stale.
			if (merchantId) {
				const suggested = await suggestionFor(merchantId);
				if (suggested) return { categoryId: suggested, tagIds: [], source: 'suggestion' };
			}
			return null;
		}
	};
}

/**
 * One-off form of `createCategorizationResolver(...).resolve(...)`: what (if anything) should
 * pre-fill a newly proposed transaction (per contracts/categorization-engine.md). Returns `null`
 * when nothing should be pre-filled — the caller falls through to today's `__uncategorized__`
 * default. Never throws for "nothing found" cases.
 */
export async function resolveCategorization(
	key: CryptoKey,
	merchantId: string | null,
	aliasId: string | null,
	options: { notes?: string | null; merchantName?: string | null } = {}
): Promise<CategorizationResult | null> {
	const resolver = await createCategorizationResolver(key);
	return resolver.resolve({ merchantId, aliasId, ...options });
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
	const recentCategoryIds = [...(existing?.recentCategoryIds ?? []), categoryId].slice(-MIN_STREAK);
	await MerchantCategorySignalRepository.set(key, merchantId, recentCategoryIds);
}

/** Every merchant whose derived suggestion is non-null and whose category isn't stale — for
 *  the management UI (Story 3).
 *
 *  A merchant that already has a live merchant-wide rule is NOT listed. A rule always wins over a
 *  learned suggestion (see `createCategorizationResolver`), so the suggestion is dead weight there
 *  — and because confirming a rule-categorized transaction feeds the very same streak, every ruled
 *  merchant would otherwise reach "3 in a row" on its own and be offered back as a suggestion to
 *  "promote" into the rule it already is. The same goes for a merchant whose name a keyword rule
 *  already matches. (An alias-scoped rule only covers that one alias, so a merchant with nothing
 *  but alias rules can still have a useful suggestion for its other aliases.) */
export async function listSuggestions(
	key: CryptoKey
): Promise<{ merchantId: string; categoryId: string }[]> {
	const [signals, rules] = await Promise.all([
		MerchantCategorySignalRepository.listAll(key),
		CategorizationRuleRepository.list(key)
	]);
	const merchantsWithRule = new Set(
		rules
			.filter((rule) => rule.merchantAliasId === null && !rule.isInvalid)
			.map((r) => r.merchantId)
	);
	const keywordRules = rules.filter((rule) => !!rule.keyword && !rule.isInvalid);
	const merchantNames =
		keywordRules.length > 0
			? new Map((await MerchantRepository.list(key)).map((m) => [m.id, m.name]))
			: new Map<string, string>();

	const results: { merchantId: string; categoryId: string }[] = [];
	for (const signal of signals) {
		if (merchantsWithRule.has(signal.id)) continue;
		const name = merchantNames.get(signal.id);
		if (name && pickKeywordRule(keywordRules, name)) continue;
		const categoryId = deriveSuggestion(signal.recentCategoryIds);
		if (!categoryId) continue;
		const category = await CategoryRepository.getById(key, categoryId);
		if (!category) continue;
		results.push({ merchantId: signal.id, categoryId });
	}
	return results;
}

/**
 * Makes `categoryId` the merchant-wide rule for `merchantId`: updates the merchant's existing
 * rule if there is one, creates it otherwise — and clears the merchant's learning streak, since
 * the suggestion that (usually) led here has now been acted on. Used by "Promote" on the
 * Auto-Categorize page and by "always file this merchant here" in the Review Queue.
 */
export async function setMerchantRule(
	key: CryptoKey,
	merchantId: string,
	categoryId: string,
	tagIds: string[] = []
): Promise<CategorizationRule> {
	const existing = await CategorizationRuleRepository.findByScope(key, merchantId, null);
	const rule = existing
		? await CategorizationRuleRepository.update(key, existing.id, { categoryId, tagIds })
		: await CategorizationRuleRepository.create(key, {
				merchantId,
				merchantAliasId: null,
				categoryId,
				tagIds
			});
	await MerchantCategorySignalRepository.reset(key, merchantId);
	return rule;
}

export interface ApplyAutoCategorizationOptions {
	/** Restrict to one merchant (used when a merchant rule is created/edited). */
	merchantId?: string;
	/** Restrict to the entries one keyword rule decides (used when it is created/edited). */
	keywordRuleId?: string;
	/** Restrict to entries still waiting in the Review Queue. */
	unreviewedOnly?: boolean;
	/** Count what would change without writing anything — for a confirmation prompt. */
	dryRun?: boolean;
}

/** Uncategorized, non-transfer entries that have something to match on: a merchant, or — for
 *  keyword rules — a description.
 *
 *  Only entries with exactly ONE split qualify. An entry split across categories can still carry a
 *  stray "Uncategorized" part, and filing it would replace all of its splits with a single new one
 *  — silently throwing away the categories the user had assigned to the other parts. The split
 *  count comes off the indexed column, so no split is decrypted just to be counted. */
async function uncategorizedCandidates(key: CryptoKey, options: { unreviewedOnly?: boolean } = {}) {
	const candidates = (await TransactionRepository.listUncategorized(key, options)).filter(
		(tx) => tx.type !== 'transfer' && (tx.merchantId !== null || !!tx.notes)
	);
	const splitCounts = await TransactionRepository.splitCountsByTransaction(
		candidates.map((tx) => tx.id)
	);
	// Newest first, with a deterministic tie-break: storage order is by random split id, which
	// would make the preview's "for example" lines change from one open to the next.
	return candidates
		.filter((tx) => splitCounts.get(tx.id) === 1)
		.sort(
			(a, b) =>
				b.date.localeCompare(a.date) || b.createdAt - a.createdAt || a.id.localeCompare(b.id)
		);
}

/**
 * Re-runs auto-categorization over entries that are STILL "Uncategorized" — creating a rule, or
 * building a suggestion, previously only affected transactions entered afterwards, so a user who
 * set up "Swiggy → Food" saw their existing Swiggy history stay uncategorized and concluded the
 * feature was not working. Never touches an entry that already has a category (a choice the user
 * made is never overridden) or a transfer.
 *
 * Only merchant-wide rules, keyword rules and learned suggestions can apply retroactively: which
 * *alias* a historical transaction matched is not stored on it, so an alias-scoped rule has
 * nothing to match against.
 */
export async function applyAutoCategorization(
	key: CryptoKey,
	options: ApplyAutoCategorizationOptions = {}
): Promise<{ updated: number }> {
	const candidates = (
		await uncategorizedCandidates(key, { unreviewedOnly: options.unreviewedOnly })
	).filter((tx) => !options.merchantId || tx.merchantId === options.merchantId);
	if (candidates.length === 0) return { updated: 0 };

	const resolver = await createCategorizationResolver(key);
	const merchantNames = new Map((await MerchantRepository.list(key)).map((m) => [m.id, m.name]));

	let updated = 0;
	for (const tx of candidates) {
		const result = await resolver.resolve({
			merchantId: tx.merchantId,
			notes: tx.notes,
			merchantName: tx.merchantId ? (merchantNames.get(tx.merchantId) ?? '') : ''
		});
		if (!result) continue;
		if (options.keywordRuleId && result.ruleId !== options.keywordRuleId) continue;

		updated++;
		if (options.dryRun) continue;
		await TransactionRepository.update(key, tx.id, {}, [
			{ categoryId: result.categoryId, amount: tx.amount, categorizationSource: result.source }
		]);
		if (result.tagIds.length > 0) {
			const existing = await TransactionTagRepository.getTagIds(tx.id);
			await TransactionTagRepository.setTags(tx.id, [...new Set([...existing, ...result.tagIds])]);
		}
	}
	return { updated };
}

export interface KeywordPreview {
	/** Uncategorized entries whose description or merchant contains the keyword. */
	count: number;
	/** A few of their descriptions, so the user can see what the keyword would catch. */
	samples: string[];
}

export interface KeywordPreviewer {
	preview(keyword: string, sampleLimit?: number): Promise<KeywordPreview>;
}

/**
 * A previewer for the rule dialog: it loads and decrypts the uncategorized entries (and the
 * merchant names) ONCE, on the first keystroke, normalizes each entry's text once, and then every
 * further keystroke is just a string comparison over what is already in memory. The preview used to
 * re-read and re-decrypt the whole uncategorized set on every (debounced) keystroke — seconds of
 * work, repeated, on a ledger with a large import waiting to be categorized. Its lifetime is one
 * dialog: it deliberately never refreshes, since nothing it reads changes while the dialog is open.
 */
export function createKeywordPreviewer(key: CryptoKey): KeywordPreviewer {
	let loaded: Promise<{ label: string; normalized: string }[]> | null = null;
	const load = () =>
		(loaded ??= (async () => {
			const candidates = await uncategorizedCandidates(key);
			if (candidates.length === 0) return [];
			const merchantNames = new Map(
				(await MerchantRepository.list(key)).map((m) => [m.id, m.name])
			);
			return candidates.map((tx) => {
				const name = tx.merchantId ? (merchantNames.get(tx.merchantId) ?? '') : '';
				return {
					label: tx.notes || name,
					normalized: normalizeMatchText([tx.notes, name].filter(Boolean).join(' '))
				};
			});
		})());

	return {
		async preview(keyword, sampleLimit = 4) {
			const entries = await load();
			const wanted = normalizeMatchText(keyword);
			let count = 0;
			const samples: string[] = [];
			for (const entry of entries) {
				if (!textMatchesKeyword(entry.normalized, wanted)) continue;
				count++;
				if (samples.length < sampleLimit && entry.label && !samples.includes(entry.label)) {
					samples.push(entry.label);
				}
			}
			return { count, samples };
		}
	};
}

/**
 * What a keyword WOULD match among entries still uncategorized — shown while the rule is being
 * written, so an over-broad keyword ("pay", "upi") is visible before it is saved rather than
 * after it has filed half the ledger. Looks only at uncategorized entries: those are the only
 * ones a rule can change, and keeping to them keeps this cheap on a large ledger. Ignores
 * precedence — it answers "what contains this text", not "what would this rule win".
 *
 * One-off form; a dialog that previews repeatedly should hold a `createKeywordPreviewer`.
 */
export async function previewKeywordRule(
	key: CryptoKey,
	keyword: string,
	sampleLimit = 4
): Promise<KeywordPreview> {
	return createKeywordPreviewer(key).preview(keyword, sampleLimit);
}
