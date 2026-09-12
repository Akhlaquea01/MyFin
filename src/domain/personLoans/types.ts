/**
 * Personal Lending & Borrowing (IOU) domain types (spec 010). A loan's pending balance and
 * status are always derived on demand from its PersonLoan + LoanRepayment[] — never
 * themselves persisted, same precedent as savingsGoals/types.ts's GoalProgress.
 */

export type LoanStatus = 'open' | 'settled-by-repayment' | 'settled-by-writeoff';

export interface ComputePendingBalanceInput {
	principalAmount: number;
	writeOffAmount: number;
	repayments: { amount: number }[];
}

export interface DeriveLoanStatusInput {
	pendingBalance: number;
	writeOffAt: number | null;
}

export interface IsLoanOverdueInput {
	dueDate: string | null;
	pendingBalance: number;
}

export interface LoanWithPendingBalance {
	direction: 'lent' | 'borrowed';
	pendingBalance: number;
}

export interface ComputeNetPositionInput {
	loans: LoanWithPendingBalance[];
}

export interface ComputeOpenLoanTotalsInput {
	loans: LoanWithPendingBalance[];
}

export interface OpenLoanTotals {
	totalLent: number;
	totalBorrowed: number;
}

export type ValidationResult = { ok: true } | { ok: false; message: string };

export interface ValidateRepaymentAmountInput {
	amount: number;
	pendingBalance: number;
}

export interface ValidateWriteOffAmountInput {
	pendingBalance: number;
}

export interface OverdueLoanInput {
	id: string;
	personName: string;
	direction: 'lent' | 'borrowed';
	dueDate: string | null;
	pendingBalance: number;
}
