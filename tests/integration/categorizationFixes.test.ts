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
	DuplicateRuleError
} from '../../src/data/dexie/categorizationRuleRepository';
import { MerchantCategorySignalRepository } from '../../src/data/dexie/merchantCategorySignalRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { MIN_STREAK } from '../../src/domain/categorization/categorizationEngine';
import {
	applyAutoCategorization,
	listSuggestions,
	setMerchantRule
} from '../../src/domain/categorization/resolveCategorization';
import { resolveMerchant } from '../../src/domain/parser/merchantResolver';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { buildDataTemplate, importDataTemplate } from '../../src/data/io/templateService';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

describe('Auto-categorization fixes', () => {
	let key: CryptoKey;
	let accountId: string;
	let dining: string;
	let transport: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('2468', randomSaltBase64());
		accountId = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		dining = (await CategoryRepository.create(key, { name: 'Dining' })).id;
		transport = (await CategoryRepository.create(key, { name: 'Transport' })).id;
	});

	/** Records an unreviewed entry for a merchant and confirms it into `categoryId`. */
	async function confirmInto(merchantId: string, categoryId: string) {
		const tx = await TransactionEngine.recordTransaction(key, {
			accountId,
			date: '2026-01-01',
			amount: -100,
			type: 'expense',
			merchantId,
			source: 'quick_add',
			reviewStatus: 'unreviewed'
		});
		await TransactionEngine.confirmTransaction(key, tx.id, [{ categoryId, amount: -100 }]);
		return tx;
	}

	async function uncategorized(
		merchantId: string | null,
		amount = -100,
		type: 'expense' | 'transfer' = 'expense'
	) {
		return TransactionEngine.recordTransaction(key, {
			accountId,
			date: '2026-01-05',
			amount,
			type,
			merchantId
		});
	}

	async function categoryOf(txId: string) {
		return (await TransactionRepository.getSplits(key, txId))[0];
	}

	describe('suggestions that duplicate an existing rule', () => {
		it('never lists a merchant that already has a rule', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			for (let i = 0; i < MIN_STREAK; i++) await confirmInto(merchant.id, transport);
			expect(await listSuggestions(key)).toEqual([
				{ merchantId: merchant.id, categoryId: transport }
			]);

			await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: transport,
				tagIds: []
			});
			expect(await listSuggestions(key)).toEqual([]);
		});

		it('a rule-categorized merchant never builds a suggestion to promote to the rule it already is', async () => {
			// The reported bug: the rule pre-fills the category, the user confirms it three times, and the
			// confirmations form a "streak" that was then offered back as a suggestion.
			const merchant = await MerchantRepository.create(key, 'Swiggy');
			await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: dining,
				tagIds: []
			});
			for (let i = 0; i < MIN_STREAK + 1; i++) {
				const tx = await TransactionEngine.recordTransaction(key, {
					accountId,
					date: '2026-01-02',
					amount: -250,
					type: 'expense',
					merchantId: merchant.id,
					source: 'quick_add',
					reviewStatus: 'unreviewed'
				});
				expect((await categoryOf(tx.id)).categorizationSource).toBe('rule');
				await TransactionEngine.confirmTransaction(key, tx.id, [
					{ categoryId: dining, amount: -250 }
				]);
			}
			expect(await listSuggestions(key)).toEqual([]);
		});

		it('lists the suggestion again if the rule is deleted', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			for (let i = 0; i < MIN_STREAK; i++) await confirmInto(merchant.id, transport);
			const rule = await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: transport,
				tagIds: []
			});
			await CategorizationRuleRepository.remove(rule.id);
			expect(await listSuggestions(key)).toHaveLength(1);
		});

		it('an alias-only rule does not hide the merchant-level suggestion for its other aliases', async () => {
			const resolved = await resolveMerchant(key, 'UBER INDIA');
			for (let i = 0; i < MIN_STREAK; i++) await confirmInto(resolved.merchantId, transport);
			await CategorizationRuleRepository.create(key, {
				merchantId: resolved.merchantId,
				merchantAliasId: resolved.aliasId,
				categoryId: transport,
				tagIds: []
			});
			expect(await listSuggestions(key)).toHaveLength(1);
		});
	});

	describe('rule uniqueness', () => {
		it('rejects a second rule for the same merchant and scope', async () => {
			const merchant = await MerchantRepository.create(key, 'Starbucks');
			await CategorizationRuleRepository.create(key, {
				merchantId: merchant.id,
				categoryId: dining,
				tagIds: []
			});
			await expect(
				CategorizationRuleRepository.create(key, {
					merchantId: merchant.id,
					categoryId: transport,
					tagIds: []
				})
			).rejects.toBeInstanceOf(DuplicateRuleError);
		});

		it('allows a merchant-wide rule alongside an alias-scoped one', async () => {
			const resolved = await resolveMerchant(key, 'Starbucks Coffee');
			await CategorizationRuleRepository.create(key, {
				merchantId: resolved.merchantId,
				categoryId: dining,
				tagIds: []
			});
			await expect(
				CategorizationRuleRepository.create(key, {
					merchantId: resolved.merchantId,
					merchantAliasId: resolved.aliasId,
					categoryId: transport,
					tagIds: []
				})
			).resolves.toBeDefined();
		});

		it('rejects an edit that would collide with another rule', async () => {
			const a = await MerchantRepository.create(key, 'A');
			const b = await MerchantRepository.create(key, 'B');
			await CategorizationRuleRepository.create(key, {
				merchantId: a.id,
				categoryId: dining,
				tagIds: []
			});
			const ruleB = await CategorizationRuleRepository.create(key, {
				merchantId: b.id,
				categoryId: dining,
				tagIds: []
			});
			await expect(
				CategorizationRuleRepository.update(key, ruleB.id, { merchantId: a.id })
			).rejects.toBeInstanceOf(DuplicateRuleError);

			await CategorizationRuleRepository.remove(ruleB.id);
			await expect(
				CategorizationRuleRepository.create(key, {
					merchantId: b.id,
					categoryId: transport,
					tagIds: []
				})
			).resolves.toBeDefined();
		});

		it('setMerchantRule creates, then updates in place, and clears the learning streak', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			for (let i = 0; i < MIN_STREAK; i++) await confirmInto(merchant.id, transport);

			const created = await setMerchantRule(key, merchant.id, transport);
			expect(await MerchantCategorySignalRepository.get(key, merchant.id)).toBeNull();

			const updated = await setMerchantRule(key, merchant.id, dining, []);
			expect(updated.id).toBe(created.id);
			expect(updated.categoryId).toBe(dining);
			expect(await CategorizationRuleRepository.listForMerchant(key, merchant.id)).toHaveLength(1);
		});
	});

	describe('learning', () => {
		it('confirming a merchant as Uncategorized does not poison its streak', async () => {
			const merchant = await MerchantRepository.create(key, 'Metro');
			await confirmInto(merchant.id, transport);
			await confirmInto(merchant.id, transport);
			// A confirmation with no category chosen says nothing about the merchant.
			await confirmInto(merchant.id, UNCATEGORIZED_CATEGORY_ID);
			await confirmInto(merchant.id, transport);

			const signal = await MerchantCategorySignalRepository.get(key, merchant.id);
			expect(signal?.recentCategoryIds).toEqual([transport, transport, transport]);
			expect(await listSuggestions(key)).toEqual([
				{ merchantId: merchant.id, categoryId: transport }
			]);
		});

		it('entries categorized by hand also teach the merchant, not just Review confirmations', async () => {
			const merchant = await MerchantRepository.create(key, 'Local Cafe');
			for (let i = 0; i < MIN_STREAK; i++) {
				await TransactionEngine.recordTransaction(
					key,
					{ accountId, date: '2026-01-03', amount: -90, type: 'expense', merchantId: merchant.id },
					[{ categoryId: dining, amount: -90 }]
				);
			}
			expect(await listSuggestions(key)).toEqual([{ merchantId: merchant.id, categoryId: dining }]);

			// ...and the next entry with no category chosen is filed automatically.
			const next = await uncategorized(merchant.id, -120);
			const split = await categoryOf(next.id);
			expect(split.categoryId).toBe(dining);
			expect(split.categorizationSource).toBe('suggestion');
		});

		it('does not learn from a multi-way split or from an unreviewed entry', async () => {
			const merchant = await MerchantRepository.create(key, 'Mall');
			for (let i = 0; i < MIN_STREAK; i++) {
				await TransactionEngine.recordTransaction(
					key,
					{ accountId, date: '2026-01-03', amount: -100, type: 'expense', merchantId: merchant.id },
					[
						{ categoryId: dining, amount: -60 },
						{ categoryId: transport, amount: -40 }
					]
				);
			}
			expect(await MerchantCategorySignalRepository.get(key, merchant.id)).toBeNull();

			await TransactionEngine.recordTransaction(
				key,
				{
					accountId,
					date: '2026-01-03',
					amount: -100,
					type: 'expense',
					merchantId: merchant.id,
					reviewStatus: 'unreviewed'
				},
				[{ categoryId: dining, amount: -100 }]
			);
			expect(await MerchantCategorySignalRepository.get(key, merchant.id)).toBeNull();
		});
	});

	describe('resolveMerchant reuse (what manual entry now relies on)', () => {
		it('the same merchant typed twice, in any case, is ONE merchant', async () => {
			const first = await resolveMerchant(key, 'Swiggy');
			const second = await resolveMerchant(key, 'swiggy');
			const third = await resolveMerchant(key, 'SWIGGY ');
			expect(second.merchantId).toBe(first.merchantId);
			expect(third.merchantId).toBe(first.merchantId);
			expect(await MerchantRepository.list(key)).toHaveLength(1);
		});
	});

	describe('applyAutoCategorization (apply a rule to what already exists)', () => {
		it('files only still-uncategorized entries from the merchant, leaving user choices alone', async () => {
			const swiggy = await MerchantRepository.create(key, 'Swiggy');
			const other = await MerchantRepository.create(key, 'Other');
			const waiting1 = await uncategorized(swiggy.id);
			const waiting2 = await uncategorized(swiggy.id);
			const alreadyChosen = await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-01-05', amount: -100, type: 'expense', merchantId: swiggy.id },
				[{ categoryId: transport, amount: -100 }]
			);
			const otherMerchant = await uncategorized(other.id);
			const noMerchant = await uncategorized(null);

			await setMerchantRule(key, swiggy.id, dining);

			const dry = await applyAutoCategorization(key, { merchantId: swiggy.id, dryRun: true });
			expect(dry.updated).toBe(2);
			// A dry run writes nothing.
			expect((await categoryOf(waiting1.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);

			const applied = await applyAutoCategorization(key, { merchantId: swiggy.id });
			expect(applied.updated).toBe(2);
			for (const tx of [waiting1, waiting2]) {
				const split = await categoryOf(tx.id);
				expect(split.categoryId).toBe(dining);
				expect(split.categorizationSource).toBe('rule');
				expect(split.amount).toBe(-100);
			}
			expect((await categoryOf(alreadyChosen.id)).categoryId).toBe(transport);
			expect((await categoryOf(otherMerchant.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
			expect((await categoryOf(noMerchant.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);

			// Running it again is a no-op.
			expect((await applyAutoCategorization(key, { merchantId: swiggy.id })).updated).toBe(0);
		});

		it('never touches a transfer, even one tagged with a merchant', async () => {
			const merchant = await MerchantRepository.create(key, 'HDFC');
			const transfer = await uncategorized(merchant.id, -500, 'transfer');
			await setMerchantRule(key, merchant.id, dining);
			expect((await applyAutoCategorization(key)).updated).toBe(0);
			expect((await categoryOf(transfer.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
		});

		it("merges the rule's tags with tags the entry already had", async () => {
			const merchant = await MerchantRepository.create(key, 'Swiggy');
			const tx = await uncategorized(merchant.id);
			const existingTag = await TagRepository.getOrCreate(key, 'lunch');
			await TransactionTagRepository.setTags(tx.id, [existingTag.id]);
			const ruleTag = await TagRepository.getOrCreate(key, 'food-delivery');
			await setMerchantRule(key, merchant.id, dining, [ruleTag.id]);

			await applyAutoCategorization(key, { merchantId: merchant.id });
			const tagIds = await TransactionTagRepository.getTagIds(tx.id);
			expect(new Set(tagIds)).toEqual(new Set([existingTag.id, ruleTag.id]));
		});

		it('limits itself to the review queue when asked', async () => {
			const merchant = await MerchantRepository.create(key, 'Swiggy');
			const confirmed = await uncategorized(merchant.id);
			const queued = await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-01-06',
				amount: -100,
				type: 'expense',
				merchantId: merchant.id,
				source: 'file_import',
				reviewStatus: 'unreviewed'
			});
			await setMerchantRule(key, merchant.id, dining);

			const { updated } = await applyAutoCategorization(key, { unreviewedOnly: true });
			expect(updated).toBe(1);
			expect((await categoryOf(queued.id)).categoryId).toBe(dining);
			expect((await categoryOf(confirmed.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
		});

		it('skips a rule whose category has been deleted', async () => {
			const merchant = await MerchantRepository.create(key, 'Swiggy');
			const tx = await uncategorized(merchant.id);
			await setMerchantRule(key, merchant.id, dining);
			await CategoryRepository.remove(key, dining);
			expect((await applyAutoCategorization(key)).updated).toBe(0);
			expect((await categoryOf(tx.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
		});
	});

	describe('regressions', () => {
		it('never collapses an entry split across categories, even if one part is still uncategorized', async () => {
			const merchant = await MerchantRepository.create(key, 'Mall');
			const tx = await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-01-05', amount: -100, type: 'expense', merchantId: merchant.id },
				[
					{ categoryId: transport, amount: -60 },
					{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: -40 }
				]
			);
			await setMerchantRule(key, merchant.id, dining);

			expect(await applyAutoCategorization(key, { merchantId: merchant.id, dryRun: true })).toEqual(
				{
					updated: 0
				}
			);
			expect(await applyAutoCategorization(key)).toEqual({ updated: 0 });

			const splits = await TransactionRepository.getSplits(key, tx.id);
			expect(splits.map((s) => [s.categoryId, s.amount]).sort()).toEqual(
				[
					[transport, -60],
					[UNCATEGORIZED_CATEGORY_ID, -40]
				].sort()
			);
		});

		it('a data-template import does not teach the merchant streak a second time', async () => {
			const merchant = await MerchantRepository.create(key, 'Uber');
			// The file's own streak: [A, B]. The entry below is categorized B and is part of that history.
			await MerchantCategorySignalRepository.set(key, merchant.id, [dining, transport]);
			await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-01-05', amount: -100, type: 'expense', merchantId: merchant.id },
				[{ categoryId: transport, amount: -100 }],
				{ skipLearning: true }
			);
			const template = await buildDataTemplate(key);

			await db.delete();
			await db.open();
			const salt = randomSaltBase64();
			const freshKey = await deriveEncryptionKey('8080', salt);
			const pinSalt = randomSaltBase64();
			await UserProfileRepository.create({
				pinVerifierHash: await hashPin('8080', pinSalt),
				pinSalt,
				encryptionSalt: salt,
				biometricEnabled: false,
				autoLockTimeoutMs: 300_000,
				storagePersisted: true
			});
			await importDataTemplate(freshKey, template);

			const [importedMerchant] = await MerchantRepository.list(freshKey);
			const importedStreak = (
				await MerchantCategorySignalRepository.get(freshKey, importedMerchant.id)
			)?.recentCategoryIds;
			// Two entries — exactly the file's streak, not [A, B, B].
			expect(importedStreak).toHaveLength(2);
			const names = await Promise.all(
				importedStreak!.map(async (id) => (await CategoryRepository.getById(freshKey, id))?.name)
			);
			expect(names).toEqual(['Dining', 'Transport']);
		});

		it('still learns from a manual entry (the default), but not when skipLearning is set', async () => {
			const merchant = await MerchantRepository.create(key, 'Cafe');
			await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-01-05', amount: -10, type: 'expense', merchantId: merchant.id },
				[{ categoryId: dining, amount: -10 }]
			);
			expect(
				(await MerchantCategorySignalRepository.get(key, merchant.id))?.recentCategoryIds
			).toEqual([dining]);
			await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-01-06', amount: -10, type: 'expense', merchantId: merchant.id },
				[{ categoryId: transport, amount: -10 }],
				{ skipLearning: true }
			);
			expect(
				(await MerchantCategorySignalRepository.get(key, merchant.id))?.recentCategoryIds
			).toEqual([dining]);
		});
	});
});
