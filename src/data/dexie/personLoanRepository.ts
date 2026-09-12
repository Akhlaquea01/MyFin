import { db, type PersonRow, type PersonLoanRow, type PersonLoanRepaymentRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import { deletedAtIndex, NOT_DELETED } from './indexable';
import { TransactionEngine } from '../../domain/transactions/transactionEngine';
import {
	computePendingBalance,
	validateRepaymentAmount,
	validateWriteOffAmount
} from '../../domain/personLoans/loanProgress';
import type { Person, PersonLoan, LoanRepayment, LoanDirection } from '../../domain/entities';

export const PersonRepository = {
	async create(key: CryptoKey, input: { name: string; notes?: string | null }): Promise<Person> {
		const now = Date.now();
		const person: Person = {
			id: crypto.randomUUID(),
			name: input.name.trim(),
			notes: input.notes ?? null,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
		await putEncrypted(db.people, key, person, { deletedAt: NOT_DELETED });
		return person;
	},

	async update(key: CryptoKey, id: string, changes: Partial<Person>): Promise<Person> {
		const existing = await getDecrypted<PersonRow, Person>(db.people, key, id);
		if (!existing) throw new Error(`Person ${id} not found`);
		const updated: Person = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.people, key, updated, { deletedAt: deletedAtIndex(updated.deletedAt) });
		return updated;
	},

	async getById(key: CryptoKey, id: string): Promise<Person | undefined> {
		return getDecrypted<PersonRow, Person>(db.people, key, id);
	},

	async list(key: CryptoKey): Promise<Person[]> {
		const rows = await db.people.filter((row) => row.deletedAt === NOT_DELETED).toArray();
		return decryptRows<PersonRow, Person>(key, rows);
	},

	/** Blocks deletion while any of the person's loans still has a positive pending balance
	 *  (FR-015) — enforced here, not only in the UI, per research.md §6. */
	async softDelete(key: CryptoKey, id: string): Promise<void> {
		const loans = await PersonLoanRepository.listForPerson(key, id);
		for (const loan of loans) {
			const repayments = await LoanRepaymentRepository.listForLoan(key, loan.id);
			const pendingBalance = computePendingBalance({
				principalAmount: loan.principalAmount,
				writeOffAmount: loan.writeOffAmount,
				repayments
			});
			if (pendingBalance > 0) {
				throw new Error(
					'This person has an open loan. Settle or write it off before deleting them.'
				);
			}
		}
		await this.update(key, id, { deletedAt: Date.now() });
	},

	async restore(key: CryptoKey, id: string): Promise<void> {
		await this.update(key, id, { deletedAt: null });
	}
};

/** Builds the auto-generated note for a loan/repayment's linked Transaction (research.md §1). */
function movementNote(direction: LoanDirection, personName: string, isRepayment: boolean): string {
	if (!isRepayment) {
		return direction === 'lent' ? `Lent to ${personName}` : `Borrowed from ${personName}`;
	}
	return direction === 'lent' ? `Repayment from ${personName}` : `Repayment to ${personName}`;
}

export const PersonLoanRepository = {
	async create(
		key: CryptoKey,
		input: {
			personId: string;
			direction: LoanDirection;
			principalAmount: number;
			date: string;
			dueDate: string | null;
			notes: string | null;
			accountId: string;
		}
	): Promise<PersonLoan> {
		if (input.principalAmount <= 0) {
			throw new Error('Loan amount must be greater than zero.');
		}
		const person = await PersonRepository.getById(key, input.personId);
		if (!person) throw new Error(`Person ${input.personId} not found`);

		// A 'lent' loan moves money OUT of the account (negative); a 'borrowed' loan moves
		// money IN (positive). Single-sided type: 'transfer', transferPairId: null — reused
		// deliberately rather than a new TransactionType (research.md §1).
		const signedAmount =
			input.direction === 'lent'
				? -Math.abs(input.principalAmount)
				: Math.abs(input.principalAmount);
		const tx = await TransactionEngine.recordTransaction(key, {
			accountId: input.accountId,
			date: input.date,
			amount: signedAmount,
			type: 'transfer',
			transferPairId: null,
			notes: movementNote(input.direction, person.name, false),
			source: 'manual',
			reviewStatus: 'confirmed'
		});

		const now = Date.now();
		const loan: PersonLoan = {
			id: crypto.randomUUID(),
			personId: input.personId,
			direction: input.direction,
			principalAmount: input.principalAmount,
			date: input.date,
			dueDate: input.dueDate,
			notes: input.notes,
			accountId: input.accountId,
			transactionId: tx.id,
			writeOffAmount: 0,
			writeOffAt: null,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
		await putEncrypted(db.personLoans, key, loan, {
			personId: loan.personId,
			accountId: loan.accountId,
			direction: loan.direction,
			deletedAt: NOT_DELETED
		});
		return loan;
	},

	/** Only notes/dueDate are editable post-creation — direction/principalAmount/accountId/date
	 *  are immutable (data-model.md): changing them would silently invalidate the linked
	 *  Transaction's already-posted amount/sign. */
	async update(
		key: CryptoKey,
		id: string,
		changes: Partial<Pick<PersonLoan, 'notes' | 'dueDate'>>
	): Promise<PersonLoan> {
		const existing = await getDecrypted<PersonLoanRow, PersonLoan>(db.personLoans, key, id);
		if (!existing) throw new Error(`PersonLoan ${id} not found`);
		const updated: PersonLoan = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.personLoans, key, updated, {
			personId: updated.personId,
			accountId: updated.accountId,
			direction: updated.direction,
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
		return updated;
	},

	async writeOff(key: CryptoKey, id: string): Promise<PersonLoan> {
		const loan = await getDecrypted<PersonLoanRow, PersonLoan>(db.personLoans, key, id);
		if (!loan) throw new Error(`PersonLoan ${id} not found`);
		const repayments = await LoanRepaymentRepository.listForLoan(key, id);
		const pendingBalance = computePendingBalance({
			principalAmount: loan.principalAmount,
			writeOffAmount: loan.writeOffAmount,
			repayments
		});
		const validation = validateWriteOffAmount({ pendingBalance });
		if (!validation.ok) throw new Error(validation.message);

		const updated: PersonLoan = {
			...loan,
			writeOffAmount: loan.writeOffAmount + pendingBalance,
			writeOffAt: Date.now(),
			updatedAt: Date.now()
		};
		await putEncrypted(db.personLoans, key, updated, {
			personId: updated.personId,
			accountId: updated.accountId,
			direction: updated.direction,
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
		return updated;
	},

	async softDelete(key: CryptoKey, id: string): Promise<void> {
		const existing = await getDecrypted<PersonLoanRow, PersonLoan>(db.personLoans, key, id);
		if (!existing) return;
		const updated: PersonLoan = { ...existing, deletedAt: Date.now(), updatedAt: Date.now() };
		await putEncrypted(db.personLoans, key, updated, {
			personId: updated.personId,
			accountId: updated.accountId,
			direction: updated.direction,
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
	},

	async restore(key: CryptoKey, id: string): Promise<void> {
		const existing = await getDecrypted<PersonLoanRow, PersonLoan>(db.personLoans, key, id);
		if (!existing) return;
		const updated: PersonLoan = { ...existing, deletedAt: null, updatedAt: Date.now() };
		await putEncrypted(db.personLoans, key, updated, {
			personId: updated.personId,
			accountId: updated.accountId,
			direction: updated.direction,
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
	},

	async getById(key: CryptoKey, id: string): Promise<PersonLoan | undefined> {
		return getDecrypted<PersonLoanRow, PersonLoan>(db.personLoans, key, id);
	},

	async listForPerson(key: CryptoKey, personId: string): Promise<PersonLoan[]> {
		const rows = await db.personLoans
			.where('personId')
			.equals(personId)
			.filter((row) => row.deletedAt === NOT_DELETED)
			.toArray();
		return decryptRows<PersonLoanRow, PersonLoan>(key, rows);
	},

	/** Every non-deleted loan across all people — for the Dashboard tile, the People list,
	 *  net worth (FR-014), and overdue notifications (FR-013). */
	async listAllOpen(key: CryptoKey): Promise<PersonLoan[]> {
		const rows = await db.personLoans.filter((row) => row.deletedAt === NOT_DELETED).toArray();
		return decryptRows<PersonLoanRow, PersonLoan>(key, rows);
	}
};

export const LoanRepaymentRepository = {
	async create(
		key: CryptoKey,
		input: { loanId: string; amount: number; date: string; accountId: string }
	): Promise<LoanRepayment> {
		const loan = await PersonLoanRepository.getById(key, input.loanId);
		if (!loan) throw new Error(`PersonLoan ${input.loanId} not found`);
		const person = await PersonRepository.getById(key, loan.personId);
		if (!person) throw new Error(`Person ${loan.personId} not found`);

		const existingRepayments = await this.listForLoan(key, input.loanId);
		const pendingBalance = computePendingBalance({
			principalAmount: loan.principalAmount,
			writeOffAmount: loan.writeOffAmount,
			repayments: existingRepayments
		});
		const validation = validateRepaymentAmount({ amount: input.amount, pendingBalance });
		if (!validation.ok) throw new Error(validation.message);

		// Opposite sign from the loan's own movement: a repayment on a 'lent' loan brings
		// money back IN (positive); a repayment on a 'borrowed' loan pays money back OUT
		// (negative).
		const signedAmount =
			loan.direction === 'lent' ? Math.abs(input.amount) : -Math.abs(input.amount);
		const tx = await TransactionEngine.recordTransaction(key, {
			accountId: input.accountId,
			date: input.date,
			amount: signedAmount,
			type: 'transfer',
			transferPairId: null,
			notes: movementNote(loan.direction, person.name, true),
			source: 'manual',
			reviewStatus: 'confirmed'
		});

		const now = Date.now();
		const repayment: LoanRepayment = {
			id: crypto.randomUUID(),
			loanId: input.loanId,
			amount: input.amount,
			date: input.date,
			accountId: input.accountId,
			transactionId: tx.id,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
		await putEncrypted(db.personLoanRepayments, key, repayment, {
			loanId: repayment.loanId,
			accountId: repayment.accountId,
			deletedAt: NOT_DELETED
		});
		return repayment;
	},

	/** Reverses the linked Transaction (restoring the account balance and the loan's pending
	 *  balance) so a mis-logged repayment can be undone (data-model.md). */
	async softDelete(key: CryptoKey, id: string): Promise<void> {
		const existing = await getDecrypted<PersonLoanRepaymentRow, LoanRepayment>(
			db.personLoanRepayments,
			key,
			id
		);
		if (!existing) return;
		await TransactionEngine.deleteTransaction(key, existing.transactionId);
		const updated: LoanRepayment = { ...existing, deletedAt: Date.now(), updatedAt: Date.now() };
		await putEncrypted(db.personLoanRepayments, key, updated, {
			loanId: updated.loanId,
			accountId: updated.accountId,
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
	},

	async restore(key: CryptoKey, id: string): Promise<void> {
		const existing = await getDecrypted<PersonLoanRepaymentRow, LoanRepayment>(
			db.personLoanRepayments,
			key,
			id
		);
		if (!existing) return;
		await TransactionEngine.restoreTransaction(key, existing.transactionId);
		const updated: LoanRepayment = { ...existing, deletedAt: null, updatedAt: Date.now() };
		await putEncrypted(db.personLoanRepayments, key, updated, {
			loanId: updated.loanId,
			accountId: updated.accountId,
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
	},

	async listForLoan(key: CryptoKey, loanId: string): Promise<LoanRepayment[]> {
		const rows = await db.personLoanRepayments
			.where('loanId')
			.equals(loanId)
			.filter((row) => row.deletedAt === NOT_DELETED)
			.toArray();
		return decryptRows<PersonLoanRepaymentRow, LoanRepayment>(key, rows);
	}
};
