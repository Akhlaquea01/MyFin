import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { LiabilityRepository } from '../../src/data/dexie/wealthRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { linkedTransactionNotice } from '../../src/domain/transactions/linkedTransactionNotice';
import {
	computeNetWorth,
	recordLiabilityPayment,
	undoLiabilityPayment
} from '../../src/domain/wealth/wealthEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// A loan is not an account, so paying its EMI used to leave the balance owed untouched.
describe('paying a loan or card liability from an account', () => {
	let key: CryptoKey;
	let bankId: string;
	let loanId: string;

	async function bankBalance() {
		return (await AccountRepository.getById(key, bankId))!.currentBalance;
	}
	async function owed(id = loanId) {
		return (await LiabilityRepository.getById(key, id))!.outstandingBalance;
	}
	const pay = (amount: number, extra: Record<string, unknown> = {}) =>
		recordLiabilityPayment(key, {
			liabilityId: loanId,
			amount,
			date: '2026-03-05',
			accountId: bankId,
			...extra
		});

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('4747', randomSaltBase64());
		bankId = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 500_000,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		loanId = (
			await LiabilityRepository.create(key, {
				name: 'Home Loan',
				type: 'loan',
				outstandingBalance: 1_000_000,
				emiAmount: 100_000,
				emiDueDay: 5
			})
		).id;
	});

	it('takes the money out of the account and brings the balance owed down by the same amount', async () => {
		const { liability, payment } = await pay(100_000);

		expect(liability.outstandingBalance).toBe(900_000);
		expect(await owed()).toBe(900_000);
		expect(await bankBalance()).toBe(400_000);

		const tx = (await TransactionRepository.getById(key, payment.transactionId))!;
		expect(tx.type).toBe('expense');
		expect(tx.amount).toBe(-100_000);
		expect(tx.accountId).toBe(bankId);
		expect(tx.date).toBe('2026-03-05');
		expect(tx.notes).toBe('Payment to Home Loan');
		expect(liability.payments).toEqual([payment]);
	});

	it('does not change net worth — cash and debt fall together', async () => {
		const before = (await computeNetWorth(key)).netWorth;
		await pay(250_000);
		expect((await computeNetWorth(key)).netWorth).toBe(before);
	});

	it('can file the payment under a category', async () => {
		const emi = await CategoryRepository.create(key, { name: 'Loan EMI' });
		const { payment } = await pay(100_000, { categoryId: emi.id });
		const [split] = await TransactionRepository.getSplits(key, payment.transactionId);
		expect(split.categoryId).toBe(emi.id);
		expect(split.amount).toBe(-100_000);
	});

	it('pays a loan down to zero over several payments, and then refuses any more', async () => {
		await pay(400_000);
		await pay(600_000);
		expect(await owed()).toBe(0);
		await expect(pay(1)).rejects.toThrow(/more than the 0\.00 still owed/);
		expect((await LiabilityRepository.getById(key, loanId))!.payments).toHaveLength(2);
	});

	describe('refusals leave everything untouched', () => {
		async function expectUntouched() {
			expect(await owed()).toBe(1_000_000);
			expect(await bankBalance()).toBe(500_000);
			expect(await TransactionRepository.search(key, {})).toHaveLength(0);
		}

		it('a zero or negative amount', async () => {
			await expect(pay(0)).rejects.toThrow(/greater than zero/);
			await expect(pay(-5)).rejects.toThrow(/greater than zero/);
			await expectUntouched();
		});

		it('more than is owed', async () => {
			await expect(pay(1_000_001)).rejects.toThrow(/more than the 10000\.00 still owed/);
			await expectUntouched();
		});

		it('paying from a credit card', async () => {
			const card = await AccountRepository.create(key, {
				name: 'Card',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: 100_000,
				billingCycleDay: null
			});
			await expect(pay(1_000, { accountId: card.id })).rejects.toThrow(/not from a credit card/);
			await expectUntouched();
		});

		it('an account that does not exist', async () => {
			await expect(pay(1_000, { accountId: 'nope' })).rejects.toThrow(/Account not found/);
			await expectUntouched();
		});

		it('a liability that does not exist', async () => {
			await expect(
				recordLiabilityPayment(key, {
					liabilityId: 'nope',
					amount: 1_000,
					date: '2026-03-05',
					accountId: bankId
				})
			).rejects.toThrow(/Liability not found/);
			await expectUntouched();
		});

		it('a card that is already tracked as an account — that one is paid with Pay bill', async () => {
			const card = await AccountRepository.create(key, {
				name: 'HDFC Card',
				type: 'credit_card',
				openingBalance: -50_000,
				creditLimit: 100_000,
				billingCycleDay: null
			});
			const linked = await LiabilityRepository.create(key, {
				name: 'HDFC Card',
				type: 'credit_card',
				outstandingBalance: 50_000,
				emiAmount: null,
				emiDueDay: null,
				linkedAccountId: card.id
			});
			await expect(
				recordLiabilityPayment(key, {
					liabilityId: linked.id,
					amount: 1_000,
					date: '2026-03-05',
					accountId: bankId
				})
			).rejects.toThrow(/Pay bill/);
			expect(await bankBalance()).toBe(500_000);
		});
	});

	describe('undoing a payment', () => {
		it('puts the money back and owes the amount again', async () => {
			const { payment } = await pay(100_000);
			await pay(50_000);

			const liability = await undoLiabilityPayment(key, loanId, payment.id);
			expect(liability.outstandingBalance).toBe(1_000_000 - 50_000);
			expect(liability.payments).toHaveLength(1);
			expect(await bankBalance()).toBe(500_000 - 50_000);
			// The reversed entry is in Trash, not in the ledger.
			expect(await TransactionRepository.search(key, {})).toHaveLength(1);
		});

		it('refuses a payment that is not on this liability', async () => {
			await pay(1_000);
			await expect(undoLiabilityPayment(key, loanId, 'missing')).rejects.toThrow(
				/Payment not found/
			);
			expect(await owed()).toBe(999_000);
		});
	});

	describe('the ledger entry is protected, because it is half of the payment', () => {
		it('is recognised as a liability payment', async () => {
			const { payment } = await pay(100_000);
			expect(await TransactionRepository.getLoanLink(key, payment.transactionId)).toEqual({
				kind: 'liability-payment',
				liabilityId: loanId
			});
			expect(await TransactionRepository.getLoanLink(key, 'something-else')).toBeNull();
		});

		it('cannot be turned into a transfer, permanently purged, or offered as a transfer match', async () => {
			const { payment } = await pay(100_000);
			await expect(
				TransactionEngine.convertToTransfer(key, payment.transactionId, { accountId: bankId })
			).rejects.toThrow(/Liabilities page/);

			await TransactionRepository.softDelete(key, payment.transactionId);
			await expect(TransactionRepository.purge(key, payment.transactionId)).rejects.toThrow(
				/liability payment/
			);

			// A matching credit on another account must not be linked to it either.
			const savings = await AccountRepository.create(key, {
				name: 'Savings',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			const credit = await TransactionEngine.recordTransaction(key, {
				accountId: savings.id,
				date: '2026-03-05',
				amount: 100_000,
				type: 'income'
			});
			await TransactionRepository.restore(key, payment.transactionId);
			expect(await TransactionEngine.findTransferCandidates(key, credit.id)).toEqual([]);
		});

		it('is explained by a notice that points at the Liabilities page', () => {
			const notice = linkedTransactionNotice({ kind: 'liability-payment', liabilityId: 'x' });
			expect(notice.to).toBe('/liabilities');
			expect(notice.message).toMatch(/Liabilities page/);
			expect(linkedTransactionNotice({ kind: 'loan', loanId: 'x' }).to).toBe('/people');
		});
	});
});
