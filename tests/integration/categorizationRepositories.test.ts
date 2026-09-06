import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { MerchantRepository, MerchantAliasRepository } from '../../src/data/dexie/merchantRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { CategorizationRuleRepository } from '../../src/data/dexie/categorizationRuleRepository';
import { MerchantCategorySignalRepository } from '../../src/data/dexie/merchantCategorySignalRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { MIN_STREAK } from '../../src/domain/categorization/categorizationEngine';
import { recordConfirmation, listSuggestions } from '../../src/domain/categorization/resolveCategorization';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Auto-categorization (spec 006)', () => {
	let key: CryptoKey;
	let accountId: string;
	let categoryA: string;
	let categoryB: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('4242', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
		categoryA = (await CategoryRepository.create(key, { name: 'Dining' })).id;
		categoryB = (await CategoryRepository.create(key, { name: 'Transport' })).id;
	});

	describe('CategorizationRuleRepository', () => {
		it('creates, updates, soft-deletes, and restores a rule', async () => {
			const merchant = await MerchantRepository.create(key, 'Starbucks');
			const rule = await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: categoryA,
				tagIds: []
			});
			expect((await CategorizationRuleRepository.listForMerchant(key, merchant.id)).map((r) => r.id)).toEqual([
				rule.id
			]);

			await CategorizationRuleRepository.update(key, rule.id, { categoryId: categoryB });
			expect((await CategorizationRuleRepository.getById(key, rule.id))?.categoryId).toBe(categoryB);

			await CategorizationRuleRepository.softDelete(key, rule.id);
			expect(await CategorizationRuleRepository.listForMerchant(key, merchant.id)).toEqual([]);

			await CategorizationRuleRepository.restore(key, rule.id);
			expect((await CategorizationRuleRepository.listForMerchant(key, merchant.id)).map((r) => r.id)).toEqual([
				rule.id
			]);
		});

		it('flags a rule as invalid once its target category is soft-deleted (FR-009)', async () => {
			const merchant = await MerchantRepository.create(key, 'Foo');
			await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: categoryA,
				tagIds: []
			});
			expect((await CategorizationRuleRepository.list(key))[0].isInvalid).toBe(false);

			await CategoryRepository.softDelete(key, categoryA);
			expect((await CategorizationRuleRepository.list(key))[0].isInvalid).toBe(true);
		});
	});

	describe('resolveCategorization via TransactionEngine.recordTransaction (rule path)', () => {
		it('pre-fills category and tags across quick_add, bulk_import, and file_import sources', async () => {
			const merchant = await MerchantRepository.create(key, 'Starbucks');
			const alias = await MerchantAliasRepository.create(key, merchant.id, 'Starbucks');
			await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: categoryA,
				tagIds: []
			});

			for (const source of ['quick_add', 'bulk_import', 'file_import'] as const) {
				const tx = await TransactionEngine.recordTransaction(key, {
					accountId,
					date: '2026-01-01',
					amount: -500,
					type: 'expense',
					merchantId: merchant.id,
					merchantAliasId: alias.id,
					source,
					reviewStatus: 'unreviewed'
				});
				const splits = await TransactionRepository.getSplits(key, tx.id);
				expect(splits[0].categoryId).toBe(categoryA);
				expect(splits[0].categorizationSource).toBe('rule');
			}
		});

		it('a rule whose category was soft-deleted no longer applies', async () => {
			const merchant = await MerchantRepository.create(key, 'Foo');
			await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: categoryA,
				tagIds: []
			});
			await CategoryRepository.softDelete(key, categoryA);

			const tx = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-01',
				amount: -500,
				type: 'expense',
				merchantId: merchant.id,
				merchantAliasId: null,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			const splits = await TransactionRepository.getSplits(key, tx.id);
			expect(splits[0].categoryId).toBe('__uncategorized__');
		});

		it('an alias-scoped rule wins over a merchant-scoped rule for the same merchant', async () => {
			const merchant = await MerchantRepository.create(key, 'Amazon');
			const alias = await MerchantAliasRepository.create(key, merchant.id, 'AMZN');
			await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: categoryB,
				tagIds: []
			});
			await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				merchantAliasId: alias.id,
				categoryId: categoryA,
				tagIds: []
			});

			const tx = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-01',
				amount: -500,
				type: 'expense',
				merchantId: merchant.id,
				merchantAliasId: alias.id,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			const splits = await TransactionRepository.getSplits(key, tx.id);
			expect(splits[0].categoryId).toBe(categoryA);
		});
	});

	describe('MerchantCategorySignalRepository / recordConfirmation', () => {
		it('caps recentCategoryIds at MIN_STREAK entries, FIFO', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			for (let i = 0; i < MIN_STREAK + 2; i++) {
				await recordConfirmation(key, merchant.id, categoryB);
			}
			const signal = await MerchantCategorySignalRepository.get(key, merchant.id);
			expect(signal?.recentCategoryIds).toHaveLength(MIN_STREAK);
		});

		it('reset clears the signal entirely', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			await recordConfirmation(key, merchant.id, categoryB);
			await MerchantCategorySignalRepository.reset(key, merchant.id);
			expect(await MerchantCategorySignalRepository.get(key, merchant.id)).toBeNull();
		});
	});

	describe('Learned suggestions (Story 2/3)', () => {
		async function confirmInto(merchantId: string, categoryId: string) {
			const tx = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-01',
				amount: -100,
				type: 'expense',
				merchantId,
				merchantAliasId: null,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			await TransactionEngine.confirmTransaction(key, tx.id, [
				{ categoryId, amount: -100 }
			]);
			return tx;
		}

		it('pre-fills a suggestion once a merchant reaches a consistent confirmation streak', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			for (let i = 0; i < MIN_STREAK; i++) {
				await confirmInto(merchant.id, categoryB);
			}

			const tx = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-02',
				amount: -150,
				type: 'expense',
				merchantId: merchant.id,
				merchantAliasId: null,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			const splits = await TransactionRepository.getSplits(key, tx.id);
			expect(splits[0].categoryId).toBe(categoryB);
			expect(splits[0].categorizationSource).toBe('suggestion');
		});

		it('an explicit rule still wins over an active suggestion streak for the same merchant', async () => {
			const merchant = await MerchantRepository.create(key, 'Amazon');
			for (let i = 0; i < MIN_STREAK; i++) {
				await confirmInto(merchant.id, categoryB);
			}
			await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: categoryA,
				tagIds: []
			});

			const tx = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-02',
				amount: -150,
				type: 'expense',
				merchantId: merchant.id,
				merchantAliasId: null,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			const splits = await TransactionRepository.getSplits(key, tx.id);
			expect(splits[0].categoryId).toBe(categoryA);
			expect(splits[0].categorizationSource).toBe('rule');
		});

		it('overriding a suggestion during confirm shifts the streak, stopping the old suggestion', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			for (let i = 0; i < MIN_STREAK; i++) {
				await confirmInto(merchant.id, categoryB);
			}

			// A new proposal now suggests categoryB — override it to categoryA on confirm.
			const tx = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-02',
				amount: -150,
				type: 'expense',
				merchantId: merchant.id,
				merchantAliasId: null,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			await TransactionEngine.confirmTransaction(key, tx.id, [
				{ categoryId: categoryA, amount: -150 }
			]);

			const signal = await MerchantCategorySignalRepository.get(key, merchant.id);
			expect(signal?.recentCategoryIds.every((id) => id === categoryB)).toBe(false);

			const next = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-03',
				amount: -200,
				type: 'expense',
				merchantId: merchant.id,
				merchantAliasId: null,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			const nextSplits = await TransactionRepository.getSplits(key, next.id);
			expect(nextSplits[0].categoryId).toBe('__uncategorized__');
		});

		it('never suggests from an inconsistent (alternating) confirmation history', async () => {
			const merchant = await MerchantRepository.create(key, 'Flipkart');
			await confirmInto(merchant.id, categoryA);
			await confirmInto(merchant.id, categoryB);
			await confirmInto(merchant.id, categoryA);
			await confirmInto(merchant.id, categoryB);

			const tx = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-05',
				amount: -300,
				type: 'expense',
				merchantId: merchant.id,
				merchantAliasId: null,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			const splits = await TransactionRepository.getSplits(key, tx.id);
			expect(splits[0].categoryId).toBe('__uncategorized__');
		});

		it('listSuggestions surfaces an active streak, and promoting it creates a matching rule', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			for (let i = 0; i < MIN_STREAK; i++) {
				await confirmInto(merchant.id, categoryB);
			}

			const suggestions = await listSuggestions(key);
			expect(suggestions).toEqual([{ merchantId: merchant.id, categoryId: categoryB }]);

			await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				merchantAliasId: null,
				categoryId: categoryB,
				tagIds: []
			});

			const tx = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-06',
				amount: -400,
				type: 'expense',
				merchantId: merchant.id,
				merchantAliasId: null,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			const splits = await TransactionRepository.getSplits(key, tx.id);
			expect(splits[0].categorizationSource).toBe('rule');
		});

		it('reset stops pre-filling until a fresh streak re-forms', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			for (let i = 0; i < MIN_STREAK; i++) {
				await confirmInto(merchant.id, categoryB);
			}
			await MerchantCategorySignalRepository.reset(key, merchant.id);

			const tx = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-07',
				amount: -100,
				type: 'expense',
				merchantId: merchant.id,
				merchantAliasId: null,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			const splits = await TransactionRepository.getSplits(key, tx.id);
			expect(splits[0].categoryId).toBe('__uncategorized__');
		});
	});
});
