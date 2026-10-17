import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
	PersonRepository,
	PersonLoanRepository,
	LoanRepaymentRepository
} from '../../src/data/dexie/personLoanRepository';
import { computePendingBalance } from '../../src/domain/personLoans/loanProgress';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('settling and removing person loans', () => {
	let key: CryptoKey;
	let accountId: string;

	async function balance(): Promise<number> {
		return (await AccountRepository.getById(key, accountId))!.currentBalance;
	}

	async function pending(loanId: string): Promise<number> {
		const loan = (await PersonLoanRepository.getById(key, loanId))!;
		return computePendingBalance({
			principalAmount: loan.principalAmount,
			writeOffAmount: loan.writeOffAmount,
			repayments: await LoanRepaymentRepository.listForLoan(key, loanId)
		});
	}

	async function lend(amount: number, direction: 'lent' | 'borrowed' = 'lent') {
		const person = await PersonRepository.create(key, { name: 'Asha' });
		return PersonLoanRepository.create(key, {
			personId: person.id,
			direction,
			principalAmount: amount,
			date: '2026-03-01',
			dueDate: null,
			notes: null,
			accountId
		});
	}

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('9753', randomSaltBase64());
		accountId = (
			await AccountRepository.create(key, {
				name: 'Cash',
				type: 'cash',
				openingBalance: 500_000,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
	});

	describe('LoanRepaymentRepository.settle', () => {
		it('repays everything still owed on money I lent, in one step', async () => {
			const loan = await lend(100_000);
			await LoanRepaymentRepository.create(key, {
				loanId: loan.id,
				amount: 30_000,
				date: '2026-03-05',
				accountId
			});
			expect(await balance()).toBe(500_000 - 100_000 + 30_000);

			const repayment = await LoanRepaymentRepository.settle(key, {
				loanId: loan.id,
				date: '2026-03-10',
				accountId
			});
			// Exactly the remainder — not the principal, and not a typed-in guess.
			expect(repayment.amount).toBe(70_000);
			expect(await pending(loan.id)).toBe(0);
			expect(await balance()).toBe(500_000);
		});

		it('pays back money I borrowed, taking it out of the account', async () => {
			const loan = await lend(40_000, 'borrowed');
			expect(await balance()).toBe(540_000);
			await LoanRepaymentRepository.settle(key, { loanId: loan.id, date: '2026-03-10', accountId });
			expect(await pending(loan.id)).toBe(0);
			expect(await balance()).toBe(500_000);
		});

		it('can settle from a different account than the loan was made from', async () => {
			const loan = await lend(25_000);
			const other = await AccountRepository.create(key, {
				name: 'Savings',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
			await LoanRepaymentRepository.settle(key, {
				loanId: loan.id,
				date: '2026-03-10',
				accountId: other.id
			});
			expect((await AccountRepository.getById(key, other.id))!.currentBalance).toBe(25_000);
			expect(await balance()).toBe(500_000 - 25_000);
		});

		it('refuses to settle a loan that is already settled', async () => {
			const loan = await lend(10_000);
			await LoanRepaymentRepository.settle(key, { loanId: loan.id, date: '2026-03-10', accountId });
			await expect(
				LoanRepaymentRepository.settle(key, { loanId: loan.id, date: '2026-03-11', accountId })
			).rejects.toThrow(/already settled/);
		});
	});

	describe('PersonLoanRepository.remove', () => {
		it('removes a mis-recorded loan, its repayments and its ledger movement together', async () => {
			const loan = await lend(100_000);
			await LoanRepaymentRepository.create(key, {
				loanId: loan.id,
				amount: 20_000,
				date: '2026-03-05',
				accountId
			});
			expect(await balance()).toBe(420_000);

			await PersonLoanRepository.remove(key, loan.id);

			// The account is exactly as if the loan had never been recorded.
			expect(await balance()).toBe(500_000);
			expect(await PersonLoanRepository.listAllOpen(key)).toHaveLength(0);
			expect(await TransactionRepository.search(key, {})).toHaveLength(0);
			// ...so the person is no longer blocked from deletion by a phantom open loan.
			await expect(PersonRepository.remove(key, loan.personId)).resolves.toBeUndefined();
		});

		it('removes repayments the user had already undone along with the live ones', async () => {
			const loan = await lend(100_000);
			const keptUndone = await LoanRepaymentRepository.create(key, {
				loanId: loan.id,
				amount: 10_000,
				date: '2026-03-02',
				accountId
			});
			await LoanRepaymentRepository.remove(key, keptUndone.id); // undone by the user earlier
			await LoanRepaymentRepository.create(key, {
				loanId: loan.id,
				amount: 20_000,
				date: '2026-03-05',
				accountId
			});

			await PersonLoanRepository.remove(key, loan.id);

			expect(await LoanRepaymentRepository.listAll(key)).toEqual([]);
			expect(await PersonLoanRepository.getById(key, loan.id)).toBeUndefined();
			expect(await balance()).toBe(500_000);
		});
	});

	describe('the ledger movement behind a loan', () => {
		it('is recognised by getLoanLink, as is a repayment, but an ordinary entry is not', async () => {
			const loan = await lend(10_000);
			const repayment = await LoanRepaymentRepository.create(key, {
				loanId: loan.id,
				amount: 1_000,
				date: '2026-03-05',
				accountId
			});
			expect(await TransactionRepository.getLoanLink(key, loan.transactionId)).toEqual({
				kind: 'loan',
				loanId: loan.id
			});
			expect(await TransactionRepository.getLoanLink(key, repayment.transactionId)).toEqual({
				kind: 'repayment',
				loanId: loan.id
			});
			expect(await TransactionRepository.getLoanLink(key, 'some-other-id')).toBeNull();
		});
	});
});
