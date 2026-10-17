// What marking a transaction as debt, savings, investment or bills actually does to the thing it was
// for. The tag itself is a field on the transaction; this module keeps the target in step with it:
//
//   debt        the liability's balance owed falls by the amount, and a payment record is added to it
//   savings     the amount is added to the goal as a contribution
//   bills       the recurring bill's expected payment is marked as paid by this entry
//   investment  tag only — a bare amount cannot become a trade (that needs units and a price)
//
// Each effect is found again through the target's own link back to the transaction
// (`LiabilityPayment.transactionId`, `GoalContribution.transactionId`,
// `ExpectedEvent.matchedTransactionId`), never remembered separately, so applying is idempotent and
// reversing needs nothing but the transaction. Applying always starts by clearing, which is what lets
// an edited amount or date simply re-apply.
//
// This file must not import TransactionEngine: the engine calls into here.
import { AccountRepository } from '../../data/dexie/accountRepository';
import {
	GoalContributionRepository,
	SavingsGoalRepository
} from '../../data/dexie/savingsGoalRepository';
import {
	InvestmentHoldingRepository,
	LiabilityRepository
} from '../../data/dexie/wealthRepository';
import { RecurringRepository } from '../../data/dexie/recurringRepository';
import { TransactionRepository } from '../../data/dexie/transactionRepository';
import { linkTransactionToRule, releaseMatches } from '../recurring/recurringEngine';
import { todayLocalISO } from '../shared/dateMath';
import { formatMoney } from '../shared/money';
import type { LiabilityPayment, PurposeKind, Transaction, TransactionPurpose } from '../entities';

export const PURPOSE_KINDS: PurposeKind[] = ['debt', 'savings', 'investment', 'bills'];

export const PURPOSE_LABELS: Record<PurposeKind, string> = {
	debt: 'Debt payment',
	savings: 'Savings',
	investment: 'Investment',
	bills: 'Bills'
};

/** What to call the thing a purpose points at, in a sentence. */
export const TARGET_NOUN: Record<PurposeKind, string> = {
	debt: 'debt',
	savings: 'savings goal',
	investment: 'investment',
	bills: 'recurring bill'
};

/** A purpose with the piece it needs: debt and savings cannot be applied without choosing which. */
export function purposeIncomplete(purpose: TransactionPurpose | null): string | null {
	if (!purpose) return null;
	if (purposeNeedsTarget(purpose.kind) && !purpose.targetId) {
		return `Choose which ${TARGET_NOUN[purpose.kind]} this went to.`;
	}
	return null;
}

/** One-word versions for badges in lists. */
export const PURPOSE_SHORT_LABELS: Record<PurposeKind, string> = {
	debt: 'Debt',
	savings: 'Savings',
	investment: 'Investment',
	bills: 'Bills'
};

/** The least of a transaction the purpose rules need to look at. */
type PurposeSubject = Pick<Transaction, 'accountId' | 'amount' | 'type' | 'date'> & { id?: string };

export function samePurpose(
	a: TransactionPurpose | null | undefined,
	b: TransactionPurpose | null | undefined
): boolean {
	return (a?.kind ?? null) === (b?.kind ?? null) && (a?.targetId ?? null) === (b?.targetId ?? null);
}

/** Whether a purpose with this kind needs a target to do anything. Investment never changes one. */
export function purposeNeedsTarget(kind: PurposeKind): boolean {
	return kind === 'debt' || kind === 'savings';
}

/**
 * Why `purpose` cannot be applied to this entry, in plain words, or null when it can. Checked BEFORE
 * anything is saved, so a refusal leaves everything as it was. `subject.id`, when the entry already
 * exists, lets a payment it already made count as available again (editing re-applies it).
 */
export async function validatePurpose(
	key: CryptoKey,
	subject: PurposeSubject,
	purpose: TransactionPurpose
): Promise<string | null> {
	if (subject.type !== 'expense') {
		return `Only spending can be marked as ${PURPOSE_LABELS[purpose.kind].toLowerCase()}.`;
	}
	if (purpose.kind === 'debt' && purpose.targetId) {
		const liability = await LiabilityRepository.getById(key, purpose.targetId);
		if (!liability) return 'That debt no longer exists.';
		if (liability.linkedAccountId) {
			return 'This card is tracked as an account, so pay it with "Pay bill" on the Accounts page.';
		}
		const account = await AccountRepository.getById(key, subject.accountId);
		if (account?.type === 'credit_card') {
			return 'Pay a debt from a bank, cash or wallet account, not from a credit card.';
		}
		const own = subject.id
			? liability.payments?.find((p) => p.transactionId === subject.id)
			: undefined;
		const available = liability.outstandingBalance + (own?.amount ?? 0);
		const amount = Math.abs(subject.amount);
		if (amount > available) {
			return `That is more than the ${formatMoney(available)} still owed on ${liability.name}.`;
		}
	}
	if (purpose.kind === 'savings' && purpose.targetId) {
		if (!(await SavingsGoalRepository.list(key)).some((g) => g.id === purpose.targetId)) {
			return 'That savings goal no longer exists.';
		}
		if (subject.date > todayLocalISO()) {
			return 'A savings contribution cannot be dated in the future.';
		}
	}
	if (purpose.kind === 'bills' && purpose.targetId) {
		if (!(await RecurringRepository.list(key)).some((r) => r.id === purpose.targetId)) {
			return 'That recurring bill no longer exists.';
		}
	}
	if (purpose.kind === 'investment' && purpose.targetId) {
		if (!(await InvestmentHoldingRepository.getById(key, purpose.targetId))) {
			return 'That investment no longer exists.';
		}
	}
	return null;
}

/** Undoes whatever `purpose` did for this transaction. Safe to call when it did nothing. */
export async function clearPurpose(
	key: CryptoKey,
	tx: Pick<Transaction, 'id'> & Partial<Pick<Transaction, 'date'>>,
	purpose: TransactionPurpose | null | undefined
): Promise<void> {
	if (!purpose) return;
	if (purpose.kind === 'debt' && purpose.targetId) {
		const liability = await LiabilityRepository.getById(key, purpose.targetId);
		const payments = liability?.payments?.filter((p) => p.transactionId === tx.id) ?? [];
		if (liability && payments.length > 0) {
			const restored = payments.reduce((sum, p) => sum + p.amount, 0);
			await LiabilityRepository.update(key, liability.id, {
				outstandingBalance: liability.outstandingBalance + restored,
				payments: (liability.payments ?? []).filter((p) => p.transactionId !== tx.id)
			});
		}
	} else if (purpose.kind === 'savings') {
		for (const contribution of await GoalContributionRepository.list(key)) {
			if (contribution.transactionId === tx.id) {
				await GoalContributionRepository.remove(key, contribution.id);
			}
		}
	} else if (purpose.kind === 'bills') {
		await releaseMatches(key, tx.id, undefined, tx.date ? [tx.date] : undefined);
	}
}

/**
 * Makes the target reflect this entry's purpose, starting from a clean slate so calling it twice
 * (or after an edit) never counts the entry twice. Does nothing for an entry still waiting in
 * Review: its effect is applied when it is confirmed. Returns a short sentence saying what changed,
 * for the caller to show, or null when the tag changed nothing.
 */
export async function applyPurpose(key: CryptoKey, tx: Transaction): Promise<string | null> {
	const purpose = tx.purpose;
	if (!purpose || tx.reviewStatus !== 'confirmed') return null;
	await clearPurpose(key, tx, purpose);
	if (!purpose.targetId) return null;

	if (purpose.kind === 'debt') {
		const liability = await LiabilityRepository.getById(key, purpose.targetId);
		if (!liability) return null;
		const amount = Math.abs(tx.amount);
		const payment: LiabilityPayment = {
			id: crypto.randomUUID(),
			amount,
			date: tx.date,
			accountId: tx.accountId,
			transactionId: tx.id
		};
		const updated = await LiabilityRepository.update(key, liability.id, {
			outstandingBalance: liability.outstandingBalance - amount,
			payments: [...(liability.payments ?? []), payment]
		});
		return `${liability.name}: ${formatMoney(updated.outstandingBalance)} still owed.`;
	}

	if (purpose.kind === 'savings') {
		const goal = (await SavingsGoalRepository.list(key)).find((g) => g.id === purpose.targetId);
		if (!goal) return null;
		await GoalContributionRepository.create(key, {
			goalId: goal.id,
			amount: Math.abs(tx.amount),
			date: tx.date,
			transactionId: tx.id
		});
		return `Added ${formatMoney(Math.abs(tx.amount))} to ${goal.name}.`;
	}

	if (purpose.kind === 'bills') {
		const rules = await RecurringRepository.list(key);
		const rule = rules.find((r) => r.id === purpose.targetId);
		if (!rule) return null;
		const event = await linkTransactionToRule(key, tx, rule.id);
		return event
			? `Marked the ${event.expectedDate} bill as paid.`
			: 'No upcoming payment of that bill was close enough to this date to mark as paid.';
	}

	return null;
}

/**
 * Entries tagged for a debt, goal, holding or bill that has just been deleted keep their tag (the
 * money still went to that kind of thing) but no longer name the one that is gone. Left naming it,
 * every later edit of the entry's amount, date or account — and confirming it in Review — was refused
 * with "That savings goal no longer exists.", with nothing on screen to fix. Call this after the
 * target is removed; `deleteRecurringRule` does the same for bills. Returns how many entries changed.
 */
export async function detachPurposeTarget(
	key: CryptoKey,
	kind: PurposeKind,
	targetId: string
): Promise<number> {
	let changed = 0;
	for (const tx of await TransactionRepository.search(key)) {
		if (tx.purpose?.kind !== kind || tx.purpose.targetId !== targetId) continue;
		await TransactionRepository.update(key, tx.id, { purpose: { kind, targetId: null } });
		changed += 1;
	}
	return changed;
}

/**
 * Brings the target in step after an entry was edited: reverses the old purpose, applies the new
 * one. Only does work when the purpose, or anything an effect depends on (amount, date, account,
 * type, review state), changed.
 */
export async function syncPurpose(
	key: CryptoKey,
	before: Transaction,
	after: Transaction
): Promise<string | null> {
	const unchanged =
		samePurpose(before.purpose, after.purpose) &&
		before.amount === after.amount &&
		before.date === after.date &&
		before.accountId === after.accountId &&
		before.type === after.type &&
		before.reviewStatus === after.reviewStatus;
	if (unchanged) return null;
	if (before.purpose) await clearPurpose(key, before, before.purpose);
	if (after.purpose && after.type === 'expense') return applyPurpose(key, after);
	return null;
}
