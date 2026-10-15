import { describe, it, expect } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { PersonRepository, PersonLoanRepository } from '../../src/data/dexie/personLoanRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { buildDataTemplate, importDataTemplate } from '../../src/data/io/templateService';
import type { DataTemplate } from '../../src/data/io/templateTypes';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

// A data template is how a user moves their data between installs. A transfer is two linked legs,
// so the link has to survive the round trip.
describe('data template round trip: transfers', () => {
	let key: CryptoKey;

	async function freshInstall(pin: string): Promise<CryptoKey> {
		await db.delete();
		await db.open();
		const salt = randomSaltBase64();
		const k = await deriveEncryptionKey(pin, salt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt: salt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
		return k;
	}

	async function seed(): Promise<DataTemplate> {
		key = await freshInstall('2020');
		const bank = await AccountRepository.create(key, {
			name: 'Bank',
			type: 'bank',
			openingBalance: 100_000,
			creditLimit: null,
			billingCycleDay: null
		});
		const card = await AccountRepository.create(key, {
			name: 'Card',
			type: 'credit_card',
			openingBalance: -40_000,
			creditLimit: 500_000,
			billingCycleDay: null
		});
		await TransactionEngine.recordTransfer(key, {
			fromAccountId: bank.id,
			toAccountId: card.id,
			amount: 10_000,
			date: '2026-03-01',
			notes: 'Card bill'
		});
		const person = await PersonRepository.create(key, { name: 'Asha' });
		await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 5_000,
			date: '2026-03-02',
			dueDate: null,
			notes: null,
			accountId: bank.id
		});
		return buildDataTemplate(key);
	}

	it('re-links the two legs of a transfer under their new ids', async () => {
		const template = await seed();
		const imported = await freshInstall('3030');
		await importDataTemplate(imported, template);

		const all = await TransactionRepository.search(imported, {});
		const bill = all.filter((t) => t.notes === 'Card bill');
		expect(bill).toHaveLength(2);
		const [a, b] = bill;
		expect(a.type).toBe('transfer');
		expect(a.transferPairId).toBe(b.id);
		expect(b.transferPairId).toBe(a.id);
		expect(a.amount).toBe(-b.amount);
		// No leg points at an id from the old file.
		const ids = new Set(all.map((t) => t.id));
		for (const t of bill) expect(ids.has(t.transferPairId!)).toBe(true);
	});

	it('a re-linked transfer behaves as one movement: deleting either leg removes both', async () => {
		const template = await seed();
		const imported = await freshInstall('3031');
		await importDataTemplate(imported, template);

		const bill = (await TransactionRepository.search(imported, {})).filter(
			(t) => t.notes === 'Card bill'
		);
		await TransactionEngine.deleteTransaction(imported, bill[0].id);
		const remaining = (await TransactionRepository.search(imported, {})).filter(
			(t) => t.notes === 'Card bill'
		);
		expect(remaining).toHaveLength(0);
	});

	it('leaves a person-loan movement as a loan movement (it has no partner by design)', async () => {
		const template = await seed();
		const imported = await freshInstall('3032');
		await importDataTemplate(imported, template);

		const movement = (await TransactionRepository.search(imported, {})).find((t) =>
			t.notes?.startsWith('Lent to')
		)!;
		expect(movement.type).toBe('transfer');
		expect(movement.transferPairId).toBeNull();
		expect(await TransactionRepository.getLoanLink(imported, movement.id)).not.toBeNull();
	});

	it('keeps a leg whose partner is missing from the file as the plain expense it is, not a half-transfer', async () => {
		const template = await seed();
		// Damage the file: drop the card-side leg, as if its account had not been imported.
		const bankLeg = template.entities.transactions.find(
			(t) => t.notes === 'Card bill' && t.amount < 0
		)!;
		template.entities.transactions = template.entities.transactions.filter(
			(t) => !(t.notes === 'Card bill' && t.amount > 0)
		);
		template.entities.transactionSplits = template.entities.transactionSplits.filter((s) =>
			template.entities.transactions.some((t) => t.id === s.transactionId)
		);
		expect(bankLeg.transferPairId).toBeTruthy();

		const imported = await freshInstall('3033');
		await importDataTemplate(imported, template);

		const legs = (await TransactionRepository.search(imported, {})).filter(
			(t) => t.notes === 'Card bill'
		);
		expect(legs).toHaveLength(1);
		expect(legs[0].type).toBe('expense');
		expect(legs[0].transferPairId).toBeNull();
		expect(legs[0].amount).toBe(-10_000);
	});

	it('ignores a pair whose amounts do not mirror each other instead of linking them', async () => {
		const template = await seed();
		const credit = template.entities.transactions.find(
			(t) => t.notes === 'Card bill' && t.amount > 0
		)!;
		credit.amount = 9_999; // corrupted
		template.entities.transactionSplits
			.filter((s) => s.transactionId === credit.id)
			.forEach((s) => (s.amount = 9_999));

		const imported = await freshInstall('3034');
		await importDataTemplate(imported, template);

		const legs = (await TransactionRepository.search(imported, {})).filter(
			(t) => t.notes === 'Card bill'
		);
		expect(legs.every((t) => t.transferPairId === null)).toBe(true);
		expect(legs.every((t) => t.type !== 'transfer')).toBe(true);
	});

	it('importing the same file twice does not unlink or cross-link the first copy', async () => {
		const template = await seed();
		const imported = await freshInstall('3035');
		await importDataTemplate(imported, template);
		await importDataTemplate(imported, template);

		const legs = (await TransactionRepository.search(imported, {})).filter(
			(t) => t.notes === 'Card bill'
		);
		expect(legs).toHaveLength(4); // the second copy is flagged as duplicates, not merged away
		const byId = new Map(legs.map((t) => [t.id, t]));
		for (const t of legs) {
			const partner = byId.get(t.transferPairId!);
			expect(partner, 'every leg has a partner').toBeDefined();
			expect(partner!.transferPairId).toBe(t.id);
			expect(partner!.amount).toBe(-t.amount);
		}
	});
});
