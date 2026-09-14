import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// spec 017, FR-001/FR-019: credit limit / billing cycle day / card identifier fields persist and
// round-trip through AccountRepository exactly like every other Account field.
describe('AccountRepository credit card fields against Dexie', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('4242', randomSaltBase64());
	});

	it('persists creditLimit and billingCycleDay on create', async () => {
		const account = await AccountRepository.create(key, {
			name: 'HDFC Card',
			type: 'credit_card',
			openingBalance: 0,
			creditLimit: 10000000,
			billingCycleDay: 5
		});
		const reloaded = await AccountRepository.getById(key, account.id);
		expect(reloaded?.creditLimit).toBe(10000000);
		expect(reloaded?.billingCycleDay).toBe(5);
	});

	it('defaults creditLimit/billingCycleDay to null when omitted', async () => {
		const account = await AccountRepository.create(key, {
			name: 'ICICI Card',
			type: 'credit_card',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		const reloaded = await AccountRepository.getById(key, account.id);
		expect(reloaded?.creditLimit).toBeNull();
		expect(reloaded?.billingCycleDay).toBeNull();
	});

	it('updates creditLimit and billingCycleDay on edit, including clearing back to null', async () => {
		const account = await AccountRepository.create(key, {
			name: 'SBI Card',
			type: 'credit_card',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});

		const updated = await AccountRepository.update(key, account.id, {
			creditLimit: 5000000,
			billingCycleDay: 20
		});
		expect(updated.creditLimit).toBe(5000000);
		expect(updated.billingCycleDay).toBe(20);

		const cleared = await AccountRepository.update(key, account.id, {
			creditLimit: null,
			billingCycleDay: null
		});
		expect(cleared.creditLimit).toBeNull();
		expect(cleared.billingCycleDay).toBeNull();
	});

	it('persists cardLast4 and cardNickname on create and update', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Amazon Pay ICICI',
			type: 'credit_card',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null,
			cardLast4: '4321',
			cardNickname: 'Amazon card'
		});
		expect((await AccountRepository.getById(key, account.id))?.cardLast4).toBe('4321');
		expect((await AccountRepository.getById(key, account.id))?.cardNickname).toBe('Amazon card');

		const updated = await AccountRepository.update(key, account.id, {
			cardLast4: '8765',
			cardNickname: null
		});
		expect(updated.cardLast4).toBe('8765');
		expect(updated.cardNickname).toBeNull();
	});

	it('defaults cardLast4/cardNickname to null when omitted (untagged account)', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		const reloaded = await AccountRepository.getById(key, account.id);
		expect(reloaded?.cardLast4).toBeNull();
		expect(reloaded?.cardNickname).toBeNull();
	});
});
