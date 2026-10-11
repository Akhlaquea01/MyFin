import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { TagRepository, TransactionTagRepository } from '../../src/data/dexie/tagRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { buildExportRows, exportToCsvBlob } from '../../src/data/io/exportService';
import { parseCsv } from '../../src/data/io/importService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('export', () => {
	let key: CryptoKey;
	let bankId: string;
	let cardId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('7070', randomSaltBase64());
		bankId = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 100_000,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		cardId = (
			await AccountRepository.create(key, {
				name: 'HDFC Card',
				type: 'credit_card',
				openingBalance: -40_000,
				creditLimit: 500_000,
				billingCycleDay: null
			})
		).id;
	});

	async function csvText(): Promise<string> {
		return exportToCsvBlob(await buildExportRows(key)).text();
	}

	it('says what kind each row is, and which account a transfer went to or came from', async () => {
		await TransactionEngine.recordTransfer(key, {
			fromAccountId: bankId,
			toAccountId: cardId,
			amount: 15_000,
			date: '2026-03-10',
			notes: 'Card bill'
		});
		const rows = await buildExportRows(key);
		const out = rows.find((r) => r.account === 'Checking')!;
		const into = rows.find((r) => r.account === 'HDFC Card')!;

		expect(out).toMatchObject({ type: 'transfer', counterpart: 'HDFC Card', amount: '-150.00' });
		expect(into).toMatchObject({ type: 'transfer', counterpart: 'Checking', amount: '150.00' });
		// A transfer is not categorized spending, so it is not "Uncategorized" either.
		expect(out.categories).toBe('');
		expect(into.categories).toBe('');
	});

	it('includes the merchant, the tags and whether the entry is still waiting in Review', async () => {
		const food = await CategoryRepository.create(key, { name: 'Food' });
		const groceries = await CategoryRepository.create(key, {
			name: 'Groceries',
			parentId: food.id
		});
		const merchant = await MerchantRepository.create(key, 'Swiggy');
		const tx = await TransactionEngine.recordTransaction(
			key,
			{
				accountId: bankId,
				date: '2026-03-02',
				amount: -25_000,
				type: 'expense',
				merchantId: merchant.id,
				notes: 'Dinner'
			},
			[{ categoryId: groceries.id, amount: -25_000 }]
		);
		const [lunch, work] = await Promise.all([
			TagRepository.getOrCreate(key, 'lunch'),
			TagRepository.getOrCreate(key, 'work')
		]);
		await TransactionTagRepository.setTags(tx.id, [lunch.id, work.id]);
		await TransactionEngine.recordTransaction(key, {
			accountId: bankId,
			date: '2026-03-03',
			amount: -1_000,
			type: 'expense',
			source: 'quick_add',
			reviewStatus: 'unreviewed'
		});

		const rows = await buildExportRows(key);
		const dinner = rows.find((r) => r.notes === 'Dinner')!;
		expect(dinner).toMatchObject({
			type: 'expense',
			merchant: 'Swiggy',
			status: 'confirmed',
			// A subcategory is exported by its full path, as everywhere else.
			categories: 'Food › Groceries',
			counterpart: ''
		});
		expect(new Set(dinner.tags.split('; '))).toEqual(new Set(['lunch', 'work']));
		expect(rows.find((r) => r.date === '2026-03-03')).toMatchObject({
			status: 'unreviewed',
			merchant: '',
			tags: ''
		});
	});

	it('keeps the original five columns first and in order, then adds the new ones', async () => {
		await TransactionEngine.recordTransaction(key, {
			accountId: bankId,
			date: '2026-03-02',
			amount: -500,
			type: 'expense',
			notes: 'Tea'
		});
		const parsed = parseCsv(await csvText());
		expect(parsed.headers).toEqual([
			'date',
			'account',
			'categories',
			'amount',
			'notes',
			'type',
			'merchant',
			'tags',
			'status',
			'counterpart'
		]);
		expect(parsed.rows[0]).toMatchObject({ date: '2026-03-02', amount: '-5.00', notes: 'Tea' });
	});

	it('neutralizes spreadsheet formulas in the new text columns too', async () => {
		const evil = await MerchantRepository.create(key, '=HYPERLINK("http://evil","x")');
		const tag = await TagRepository.getOrCreate(key, '@SUM(A1)');
		const tx = await TransactionEngine.recordTransaction(key, {
			accountId: bankId,
			date: '2026-03-02',
			amount: -500,
			type: 'expense',
			merchantId: evil.id
		});
		await TransactionTagRepository.setTags(tx.id, [tag.id]);

		const parsed = parseCsv(await csvText());
		const row = parsed.rows[0];
		// Each starts with a tab, so a spreadsheet shows text instead of evaluating it.
		expect(row.merchant.startsWith('\t=HYPERLINK')).toBe(true);
		expect(row.tags.startsWith('\t@SUM')).toBe(true);
		// The generated columns are left alone.
		expect(row.type).toBe('expense');
		expect(row.amount).toBe('-5.00');
	});

	it('exports an empty ledger as no rows', async () => {
		expect(await buildExportRows(key)).toEqual([]);
	});
});
