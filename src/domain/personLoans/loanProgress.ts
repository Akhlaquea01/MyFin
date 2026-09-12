import type { NotificationCandidate } from '../notifications/types';
import type {
	ComputeNetPositionInput,
	ComputeOpenLoanTotalsInput,
	ComputePendingBalanceInput,
	DeriveLoanStatusInput,
	IsLoanOverdueInput,
	LoanStatus,
	OpenLoanTotals,
	OverdueLoanInput,
	ValidateRepaymentAmountInput,
	ValidateWriteOffAmountInput,
	ValidationResult
} from './types';

/** Pure — per contracts/loan-progress-engine.md. Never clamps; every write path that could
 *  drive this negative rejects the write before it happens (see validate* below). */
export function computePendingBalance(input: ComputePendingBalanceInput): number {
	const repaid = input.repayments.reduce((sum, r) => sum + r.amount, 0);
	return input.principalAmount - repaid - input.writeOffAmount;
}

/** Pure — per contracts/loan-progress-engine.md. */
export function deriveLoanStatus(input: DeriveLoanStatusInput): LoanStatus {
	if (input.pendingBalance > 0) return 'open';
	return input.writeOffAt !== null ? 'settled-by-writeoff' : 'settled-by-repayment';
}

/** Pure — per contracts/loan-progress-engine.md. `asOfDate` is a parameter for testability,
 *  matching the existing convention in notificationEngine.ts. */
export function isLoanOverdue(input: IsLoanOverdueInput, asOfDate: Date): boolean {
	if (input.dueDate === null || input.pendingBalance <= 0) return false;
	const asOfIso = asOfDate.toISOString().slice(0, 10);
	return input.dueDate < asOfIso;
}

/** Pure — per contracts/loan-progress-engine.md. Settled loans contribute 0 naturally since
 *  their pendingBalance is already 0 — no separate filtering needed. */
export function computeNetPositionForPerson(input: ComputeNetPositionInput): number {
	return input.loans.reduce((sum, loan) => {
		return sum + (loan.direction === 'lent' ? loan.pendingBalance : -loan.pendingBalance);
	}, 0);
}

/** Pure — per contracts/loan-progress-engine.md. Feeds the Dashboard tile (FR-010) and
 *  wealthEngine.computeNetWorth (FR-014, research.md §5). */
export function computeOpenLoanTotals(input: ComputeOpenLoanTotalsInput): OpenLoanTotals {
	let totalLent = 0;
	let totalBorrowed = 0;
	for (const loan of input.loans) {
		if (loan.direction === 'lent') totalLent += loan.pendingBalance;
		else totalBorrowed += loan.pendingBalance;
	}
	return { totalLent, totalBorrowed };
}

/** Pure — per contracts/loan-progress-engine.md. Called by LoanRepaymentRepository.create
 *  before any transaction/repayment row is written (research.md §6). */
export function validateRepaymentAmount(input: ValidateRepaymentAmountInput): ValidationResult {
	if (input.amount <= 0) {
		return { ok: false, message: 'Repayment amount must be greater than zero.' };
	}
	if (input.pendingBalance === 0) {
		return { ok: false, message: 'This loan is already settled.' };
	}
	if (input.amount > input.pendingBalance) {
		return {
			ok: false,
			message: `Repayment cannot exceed the remaining balance of ${input.pendingBalance}.`
		};
	}
	return { ok: true };
}

/** Pure — per contracts/loan-progress-engine.md. A write-off always targets the full
 *  remaining balance — there is no partial write-off in this feature's scope. */
export function validateWriteOffAmount(input: ValidateWriteOffAmountInput): ValidationResult {
	if (input.pendingBalance === 0) {
		return { ok: false, message: 'This loan is already settled.' };
	}
	return { ok: true };
}

/** Pure — per contracts/loan-progress-engine.md. Plugs into runNotificationCheck exactly like
 *  findDueRecurringEvents/findCrossedBudgetThresholds (research.md §4): one candidate per
 *  overdue loan, deduped via the existing NotifiedItemRepository by `key`. */
export function findOverduePersonLoans(
	loans: OverdueLoanInput[],
	asOfDate: Date
): NotificationCandidate[] {
	return loans
		.filter((loan) =>
			isLoanOverdue({ dueDate: loan.dueDate, pendingBalance: loan.pendingBalance }, asOfDate)
		)
		.map((loan) => ({
			kind: 'personLoan' as const,
			key: `personLoan:${loan.id}:overdue`,
			title:
				loan.direction === 'lent'
					? `Overdue: ${loan.personName} owes you`
					: `Overdue: you owe ${loan.personName}`,
			body: `Due ${loan.dueDate}`
		}));
}
