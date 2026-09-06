import { db, type CategorizationRuleRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import { deletedAtIndex, NOT_DELETED } from './indexable';
import { CategoryRepository } from './categoryRepository';
import type { CategorizationRule } from '../../domain/entities';

export interface NewCategorizationRule {
	merchantId: string;
	merchantAliasId?: string | null;
	categoryId: string;
	tagIds?: string[];
}

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

export const CategorizationRuleRepository = {
	async create(key: CryptoKey, input: NewCategorizationRule): Promise<CategorizationRule> {
		const now = Date.now();
		const rule: CategorizationRule = {
			id: crypto.randomUUID(),
			merchantId: input.merchantId,
			merchantAliasId: input.merchantAliasId ?? null,
			categoryId: input.categoryId,
			tagIds: input.tagIds ?? [],
			createdAt: now,
			updatedAt: now,
			deletedAt: null
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

	/** Live (non-deleted) rules for one merchant — used by `resolveCategorization`. */
	async listForMerchant(key: CryptoKey, merchantId: string): Promise<CategorizationRule[]> {
		const rows = await db.categorizationRules
			.where('merchantId')
			.equals(merchantId)
			.filter((row) => row.deletedAt === NOT_DELETED)
			.toArray();
		return decryptRows<CategorizationRuleRow, CategorizationRule>(key, rows);
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
