import { db, type CategorizationRuleRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import { deletedAtIndex, NOT_DELETED } from './indexable';
import { CategoryRepository } from './categoryRepository';
import { normalizeMatchText, validateKeyword } from '../../domain/categorization/keywordMatching';
import type { CategorizationRule } from '../../domain/entities';

/**
 * The `merchantId` every keyword rule is filed under. A keyword rule is about text, not a
 * merchant, but the table is indexed by `merchantId` and a rule needs one — so keyword rules all
 * share this pseudo-merchant. That keeps them one indexed query away
 * (`listKeywordRules`) without a new index or a Dexie schema migration, the same trick
 * `UNCATEGORIZED_CATEGORY_ID` plays for categories. It can never collide with a real merchant,
 * whose ids are UUIDs.
 */
export const KEYWORD_RULE_MERCHANT_ID = '__keyword__';

export function isKeywordRule(rule: Pick<CategorizationRule, 'merchantId'>): boolean {
	return rule.merchantId === KEYWORD_RULE_MERCHANT_ID;
}

/** A rule for one merchant (optionally one alias of it)… */
export interface NewMerchantRule {
	merchantId: string;
	merchantAliasId?: string | null;
	keyword?: undefined;
	categoryId: string;
	tagIds?: string[];
}

/** …or a keyword rule, which applies to any description containing `keyword`. */
export interface NewKeywordRule {
	keyword: string;
	merchantId?: undefined;
	merchantAliasId?: undefined;
	categoryId: string;
	tagIds?: string[];
}

export type NewCategorizationRule = NewMerchantRule | NewKeywordRule;

export interface CategorizationRuleWithStatus extends CategorizationRule {
	/** Derived, never persisted (research.md §5): true when `categoryId` no longer
	 *  resolves to a live category. */
	isInvalid: boolean;
}

function toRow(rule: CategorizationRule): Omit<CategorizationRuleRow, 'id' | 'encryptedData'> {
	return {
		merchantId: rule.merchantId,
		deletedAt: deletedAtIndex(rule.deletedAt)
	};
}

/** Thrown when a second live rule would cover the same scope as an existing one — the same
 *  merchant (+ alias), or the same keyword. `pickBestRule` takes the first match, so two rules for
 *  one scope made the winner an accident of storage order — and the second was invisible dead
 *  weight. */
export class DuplicateRuleError extends Error {
	constructor(kind: 'merchant' | 'keyword' = 'merchant') {
		super(
			kind === 'keyword'
				? 'A rule for this keyword already exists. Edit that rule instead.'
				: 'A rule for this merchant and scope already exists. Edit that rule instead.'
		);
		this.name = 'DuplicateRuleError';
	}
}

export const CategorizationRuleRepository = {
	async create(key: CryptoKey, input: NewCategorizationRule): Promise<CategorizationRule> {
		let merchantId: string;
		let merchantAliasId: string | null;
		let keyword: string | null = null;

		if (input.keyword !== undefined) {
			const validation = validateKeyword(input.keyword);
			if (!validation.ok) throw new Error(validation.message);
			if (await this.findByKeyword(key, input.keyword)) throw new DuplicateRuleError('keyword');
			merchantId = KEYWORD_RULE_MERCHANT_ID;
			merchantAliasId = null;
			keyword = input.keyword.trim();
		} else {
			merchantId = input.merchantId;
			merchantAliasId = input.merchantAliasId ?? null;
			if (await this.findByScope(key, merchantId, merchantAliasId)) {
				throw new DuplicateRuleError();
			}
		}

		const now = Date.now();
		const rule: CategorizationRule = {
			id: crypto.randomUUID(),
			merchantId,
			merchantAliasId,
			categoryId: input.categoryId,
			tagIds: input.tagIds ?? [],
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			// Omitted entirely on a merchant rule, so those rows stay byte-for-byte what they were.
			...(keyword !== null ? { keyword } : {})
		};
		await putEncrypted(db.categorizationRules, key, rule, toRow(rule));
		return rule;
	},

	async update(
		key: CryptoKey,
		id: string,
		changes: Partial<CategorizationRule>
	): Promise<CategorizationRule> {
		const existing = await getDecrypted<CategorizationRuleRow, CategorizationRule>(
			db.categorizationRules,
			key,
			id
		);
		if (!existing) throw new Error(`CategorizationRule ${id} not found`);
		const updated: CategorizationRule = { ...existing, ...changes, id, updatedAt: Date.now() };

		if (isKeywordRule(existing)) {
			// A keyword rule stays a keyword rule: its pseudo-merchant and (absent) alias are not
			// editable, and the new keyword has to pass the same checks as on creation.
			updated.merchantId = KEYWORD_RULE_MERCHANT_ID;
			updated.merchantAliasId = null;
			const validation = validateKeyword(updated.keyword ?? '');
			if (!validation.ok) throw new Error(validation.message);
			updated.keyword = (updated.keyword ?? '').trim();
			if (updated.deletedAt === null) {
				const clash = await this.findByKeyword(key, updated.keyword);
				if (clash && clash.id !== id) throw new DuplicateRuleError('keyword');
			}
		} else {
			// …and a merchant rule never grows a keyword.
			delete updated.keyword;
			if (updated.deletedAt === null) {
				const clash = await this.findByScope(key, updated.merchantId, updated.merchantAliasId);
				if (clash && clash.id !== id) throw new DuplicateRuleError();
			}
		}

		await putEncrypted(db.categorizationRules, key, updated, toRow(updated));
		return updated;
	},

	async softDelete(key: CryptoKey, id: string): Promise<void> {
		await this.update(key, id, { deletedAt: Date.now() });
	},

	async restore(key: CryptoKey, id: string): Promise<void> {
		await this.update(key, id, { deletedAt: null });
	},

	async getById(key: CryptoKey, id: string): Promise<CategorizationRule | null> {
		return (
			(await getDecrypted<CategorizationRuleRow, CategorizationRule>(
				db.categorizationRules,
				key,
				id
			)) ?? null
		);
	},

	/** The live rule covering exactly this merchant + alias scope, if any. */
	async findByScope(
		key: CryptoKey,
		merchantId: string,
		merchantAliasId: string | null
	): Promise<CategorizationRule | null> {
		const rules = await this.listForMerchant(key, merchantId);
		return rules.find((rule) => rule.merchantAliasId === merchantAliasId) ?? null;
	},

	/** The live keyword rule whose keyword is the same as `keyword` once normalized
	 *  ("Swiggy", "SWIGGY " and "swiggy" are one keyword), if any. */
	async findByKeyword(key: CryptoKey, keyword: string): Promise<CategorizationRule | null> {
		const wanted = normalizeMatchText(keyword);
		const rules = await this.listKeywordRules(key);
		return rules.find((rule) => normalizeMatchText(rule.keyword ?? '') === wanted) ?? null;
	},

	/** Live (non-deleted) rules for one merchant — used by `resolveCategorization`. */
	async listForMerchant(key: CryptoKey, merchantId: string): Promise<CategorizationRule[]> {
		const rows = await db.categorizationRules
			.where('merchantId')
			.equals(merchantId)
			.filter((row) => row.deletedAt === NOT_DELETED)
			.toArray();
		return decryptRows<CategorizationRuleRow, CategorizationRule>(key, rows);
	},

	/** Every live keyword rule — one indexed query, via the shared pseudo-merchant. */
	async listKeywordRules(key: CryptoKey): Promise<CategorizationRule[]> {
		return this.listForMerchant(key, KEYWORD_RULE_MERCHANT_ID);
	},

	/** Every live rule, annotated with a derived `isInvalid` flag — for the management UI. */
	async list(key: CryptoKey): Promise<CategorizationRuleWithStatus[]> {
		const rows = await db.categorizationRules
			.filter((row) => row.deletedAt === NOT_DELETED)
			.toArray();
		const rules = await decryptRows<CategorizationRuleRow, CategorizationRule>(key, rows);
		return Promise.all(
			rules.map(async (rule) => {
				const category = await CategoryRepository.getById(key, rule.categoryId);
				return { ...rule, isInvalid: !category || category.deletedAt !== null };
			})
		);
	}
};
