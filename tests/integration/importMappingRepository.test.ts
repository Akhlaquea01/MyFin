import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { ImportMappingRepository } from '../../src/data/dexie/importMappingRepository';
import { headerSignature, presetFromMapping } from '../../src/domain/io/importMappingPresets';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('ImportMappingRepository', () => {
	let key: CryptoKey;
	const bank = ['Txn Date', 'Narration', 'Withdrawal Amt.', 'Deposit Amt.'];
	const card = ['Date', 'Merchant', 'Amount'];

	const bankMapping = () =>
		presetFromMapping(bank, {
			dateColumn: 'Txn Date',
			amountColumn: '',
			descriptionColumn: 'Narration',
			dateFormat: 'DD/MM/YY',
			amountSignConvention: 'separate-debit-credit-columns',
			debitColumn: 'Withdrawal Amt.',
			creditColumn: 'Deposit Amt.'
		});
	const cardMapping = () =>
		presetFromMapping(card, {
			dateColumn: 'Date',
			amountColumn: 'Amount',
			descriptionColumn: 'Merchant',
			dateFormat: 'YYYY-MM-DD',
			amountSignConvention: 'negative-is-expense'
		});

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8484', randomSaltBase64());
	});

	it('finds what was saved by the layout of the file, and nothing for another layout', async () => {
		await ImportMappingRepository.save(key, bankMapping());
		await ImportMappingRepository.save(key, cardMapping());

		const found = await ImportMappingRepository.findBySignature(key, headerSignature(bank));
		expect(found).toMatchObject({ dateFormat: 'DD/MM/YY', debitColumn: 'Withdrawal Amt.' });
		const other = await ImportMappingRepository.findBySignature(key, headerSignature(card));
		expect(other).toMatchObject({ dateFormat: 'YYYY-MM-DD', amountColumn: 'Amount' });
		expect(
			await ImportMappingRepository.findBySignature(key, headerSignature(['Date', 'Other']))
		).toBeNull();
	});

	it('replaces the earlier mapping for the same layout instead of piling up copies', async () => {
		const first = await ImportMappingRepository.save(key, bankMapping());
		const second = await ImportMappingRepository.save(key, {
			...bankMapping(),
			dateFormat: 'DD-MM-YYYY'
		});

		expect(second.id).toBe(first.id);
		expect(second.createdAt).toBe(first.createdAt);
		const all = await ImportMappingRepository.list(key);
		expect(all).toHaveLength(1);
		expect(all[0].dateFormat).toBe('DD-MM-YYYY');
	});

	it('can forget a mapping', async () => {
		const saved = await ImportMappingRepository.save(key, bankMapping());
		await ImportMappingRepository.delete(saved.id);
		expect(await ImportMappingRepository.list(key)).toEqual([]);
	});

	it('stores nothing readable — the header names describe the user’s bank', async () => {
		await ImportMappingRepository.save(key, bankMapping());
		const raw = JSON.stringify(await db.importMappings.toArray());
		expect(raw).not.toContain('Narration');
		expect(raw).not.toContain('Withdrawal');
		expect(raw).not.toContain('DD/MM/YY');
	});

	it('cannot be read with a different key — and is discarded rather than breaking the list', async () => {
		await ImportMappingRepository.save(key, bankMapping());
		const other = await deriveEncryptionKey('9999', randomSaltBase64());
		expect(await ImportMappingRepository.list(other)).toEqual([]);
		expect(await db.importMappings.count()).toBe(0);
	});
});
