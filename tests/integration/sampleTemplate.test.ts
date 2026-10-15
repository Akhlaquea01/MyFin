import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { SAMPLE_DATA_TEMPLATE } from '../../src/data/io/sampleTemplate';
import {
	exportDataTemplateToJsonBlob,
	importDataTemplate,
	parseDataTemplate
} from '../../src/data/io/templateService';
import { checkIntegrity } from '../../src/data/io/integrityService';
import { computeNetWorth } from '../../src/domain/wealth/wealthEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('the downloadable sample template', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8181', randomSaltBase64());
	});

	it('is a valid template that imports cleanly into a fresh install', async () => {
		const text = await exportDataTemplateToJsonBlob(SAMPLE_DATA_TEMPLATE).text();
		const parsed = parseDataTemplate(text);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const result = await importDataTemplate(key, parsed.template);
		expect(result.rejected).toBeUndefined();
		expect(result.skippedReasons).toEqual([]);

		expect((await TransactionRepository.search(key)).length).toBeGreaterThan(0);
		expect((await checkIntegrity(key)).issues).toEqual([]);
	});

	it('does not pretend to be wealthy: balances are of a believable size', async () => {
		const parsed = parseDataTemplate(
			await exportDataTemplateToJsonBlob(SAMPLE_DATA_TEMPLATE).text()
		);
		if (!parsed.ok) throw new Error(parsed.message);
		await importDataTemplate(key, parsed.template);

		const ONE_CRORE_MINOR = 10_000_000 * 100;
		for (const account of await AccountRepository.list(key)) {
			expect(Math.abs(account.currentBalance)).toBeLessThan(ONE_CRORE_MINOR);
			expect(account.name).not.toMatch(/^Ac$|Akhlaque/);
		}
		expect(Math.abs((await computeNetWorth(key)).netWorth)).toBeLessThan(ONE_CRORE_MINOR);
	});
	it('keeps an entry whose splits do not add up, uncategorized, instead of aborting the import', async () => {
		const template = structuredClone(SAMPLE_DATA_TEMPLATE);
		template.entities.transactionSplits = template.entities.transactionSplits!.map((split) =>
			split.transactionId === 'tx111111-1111-4111-8111-111111111111'
				? { ...split, amount: split.amount + 100 }
				: split
		);

		const result = await importDataTemplate(key, template);

		expect(result.rejected).toBeUndefined();
		expect(result.perEntity.transactions.created).toBe(3);
		expect(result.skippedReasons).toContainEqual(
			expect.objectContaining({
				entity: 'transactionSplits',
				identifier: 'tx111111-1111-4111-8111-111111111111'
			})
		);
		expect((await checkIntegrity(key)).issues).toEqual([]);
	});
	it('skips an entry with no usable date, reporting it, and still imports the rest', async () => {
		const template = structuredClone(SAMPLE_DATA_TEMPLATE);
		template.entities.transactions![0].date = '';

		const result = await importDataTemplate(key, template);

		expect(result.rejected).toBeUndefined();
		expect(result.perEntity.transactions.created).toBe(2);
		expect(result.skippedReasons).toContainEqual(
			expect.objectContaining({
				entity: 'transactions',
				identifier: 'tx111111-1111-4111-8111-111111111111'
			})
		);
		expect((await checkIntegrity(key)).issues).toEqual([]);
	});
});
