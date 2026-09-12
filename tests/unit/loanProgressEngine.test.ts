import { describe, it, expect } from 'vitest';
import {
	computePendingBalance,
	deriveLoanStatus,
	isLoanOverdue,
	computeNetPositionForPerson,
	computeOpenLoanTotals,
	validateRepaymentAmount,
	validateWriteOffAmount,
	findOverduePersonLoans
} from '../../src/domain/personLoans/loanProgress';

const asOfDate = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15

describe('computePendingBalance', () => {
	it('returns the full principal when there are no repayments or write-off', () => {
		expect(
			computePendingBalance({ principalAmount: 1000, writeOffAmount: 0, repayments: [] })
		).toBe(1000);
	});

	it('subtracts partial repayments', () => {
		expect(
			computePendingBalance({
				principalAmount: 1000,
				writeOffAmount: 0,
				repayments: [{ amount: 400 }]
			})
		).toBe(600);
	});

	it('reaches zero once repayments sum to the principal', () => {
		expect(
			computePendingBalance({
				principalAmount: 1000,
				writeOffAmount: 0,
				repayments: [{ amount: 400 }, { amount: 600 }]
			})
		).toBe(0);
	});

	it('subtracts a write-off amount', () => {
		expect(
			computePendingBalance({ principalAmount: 1000, writeOffAmount: 1000, repayments: [] })
		).toBe(0);
	});
});

describe('deriveLoanStatus', () => {
	it('is open while pending balance is positive', () => {
		expect(deriveLoanStatus({ pendingBalance: 100, writeOffAt: null })).toBe('open');
	});

	it('is settled-by-repayment when balance is zero and no write-off happened', () => {
		expect(deriveLoanStatus({ pendingBalance: 0, writeOffAt: null })).toBe('settled-by-repayment');
	});

	it('is settled-by-writeoff when balance is zero and a write-off happened', () => {
		expect(deriveLoanStatus({ pendingBalance: 0, writeOffAt: 1700000000000 })).toBe(
			'settled-by-writeoff'
		);
	});
});

describe('isLoanOverdue', () => {
	it('is true when the due date has passed and balance remains', () => {
		expect(isLoanOverdue({ dueDate: '2026-06-01', pendingBalance: 500 }, asOfDate)).toBe(true);
	});

	it('is false when the due date is in the future', () => {
		expect(isLoanOverdue({ dueDate: '2026-07-01', pendingBalance: 500 }, asOfDate)).toBe(false);
	});

	it('is false when there is no due date', () => {
		expect(isLoanOverdue({ dueDate: null, pendingBalance: 500 }, asOfDate)).toBe(false);
	});

	it('is false once the balance is settled, even past the due date', () => {
		expect(isLoanOverdue({ dueDate: '2026-06-01', pendingBalance: 0 }, asOfDate)).toBe(false);
	});
});

describe('computeNetPositionForPerson', () => {
	it("nets lent minus borrowed across a person's loans", () => {
		const net = computeNetPositionForPerson({
			loans: [
				{ direction: 'lent', pendingBalance: 1000 },
				{ direction: 'borrowed', pendingBalance: 400 }
			]
		});
		expect(net).toBe(600);
	});

	it('settled loans (pendingBalance 0) contribute nothing', () => {
		const net = computeNetPositionForPerson({
			loans: [
				{ direction: 'lent', pendingBalance: 0 },
				{ direction: 'borrowed', pendingBalance: 200 }
			]
		});
		expect(net).toBe(-200);
	});
});

describe('computeOpenLoanTotals', () => {
	it('sums open lent and borrowed balances across people separately', () => {
		const totals = computeOpenLoanTotals({
			loans: [
				{ direction: 'lent', pendingBalance: 300 },
				{ direction: 'lent', pendingBalance: 200 },
				{ direction: 'borrowed', pendingBalance: 500 }
			]
		});
		expect(totals).toEqual({ totalLent: 500, totalBorrowed: 500 });
	});
});

describe('validateRepaymentAmount', () => {
	it('rejects zero and negative amounts', () => {
		expect(validateRepaymentAmount({ amount: 0, pendingBalance: 500 }).ok).toBe(false);
		expect(validateRepaymentAmount({ amount: -50, pendingBalance: 500 }).ok).toBe(false);
	});

	it('rejects an amount against an already-settled loan', () => {
		const result = validateRepaymentAmount({ amount: 100, pendingBalance: 0 });
		expect(result).toEqual({ ok: false, message: 'This loan is already settled.' });
	});

	it('rejects an amount exceeding the remaining balance', () => {
		const result = validateRepaymentAmount({ amount: 700, pendingBalance: 600 });
		expect(result.ok).toBe(false);
	});

	it('accepts a valid partial or exact amount', () => {
		expect(validateRepaymentAmount({ amount: 400, pendingBalance: 600 })).toEqual({ ok: true });
		expect(validateRepaymentAmount({ amount: 600, pendingBalance: 600 })).toEqual({ ok: true });
	});
});

describe('validateWriteOffAmount', () => {
	it('rejects an already-settled loan', () => {
		expect(validateWriteOffAmount({ pendingBalance: 0 }).ok).toBe(false);
	});

	it('accepts an open loan', () => {
		expect(validateWriteOffAmount({ pendingBalance: 500 })).toEqual({ ok: true });
	});
});

describe('findOverduePersonLoans', () => {
	it('surfaces a candidate for an overdue lent loan', () => {
		const candidates = findOverduePersonLoans(
			[
				{
					id: 'loan-1',
					personName: 'Meera',
					direction: 'lent',
					dueDate: '2026-06-01',
					pendingBalance: 300
				}
			],
			asOfDate
		);
		expect(candidates).toEqual([
			{
				kind: 'personLoan',
				key: 'personLoan:loan-1:overdue',
				title: 'Overdue: Meera owes you',
				body: 'Due 2026-06-01'
			}
		]);
	});

	it('surfaces a candidate for an overdue borrowed loan with the opposite phrasing', () => {
		const candidates = findOverduePersonLoans(
			[
				{
					id: 'loan-2',
					personName: 'Rohit',
					direction: 'borrowed',
					dueDate: '2026-06-01',
					pendingBalance: 500
				}
			],
			asOfDate
		);
		expect(candidates[0].title).toBe('Overdue: you owe Rohit');
	});

	it('does not surface a candidate for a loan not yet due, or with no due date', () => {
		const candidates = findOverduePersonLoans(
			[
				{
					id: 'loan-3',
					personName: 'Asha',
					direction: 'lent',
					dueDate: '2026-07-01',
					pendingBalance: 300
				},
				{
					id: 'loan-4',
					personName: 'Divya',
					direction: 'lent',
					dueDate: null,
					pendingBalance: 300
				}
			],
			asOfDate
		);
		expect(candidates).toEqual([]);
	});
});
