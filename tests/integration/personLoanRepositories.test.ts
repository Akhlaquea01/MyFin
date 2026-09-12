import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import {
	PersonRepository,
	PersonLoanRepository,
	LoanRepaymentRepository
} from '../../src/data/dexie/personLoanRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Person/PersonLoan/LoanRepayment repositories against Dexie', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8888', randomSaltBase64());
	});

	async function cashAccount(openingBalance = 500000) {
		return AccountRepository.create(key, {
			name: 'Cash',
			type: 'cash',
			openingBalance,
			creditLimit: null,
			billingCycleDay: null
		});
	}

	it('a lent loan decreases the account balance and a borrowed loan increases it', async () => {
		const account = await cashAccount();
		const person = await PersonRepository.create(key, { name: 'Asha' });

		await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 1000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});
		let updated = await AccountRepository.getById(key, account.id);
		expect(updated?.currentBalance).toBe(500000 - 1000);

		await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'borrowed',
			principalAmount: 400,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});
		updated = await AccountRepository.getById(key, account.id);
		expect(updated?.currentBalance).toBe(500000 - 1000 + 400);
	});

	it('a repayment moves the balance the opposite way from its loan, per direction', async () => {
		const account = await cashAccount();
		const person = await PersonRepository.create(key, { name: 'Rohit' });

		const lentLoan = await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 1000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});
		await LoanRepaymentRepository.create(key, {
			loanId: lentLoan.id,
			amount: 400,
			date: '2026-09-05',
			accountId: account.id
		});
		let updated = await AccountRepository.getById(key, account.id);
		expect(updated?.currentBalance).toBe(500000 - 1000 + 400);

		const borrowedLoan = await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'borrowed',
			principalAmount: 300,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});
		await LoanRepaymentRepository.create(key, {
			loanId: borrowedLoan.id,
			amount: 300,
			date: '2026-09-06',
			accountId: account.id
		});
		updated = await AccountRepository.getById(key, account.id);
		expect(updated?.currentBalance).toBe(500000 - 1000 + 400 + 300 - 300);
	});

	it('rejects non-positive loan and repayment amounts (FR-018)', async () => {
		const account = await cashAccount();
		const person = await PersonRepository.create(key, { name: 'Meera' });

		await expect(
			PersonLoanRepository.create(key, {
				personId: person.id,
				direction: 'lent',
				principalAmount: 0,
				date: '2026-09-01',
				dueDate: null,
				notes: null,
				accountId: account.id
			})
		).rejects.toThrow();

		const loan = await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 1000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});
		await expect(
			LoanRepaymentRepository.create(key, {
				loanId: loan.id,
				amount: -50,
				date: '2026-09-02',
				accountId: account.id
			})
		).rejects.toThrow();
	});

	it('rejects a repayment exceeding the remaining balance, and any repayment against a settled loan (FR-007)', async () => {
		const account = await cashAccount();
		const person = await PersonRepository.create(key, { name: 'Divya' });
		const loan = await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 1000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});

		await expect(
			LoanRepaymentRepository.create(key, {
				loanId: loan.id,
				amount: 1500,
				date: '2026-09-02',
				accountId: account.id
			})
		).rejects.toThrow();

		await LoanRepaymentRepository.create(key, {
			loanId: loan.id,
			amount: 1000,
			date: '2026-09-03',
			accountId: account.id
		});

		await expect(
			LoanRepaymentRepository.create(key, {
				loanId: loan.id,
				amount: 100,
				date: '2026-09-04',
				accountId: account.id
			})
		).rejects.toThrow();
	});

	it('blocks deleting a person with an open loan, and allows it once none remain (FR-015)', async () => {
		const account = await cashAccount();
		const person = await PersonRepository.create(key, { name: 'Karan' });
		const loan = await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'borrowed',
			principalAmount: 500,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});

		await expect(PersonRepository.softDelete(key, person.id)).rejects.toThrow();

		await LoanRepaymentRepository.create(key, {
			loanId: loan.id,
			amount: 500,
			date: '2026-09-02',
			accountId: account.id
		});
		await PersonRepository.softDelete(key, person.id);
		expect((await PersonRepository.list(key)).map((p) => p.id)).not.toContain(person.id);
	});

	it('soft-deleting a repayment reverses its transaction, and restore re-applies it', async () => {
		const account = await cashAccount();
		const person = await PersonRepository.create(key, { name: 'Priya' });
		const loan = await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 1000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});
		const afterLoanBalance = (await AccountRepository.getById(key, account.id))?.currentBalance;

		const repayment = await LoanRepaymentRepository.create(key, {
			loanId: loan.id,
			amount: 400,
			date: '2026-09-05',
			accountId: account.id
		});
		const afterRepaymentBalance = (await AccountRepository.getById(key, account.id))
			?.currentBalance;
		expect(afterRepaymentBalance).toBe((afterLoanBalance ?? 0) + 400);

		await LoanRepaymentRepository.softDelete(key, repayment.id);
		const afterUndoBalance = (await AccountRepository.getById(key, account.id))?.currentBalance;
		expect(afterUndoBalance).toBe(afterLoanBalance);

		await LoanRepaymentRepository.restore(key, repayment.id);
		const afterRestoreBalance = (await AccountRepository.getById(key, account.id))?.currentBalance;
		expect(afterRestoreBalance).toBe(afterRepaymentBalance);
	});

	it('writing off a loan does not change the account balance', async () => {
		const account = await cashAccount();
		const person = await PersonRepository.create(key, { name: 'Rohit' });
		const loan = await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 200,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});
		const beforeWriteOff = (await AccountRepository.getById(key, account.id))?.currentBalance;

		const written = await PersonLoanRepository.writeOff(key, loan.id);
		expect(written.writeOffAmount).toBe(200);
		expect(written.writeOffAt).not.toBeNull();

		const afterWriteOff = (await AccountRepository.getById(key, account.id))?.currentBalance;
		expect(afterWriteOff).toBe(beforeWriteOff);

		await expect(PersonLoanRepository.writeOff(key, loan.id)).rejects.toThrow();
	});
});
