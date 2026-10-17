import { db, type AccountRow } from '../dexie/db';
import { decryptRows } from '../dexie/encryptedTable';
import { TransactionRepository, UNCATEGORIZED_CATEGORY_ID } from '../dexie/transactionRepository';
import { RecurringRepository, ExpectedEventRepository } from '../dexie/recurringRepository';
import { BudgetRepository } from '../dexie/budgetRepository';
import { InvestmentHoldingRepository, LiabilityRepository } from '../dexie/wealthRepository';
import {
	LoanRepaymentRepository,
	PersonLoanRepository,
	PersonRepository
} from '../dexie/personLoanRepository';
import { GoalContributionRepository, SavingsGoalRepository } from '../dexie/savingsGoalRepository';
import { UserProfileRepository } from '../dexie/userProfileRepository';
import { TransactionEngine } from '../../domain/transactions/transactionEngine';
import { isValidIsoDate } from '../../domain/shared/dateMath';
import type { Account } from '../../domain/entities';

export type IntegrityIssue =
	| {
			kind: 'balance-mismatch';
			accountId: string;
			accountName: string;
			stored: number;
			expected: number;
	  }
	| { kind: 'split-mismatch'; transactionId: string; amount: number; splitTotal: number }
	| {
			kind: 'broken-transfer';
			transactionId: string;
			reason: 'missing-other-leg' | 'legs-not-paired' | 'amounts-differ';
	  }
	| { kind: 'invalid-date'; transactionId: string; date: string }
	| { kind: 'unknown-account'; transactionId: string; accountId: string }
	| { kind: 'unknown-category'; transactionId: string; categoryId: string }
	/** A record elsewhere (a recurring payment, a budget, a loan…) names something that is gone. */
	| { kind: 'dangling-reference'; owner: string; missing: string };

export interface IntegrityReport {
	checkedTransactions: number;
	issues: IntegrityIssue[];
}

/**
 * Read-only audit of the ledger against the rules everything else relies on: an account's balance
 * is its opening balance plus its entries, an entry's categories add up to its amount, both
 * halves of a transfer exist and cancel out, and every entry points at things that exist. Nothing is
 * written. Balances are derived data and `repairBalances` can rebuild them; everything else is
 * reported for the user to look at, because guessing which side of a broken record is right would
 * risk making it worse.
 */
export async function checkIntegrity(key: CryptoKey): Promise<IntegrityReport> {
	const [transactions, splitsByTx, accountRows, categoryIds] = await Promise.all([
		TransactionRepository.search(key),
		TransactionRepository.splitsByTransaction(key),
		db.accounts.toArray(),
		db.categories.toCollection().primaryKeys()
	]);
	const accounts = await decryptRows<AccountRow, Account>(key, accountRows);
	const accountIds = new Set(accounts.map((account) => account.id));
	const knownCategoryIds = new Set<string>([UNCATEGORIZED_CATEGORY_ID, ...categoryIds.map(String)]);
	const byId = new Map(transactions.map((tx) => [tx.id, tx]));
	const issues: IntegrityIssue[] = [];

	for (const account of accounts) {
		const expected =
			account.openingBalance +
			transactions
				.filter((tx) => tx.accountId === account.id)
				.reduce((sum, tx) => sum + tx.amount, 0);
		if (account.currentBalance !== expected) {
			issues.push({
				kind: 'balance-mismatch',
				accountId: account.id,
				accountName: account.name,
				stored: account.currentBalance,
				expected
			});
		}
	}

	for (const tx of transactions) {
		if (!isValidIsoDate(tx.date)) {
			issues.push({ kind: 'invalid-date', transactionId: tx.id, date: tx.date });
		}
		if (!accountIds.has(tx.accountId)) {
			issues.push({ kind: 'unknown-account', transactionId: tx.id, accountId: tx.accountId });
		}

		const splits = splitsByTx.get(tx.id) ?? [];
		const splitTotal = splits.reduce((sum, split) => sum + split.amount, 0);
		if (splitTotal !== tx.amount) {
			issues.push({ kind: 'split-mismatch', transactionId: tx.id, amount: tx.amount, splitTotal });
		}
		for (const split of splits) {
			if (!knownCategoryIds.has(split.categoryId)) {
				issues.push({
					kind: 'unknown-category',
					transactionId: tx.id,
					categoryId: split.categoryId
				});
			}
		}

		// A person-loan movement is a single-sided 'transfer' with no pair, which is legitimate.
		if (tx.type === 'transfer' && tx.transferPairId) {
			const other = byId.get(tx.transferPairId);
			if (!other) {
				issues.push({ kind: 'broken-transfer', transactionId: tx.id, reason: 'missing-other-leg' });
			} else if (other.transferPairId !== tx.id) {
				issues.push({ kind: 'broken-transfer', transactionId: tx.id, reason: 'legs-not-paired' });
			} else if (other.amount !== -tx.amount) {
				issues.push({ kind: 'broken-transfer', transactionId: tx.id, reason: 'amounts-differ' });
			}
		}
	}

	issues.push(
		...(await findDanglingReferences(key, {
			transactionIds: new Set(transactions.map((tx) => tx.id)),
			purposeTargets: transactions.flatMap((tx) =>
				tx.purpose?.targetId ? [{ kind: tx.purpose.kind, targetId: tx.purpose.targetId }] : []
			),
			accounts,
			knownCategoryIds
		}))
	);

	return { checkedTransactions: transactions.length, issues };
}

/**
 * Records outside the ledger that point at an account, category, entry or goal that no longer
 * exists. Deleting things used to leave these behind (a recurring payment on a deleted account, a
 * loan whose entry was removed, a goal contribution for a deleted goal), and nothing showed it until
 * a page printed a raw id or a total quietly stopped adding up. Reported, never changed: which side
 * is the mistake is the user's call.
 */
async function findDanglingReferences(
	key: CryptoKey,
	known: {
		transactionIds: Set<string>;
		purposeTargets: { kind: string; targetId: string }[];
		accounts: Account[];
		knownCategoryIds: Set<string>;
	}
): Promise<IntegrityIssue[]> {
	const [
		rules,
		events,
		budgets,
		liabilities,
		holdings,
		loans,
		repayments,
		people,
		goals,
		contributions,
		profile
	] = await Promise.all([
		RecurringRepository.list(key),
		ExpectedEventRepository.listAll(key),
		BudgetRepository.list(key),
		LiabilityRepository.list(key),
		InvestmentHoldingRepository.list(key),
		PersonLoanRepository.listAllOpen(key),
		LoanRepaymentRepository.listAll(key),
		PersonRepository.list(key),
		SavingsGoalRepository.list(key),
		GoalContributionRepository.list(key),
		UserProfileRepository.get()
	]);
	const accountIds = new Set(known.accounts.map((account) => account.id));
	const ruleIds = new Set(rules.map((rule) => rule.id));
	const goalIds = new Set(goals.map((goal) => goal.id));
	const loanIds = new Set(loans.map((loan) => loan.id));
	const personName = new Map(people.map((person) => [person.id, person.name]));
	const issues: IntegrityIssue[] = [];
	const dangling = (owner: string, missing: string) =>
		issues.push({ kind: 'dangling-reference', owner, missing });
	const noAccount = (id: string | null | undefined) => !!id && !accountIds.has(id);
	const noCategory = (id: string) => !known.knownCategoryIds.has(id);
	const noTransaction = (id: string | null | undefined) => !!id && !known.transactionIds.has(id);

	for (const rule of rules) {
		const owner = `The recurring payment "${rule.label?.trim() || 'unnamed'}"`;
		if (noAccount(rule.accountId)) dangling(owner, 'the account it is paid from');
		if (noCategory(rule.categoryId)) dangling(owner, 'its category');
	}
	for (const budget of budgets) {
		if (noCategory(budget.categoryId)) dangling('A budget', 'its category');
	}
	for (const event of events) {
		if (!ruleIds.has(event.recurringRuleId)) {
			dangling('A recurring-payment reminder', 'the recurring payment it belongs to');
		}
		if (noTransaction(event.matchedTransactionId)) {
			dangling('A recurring-payment reminder marked as paid', 'the entry that paid it');
		}
	}
	for (const liability of liabilities) {
		const owner = `The debt "${liability.name}"`;
		if (noAccount(liability.linkedAccountId)) dangling(owner, 'the card account it is linked to');
		for (const payment of liability.payments ?? []) {
			if (noTransaction(payment.transactionId)) dangling(owner, 'the entry of one of its payments');
			if (noAccount(payment.accountId))
				dangling(owner, 'the account one of its payments came from');
		}
	}
	for (const holding of holdings) {
		for (const trade of holding.trades ?? []) {
			if (noTransaction(trade.transactionId)) {
				dangling(`The investment "${holding.name}"`, 'the entry of one of its purchases or sales');
			}
		}
	}
	for (const loan of loans) {
		const owner = `The loan with ${personName.get(loan.personId) ?? 'someone'}`;
		if (noAccount(loan.accountId)) dangling(owner, 'its account');
		if (noTransaction(loan.transactionId)) dangling(owner, 'the entry that moved the money');
	}
	for (const repayment of repayments) {
		const owner = 'A loan repayment';
		if (!loanIds.has(repayment.loanId)) dangling(owner, 'the loan it repays');
		if (noAccount(repayment.accountId)) dangling(owner, 'its account');
		if (noTransaction(repayment.transactionId)) dangling(owner, 'the entry that moved the money');
	}
	for (const contribution of contributions) {
		if (!goalIds.has(contribution.goalId)) dangling('A savings contribution', 'its goal');
		if (noTransaction(contribution.transactionId)) {
			dangling('A savings contribution', 'the entry it was made from');
		}
	}
	const capture = profile?.capture;
	if (capture?.enabled && capture.defaultAccountId) {
		const usable = known.accounts.some(
			(account) => account.id === capture.defaultAccountId && !account.isArchived
		);
		if (!usable) {
			dangling(
				'Auto-capture',
				'its default account (deleted or archived), so messages that name no account cannot be filed'
			);
		}
	}
	const targetExists: Record<string, Set<string>> = {
		debt: new Set(liabilities.map((l) => l.id)),
		savings: goalIds,
		investment: new Set(holdings.map((h) => h.id)),
		bills: ruleIds
	};
	let strayTags = 0;
	for (const { kind, targetId } of known.purposeTargets) {
		if (targetExists[kind] && !targetExists[kind].has(targetId)) strayTags += 1;
	}
	if (strayTags > 0) {
		dangling(
			`${strayTags} entr${strayTags === 1 ? 'y' : 'ies'} marked as debt, savings, investment or a bill`,
			'the debt, goal, investment or bill they name'
		);
	}
	return issues;
}

/**
 * Rebuilds every account's balance from its ledger. Safe to run at any time: the balance is
 * derived from entries that are left untouched. Returns how many accounts had a wrong balance.
 */
export async function repairBalances(key: CryptoKey): Promise<number> {
	const { issues } = await checkIntegrity(key);
	const wrong = issues.filter((issue) => issue.kind === 'balance-mismatch');
	for (const issue of wrong) {
		await TransactionEngine.recalculateAccountBalance(key, issue.accountId);
	}
	return wrong.length;
}

/** One line a person can read, with enough to find the entry in the ledger. */
export function describeIntegrityIssue(issue: IntegrityIssue): string {
	switch (issue.kind) {
		case 'balance-mismatch':
			return `${issue.accountName}: the stored balance doesn't match its entries.`;
		case 'split-mismatch':
			return `An entry's categories don't add up to its amount (entry ${shortId(issue.transactionId)}).`;
		case 'broken-transfer':
			return `A transfer is inconsistent — ${TRANSFER_REASONS[issue.reason]} (entry ${shortId(issue.transactionId)}).`;
		case 'invalid-date':
			return `An entry has an invalid date "${issue.date}" (entry ${shortId(issue.transactionId)}).`;
		case 'unknown-account':
			return `An entry belongs to an account that no longer exists (entry ${shortId(issue.transactionId)}).`;
		case 'unknown-category':
			return `An entry uses a category that no longer exists (entry ${shortId(issue.transactionId)}).`;
		case 'dangling-reference':
			return `${issue.owner} refers to ${issue.missing}, which no longer exists.`;
	}
}

const TRANSFER_REASONS: Record<
	Extract<IntegrityIssue, { kind: 'broken-transfer' }>['reason'],
	string
> = {
	'missing-other-leg': 'the other half is missing',
	'legs-not-paired': 'its two halves point at different partners',
	'amounts-differ': 'its two halves have different amounts'
};

function shortId(id: string): string {
	return id.slice(0, 8);
}
