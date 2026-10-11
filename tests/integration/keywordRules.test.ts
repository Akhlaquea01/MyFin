import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { TagRepository, TransactionTagRepository } from '../../src/data/dexie/tagRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../src/data/dexie/transactionRepository';
import {
	CategorizationRuleRepository,
	DuplicateRuleError,
	KEYWORD_RULE_MERCHANT_ID,
	isKeywordRule
} from '../../src/data/dexie/categorizationRuleRepository';
import { MerchantCategorySignalRepository } from '../../src/data/dexie/merchantCategorySignalRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { MIN_STREAK } from '../../src/domain/categorization/categorizationEngine';
import {
	applyAutoCategorization,
	createCategorizationResolver,
	listSuggestions,
	previewKeywordRule,
	resolveCategorization,
	setMerchantRule
} from '../../src/domain/categorization/resolveCategorization';
import { resolveMerchant } from '../../src/domain/parser/merchantResolver';
import { importRows, type ColumnMapping } from '../../src/data/io/importService';
import { importBulkText } from '../../src/data/io/bulkTextImportService';
import { buildDataTemplate, importDataTemplate } from '../../src/data/io/templateService';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

describe('keyword (description contains) categorization rules', () => {
	let key: CryptoKey;
	let accountId: string;
	let food: string;
	let transport: string;
	let shopping: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('7531', randomSaltBase64());
		accountId = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		food = (await CategoryRepository.create(key, { name: 'Food' })).id;
		transport = (await CategoryRepository.create(key, { name: 'Transport' })).id;
		shopping = (await CategoryRepository.create(key, { name: 'Shopping' })).id;
	});

	async function recordExpense(
		notes: string | null,
		merchantId: string | null = null,
		amount = -100
	) {
		return TransactionEngine.recordTransaction(key, {
			accountId,
			date: '2026-03-01',
			amount,
			type: 'expense',
			notes,
			merchantId
		});
	}
	async function categoryOf(txId: string) {
		return (await TransactionRepository.getSplits(key, txId))[0];
	}

	describe('CategorizationRuleRepository', () => {
		it('creates a keyword rule under the shared pseudo-merchant and lists it', async () => {
			const rule = await CategorizationRuleRepository.create(key, {
				keyword: '  Swiggy ',
				categoryId: food
			});
			expect(rule.merchantId).toBe(KEYWORD_RULE_MERCHANT_ID);
			expect(rule.merchantAliasId).toBeNull();
			expect(rule.keyword).toBe('Swiggy'); // stored as typed, trimmed
			expect(isKeywordRule(rule)).toBe(true);
			expect((await CategorizationRuleRepository.listKeywordRules(key)).map((r) => r.id)).toEqual([
				rule.id
			]);
			expect((await CategorizationRuleRepository.list(key))[0].isInvalid).toBe(false);
		});

		it('rejects a keyword that is too short', async () => {
			await expect(
				CategorizationRuleRepository.create(key, { keyword: 'ab', categoryId: food })
			).rejects.toThrow(/at least 3 letters or digits/);
		});

		it('treats differently written copies of one keyword as a duplicate', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'Swiggy', categoryId: food });
			for (const dup of ['swiggy', ' SWIGGY ', 'swiggy!']) {
				await expect(
					CategorizationRuleRepository.create(key, { keyword: dup, categoryId: transport })
				).rejects.toBeInstanceOf(DuplicateRuleError);
			}
			expect(await CategorizationRuleRepository.listKeywordRules(key)).toHaveLength(1);
		});

		it('keeps a keyword rule a keyword rule on edit, and validates and dedupes the new keyword', async () => {
			const a = await CategorizationRuleRepository.create(key, {
				keyword: 'uber',
				categoryId: transport
			});
			await CategorizationRuleRepository.create(key, { keyword: 'swiggy', categoryId: food });

			const edited = await CategorizationRuleRepository.update(key, a.id, {
				keyword: 'uber eats',
				categoryId: food,
				// Attempts to turn it into a merchant rule must be ignored.
				merchantId: 'some-merchant',
				merchantAliasId: 'some-alias'
			});
			expect(edited.merchantId).toBe(KEYWORD_RULE_MERCHANT_ID);
			expect(edited.merchantAliasId).toBeNull();
			expect(edited.keyword).toBe('uber eats');

			await expect(
				CategorizationRuleRepository.update(key, a.id, { keyword: 'Swiggy' })
			).rejects.toBeInstanceOf(DuplicateRuleError);
			await expect(
				CategorizationRuleRepository.update(key, a.id, { keyword: 'x' })
			).rejects.toThrow(/at least 3/);
		});

		it('restoring a deleted keyword rule is refused while another live rule has the same keyword', async () => {
			const old = await CategorizationRuleRepository.create(key, {
				keyword: 'uber',
				categoryId: transport
			});
			await CategorizationRuleRepository.softDelete(key, old.id);
			await CategorizationRuleRepository.create(key, { keyword: 'UBER', categoryId: food });
			await expect(CategorizationRuleRepository.restore(key, old.id)).rejects.toBeInstanceOf(
				DuplicateRuleError
			);
		});

		it('flags a keyword rule invalid once its category is deleted', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'uber', categoryId: transport });
			await CategoryRepository.softDelete(key, transport);
			expect((await CategorizationRuleRepository.list(key))[0].isInvalid).toBe(true);
		});

		it('a merchant rule never grows a keyword', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			const rule = await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: transport
			});
			const updated = await CategorizationRuleRepository.update(key, rule.id, {
				keyword: 'sneaky'
			} as never);
			expect(updated.keyword).toBeUndefined();
			expect(isKeywordRule(updated)).toBe(false);
		});
	});

	describe('resolution', () => {
		it('files an entry by its description, with no merchant at all', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'swiggy', categoryId: food });
			const tx = await recordExpense('UPI-SWIGGY-8812 Bangalore');
			const split = await categoryOf(tx.id);
			expect(split.categoryId).toBe(food);
			expect(split.categorizationSource).toBe('rule');
		});

		it('also matches on the merchant name when the description is empty', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'swiggy', categoryId: food });
			const merchant = await resolveMerchant(key, 'Swiggy Instamart');
			const tx = await recordExpense(null, merchant.merchantId);
			expect((await categoryOf(tx.id)).categoryId).toBe(food);
		});

		it("carries the rule's tags onto the entry", async () => {
			const tag = await TagRepository.getOrCreate(key, 'delivery');
			await CategorizationRuleRepository.create(key, {
				keyword: 'swiggy',
				categoryId: food,
				tagIds: [tag.id]
			});
			const tx = await recordExpense('SWIGGY order');
			expect(await TransactionTagRepository.getTagIds(tx.id)).toEqual([tag.id]);
		});

		it('leaves an entry uncategorized when no keyword matches', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'swiggy', categoryId: food });
			const tx = await recordExpense('Zomato order');
			expect((await categoryOf(tx.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
		});

		it('never overrides a category the user chose', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'swiggy', categoryId: food });
			const tx = await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-03-01', amount: -100, type: 'expense', notes: 'swiggy' },
				[{ categoryId: shopping, amount: -100 }]
			);
			expect((await categoryOf(tx.id)).categoryId).toBe(shopping);
		});

		it('never categorizes a transfer', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'transfer', categoryId: food });
			const tx = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-03-01',
				amount: -100,
				type: 'transfer',
				notes: 'transfer to savings'
			});
			expect((await categoryOf(tx.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
		});

		it('skips a keyword rule whose category was deleted', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'uber', categoryId: transport });
			await CategoryRepository.softDelete(key, transport);
			const tx = await recordExpense('uber ride');
			expect((await categoryOf(tx.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
		});

		describe('precedence: alias rule > merchant rule > keyword rule > learned suggestion', () => {
			it('a merchant rule beats a keyword rule', async () => {
				const merchant = await MerchantRepository.create(key, 'Amazon');
				await CategorizationRuleRepository.create(key, {
					merchantId: merchant.id,
					categoryId: shopping
				});
				await CategorizationRuleRepository.create(key, { keyword: 'amazon', categoryId: food });
				const result = await resolveCategorization(key, merchant.id, null, {
					notes: 'AMAZON order'
				});
				expect(result?.categoryId).toBe(shopping);
			});

			it('an alias-scoped rule beats a merchant-wide rule and a keyword rule', async () => {
				const resolved = await resolveMerchant(key, 'AMAZON PRIME');
				await CategorizationRuleRepository.create(key, {
					merchantId: resolved.merchantId,
					categoryId: shopping
				});
				await CategorizationRuleRepository.create(key, {
					merchantId: resolved.merchantId,
					merchantAliasId: resolved.aliasId,
					categoryId: transport
				});
				await CategorizationRuleRepository.create(key, { keyword: 'amazon', categoryId: food });
				const result = await resolveCategorization(key, resolved.merchantId, resolved.aliasId, {
					notes: 'amazon prime'
				});
				expect(result?.categoryId).toBe(transport);
			});

			it('a keyword rule beats a learned suggestion', async () => {
				const merchant = await MerchantRepository.create(key, 'Random Vendor');
				for (let i = 0; i < MIN_STREAK; i++) {
					const tx = await TransactionEngine.recordTransaction(key, {
						accountId,
						date: '2026-03-01',
						amount: -50,
						type: 'expense',
						merchantId: merchant.id,
						reviewStatus: 'unreviewed'
					});
					await TransactionEngine.confirmTransaction(key, tx.id, [
						{ categoryId: transport, amount: -50 }
					]);
				}
				expect((await resolveCategorization(key, merchant.id, null))?.source).toBe('suggestion');

				await CategorizationRuleRepository.create(key, { keyword: 'vendor', categoryId: food });
				const result = await resolveCategorization(key, merchant.id, null, {
					notes: 'Random Vendor invoice'
				});
				expect(result?.categoryId).toBe(food);
				expect(result?.source).toBe('rule');
			});

			it('the longest matching keyword wins', async () => {
				await CategorizationRuleRepository.create(key, { keyword: 'amazon', categoryId: shopping });
				await CategorizationRuleRepository.create(key, {
					keyword: 'amazon prime',
					categoryId: food
				});
				const tx = await recordExpense('AMAZON PRIME RENEWAL');
				expect((await categoryOf(tx.id)).categoryId).toBe(food);
				const other = await recordExpense('AMAZON SELLER');
				expect((await categoryOf(other.id)).categoryId).toBe(shopping);
			});
		});

		it('reports which rule decided, so a rule can be applied on its own', async () => {
			const rule = await CategorizationRuleRepository.create(key, {
				keyword: 'swiggy',
				categoryId: food
			});
			const resolver = await createCategorizationResolver(key);
			const result = await resolver.resolve({ merchantId: null, notes: 'swiggy' });
			expect(result?.ruleId).toBe(rule.id);
		});
	});

	describe('bulk import', () => {
		const mapping = (): ColumnMapping => ({
			dateColumn: 'Date',
			amountColumn: 'Amount',
			descriptionColumn: 'Description',
			accountId,
			dateFormat: 'YYYY-MM-DD',
			amountSignConvention: 'negative-is-expense'
		});

		it('files every spelling of a business with ONE keyword rule — which merchant rules cannot', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'swiggy', categoryId: food });
			const rows = [
				{ Date: '2026-03-01', Amount: '-250.00', Description: 'UPI-SWIGGY-88123-BANGALORE' },
				{ Date: '2026-03-02', Amount: '-310.00', Description: 'SWIGGY INSTAMART ORDER 7712' },
				{ Date: '2026-03-03', Amount: '-120.00', Description: 'POS 4412 Swiggy One Membership' },
				{ Date: '2026-03-04', Amount: '-999.00', Description: 'ZOMATO ONLINE 5521' }
			];
			const result = await importRows(key, rows, mapping());
			expect(result.createdCount).toBe(4);

			const all = await TransactionRepository.search(key, { accountId });
			const byNotes = new Map(all.map((t) => [t.notes, t]));
			for (const description of [
				'UPI-SWIGGY-88123-BANGALORE',
				'SWIGGY INSTAMART ORDER 7712',
				'POS 4412 Swiggy One Membership'
			]) {
				expect((await categoryOf(byNotes.get(description)!.id)).categoryId, description).toBe(food);
			}
			expect((await categoryOf(byNotes.get('ZOMATO ONLINE 5521')!.id)).categoryId).toBe(
				UNCATEGORIZED_CATEGORY_ID
			);
			// Three different merchants were minted from those three descriptions…
			const merchants = await MerchantRepository.list(key);
			expect(merchants.length).toBeGreaterThanOrEqual(3);
		});

		it('categorizes a row whose description normalizes to no merchant at all', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'rent', categoryId: shopping });
			const result = await importRows(
				key,
				[{ Date: '2026-03-01', Amount: '-15000.00', Description: '12 34 RENT 5678 99' }],
				mapping()
			);
			expect(result.createdCount).toBe(1);
			const [tx] = await TransactionRepository.search(key, { accountId });
			expect((await categoryOf(tx.id)).categoryId).toBe(shopping);
		});

		it('applies keyword rules to pasted bank messages too', async () => {
			await CategorizationRuleRepository.create(key, { keyword: 'swiggy', categoryId: food });
			const result = await importBulkText(
				key,
				'Rs.250.00 debited from A/c XX1234 to SWIGGY on 01-03\nRs.80.00 debited from A/c XX1234 to METRO on 01-03',
				accountId
			);
			expect(result.createdCount).toBe(2);
			const all = await TransactionRepository.search(key, { accountId });
			const categories = await Promise.all(
				all.map(async (t) => (await categoryOf(t.id)).categoryId)
			);
			expect(categories.filter((c) => c === food)).toHaveLength(1);
		});
	});

	describe('applying a rule to existing transactions', () => {
		it('files only uncategorized entries containing the keyword, and only those THIS rule decides', async () => {
			const swiggyMerchant = await MerchantRepository.create(key, 'Swiggy Corporate');
			await setMerchantRule(key, swiggyMerchant.id, shopping); // a merchant rule, higher precedence

			const a = await recordExpense('UPI-SWIGGY-1');
			const b = await recordExpense('swiggy order 2');
			const claimedByMerchantRule = await recordExpense('swiggy bulk', swiggyMerchant.id);
			const unrelated = await recordExpense('Zomato');
			const alreadyChosen = await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-03-01', amount: -100, type: 'expense', notes: 'swiggy gold' },
				[{ categoryId: transport, amount: -100 }]
			);
			// Recorded BEFORE the rule exists, so it begins uncategorized.
			expect((await categoryOf(a.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);

			const rule = await CategorizationRuleRepository.create(key, {
				keyword: 'swiggy',
				categoryId: food
			});

			// The merchant rule filed that one at record time, before the keyword rule existed.
			expect((await categoryOf(claimedByMerchantRule.id)).categoryId).toBe(shopping);

			const dry = await applyAutoCategorization(key, { keywordRuleId: rule.id, dryRun: true });
			expect(dry.updated).toBe(2);
			expect((await categoryOf(a.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);

			expect((await applyAutoCategorization(key, { keywordRuleId: rule.id })).updated).toBe(2);
			expect((await categoryOf(a.id)).categoryId).toBe(food);
			expect((await categoryOf(b.id)).categoryId).toBe(food);
			expect((await categoryOf(a.id)).categorizationSource).toBe('rule');
			expect((await categoryOf(unrelated.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
			expect((await categoryOf(alreadyChosen.id)).categoryId).toBe(transport);
			expect((await categoryOf(claimedByMerchantRule.id)).categoryId).toBe(shopping);

			expect((await applyAutoCategorization(key, { keywordRuleId: rule.id })).updated).toBe(0);
		});

		it('is also picked up by a general re-run, including entries with no merchant', async () => {
			const a = await recordExpense('swiggy 1');
			await CategorizationRuleRepository.create(key, { keyword: 'swiggy', categoryId: food });
			expect((await applyAutoCategorization(key)).updated).toBe(1);
			expect((await categoryOf(a.id)).categoryId).toBe(food);
		});
	});

	describe('previewKeywordRule', () => {
		it('counts uncategorized matches and shows a few distinct examples', async () => {
			await recordExpense('UPI-SWIGGY-1');
			await recordExpense('UPI-SWIGGY-1'); // duplicate text: counted twice, sampled once
			await recordExpense('Swiggy Instamart');
			await recordExpense('Zomato');
			await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-03-01', amount: -100, type: 'expense', notes: 'swiggy gold' },
				[{ categoryId: transport, amount: -100 }]
			); // already categorized: never a candidate

			const preview = await previewKeywordRule(key, 'swiggy');
			expect(preview.count).toBe(3);
			// Newest first, so the examples are the entries the user most recently saw.
			expect(preview.samples).toEqual(['Swiggy Instamart', 'UPI-SWIGGY-1']);
		});

		it('is empty when nothing matches, and on an empty ledger', async () => {
			expect(await previewKeywordRule(key, 'swiggy')).toEqual({ count: 0, samples: [] });
			await recordExpense('Zomato');
			expect(await previewKeywordRule(key, 'swiggy')).toEqual({ count: 0, samples: [] });
		});
	});

	describe('suggestions', () => {
		it('does not suggest a merchant whose name a keyword rule already covers', async () => {
			const merchant = await MerchantRepository.create(key, 'UBER INDIA');
			for (let i = 0; i < MIN_STREAK; i++) {
				const tx = await TransactionEngine.recordTransaction(key, {
					accountId,
					date: '2026-03-01',
					amount: -100,
					type: 'expense',
					merchantId: merchant.id,
					reviewStatus: 'unreviewed'
				});
				await TransactionEngine.confirmTransaction(key, tx.id, [
					{ categoryId: transport, amount: -100 }
				]);
			}
			expect(await listSuggestions(key)).toHaveLength(1);

			await CategorizationRuleRepository.create(key, { keyword: 'uber', categoryId: transport });
			expect(await listSuggestions(key)).toEqual([]);
			expect(
				(await MerchantCategorySignalRepository.get(key, merchant.id))?.recentCategoryIds
			).toHaveLength(MIN_STREAK);
		});
	});

	describe('data template', () => {
		it('exports a keyword rule and re-imports it as a keyword rule, once', async () => {
			const rule = await CategorizationRuleRepository.create(key, {
				keyword: 'swiggy',
				categoryId: food
			});
			const template = await buildDataTemplate(key);
			expect(template.entities.categorizationRules.find((r) => r.id === rule.id)?.keyword).toBe(
				'swiggy'
			);

			// Into a fresh install.
			await db.delete();
			await db.open();
			const salt = randomSaltBase64();
			const freshKey = await deriveEncryptionKey('9999', salt);
			const pinSalt = randomSaltBase64();
			await UserProfileRepository.create({
				pinVerifierHash: await hashPin('9999', pinSalt),
				pinSalt,
				encryptionSalt: salt,
				biometricEnabled: false,
				autoLockTimeoutMs: 300_000,
				storagePersisted: true
			});
			const result = await importDataTemplate(freshKey, template);
			expect(result.perEntity.categorizationRules.created).toBe(1);

			const imported = await CategorizationRuleRepository.listKeywordRules(freshKey);
			expect(imported).toHaveLength(1);
			expect(imported[0].keyword).toBe('swiggy');
			const importedCategory = await CategoryRepository.getById(freshKey, imported[0].categoryId);
			expect(importedCategory?.name).toBe('Food');

			// Importing the same file again adds nothing.
			const again = await importDataTemplate(freshKey, template);
			expect(again.perEntity.categorizationRules.created ?? 0).toBe(0);
			expect(again.perEntity.categorizationRules.skipped).toBe(1);
			expect(await CategorizationRuleRepository.listKeywordRules(freshKey)).toHaveLength(1);
		});
	});
});
