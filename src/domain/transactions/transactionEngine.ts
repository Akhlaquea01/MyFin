import { AccountRepository } from '../../data/dexie/accountRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID,
	type NewTransactionInput,
	type SplitInput
} from '../../data/dexie/transactionRepository';
import { TransactionTagRepository } from '../../data/dexie/tagRepository';
import { matchTransaction, releaseMatches, rematchTransaction } from '../recurring/recurringEngine';
import {
	createCategorizationResolver,
	recordConfirmation,
	type CategorizationResolver
} from '../categorization/resolveCategorization';
import { addDaysISO, isValidIsoDate } from '../shared/dateMath';
import { linkedTransactionNotice } from './linkedTransactionNotice';
import {
	applyPurpose,
	clearPurpose,
	samePurpose,
	syncPurpose,
	validatePurpose
} from './purposeEngine';
import type { Transaction } from '../../domain/entities';

/**
 * Recomputes an account's `currentBalance` from scratch: opening balance plus the sum of
 * every transaction on it. Simple and always correct — the safest choice for
 * a personal ledger where trust in the numbers matters more than micro-optimizing away an
 * O(n) recalculation on every edit. Revisit only if profiling ever shows this is a real
 * bottleneck (no Success Criteria requires fast writes, only fast search — SC-008).
 */
export async function recalculateAccountBalance(key: CryptoKey, accountId: string): Promise<void> {
	const account = await AccountRepository.getById(key, accountId);
	if (!account) return;
	const transactions = await TransactionRepository.search(key, { accountId });
	const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
	await AccountRepository.setBalance(key, accountId, account.openingBalance + total);
}

/** Options shared by the write paths that can defer balance maintenance. */
export interface RecordOptions {
	/**
	 * Skip the per-write balance recalculation. Set by bulk callers (file/text import) that
	 * recalculate once at the end instead: the recalculation is O(account size), so running it
	 * per row made importing N rows cost ~N^2/2 decryptions. The caller becomes responsible for
	 * calling `recalculateAccountBalance` before the user sees a balance.
	 */
	deferBalance?: boolean;
	/**
	 * A categorization resolver to reuse across a bulk import. Building one loads the keyword rules,
	 * and it caches every per-merchant lookup, so an import that shares ONE resolver across its rows
	 * pays for each rule and merchant once rather than once per row. Omitted by one-off callers,
	 * which get a fresh resolver (and so always see the latest rules).
	 */
	categorizer?: CategorizationResolver;
	/**
	 * Do not feed this entry's category into the merchant's learning streak. A data-template import
	 * replays *historical* entries that arrive alongside the streaks they already produced (merged
	 * in an earlier import step), so teaching from them again would append every imported category
	 * to the streak a second time.
	 */
	skipLearning?: boolean;
	/**
	 * Extra text for keyword rules to read when the entry has no description of its own, such as a
	 * captured message whose merchant could not be parsed. Matching only; it is never stored.
	 */
	categorizationText?: string;
	/**
	 * Store `input.purpose` as a tag without touching its target. For callers that already moved
	 * the target themselves (a liability payment made from the Liabilities page) or that replay
	 * history whose target-side records are not being restored (a data-template import).
	 */
	skipPurposeEffects?: boolean;
}

/** Called with a sentence describing what marking an entry's purpose did to its target. */
export interface PurposeEffectOptions {
	onPurposeEffect?: (message: string | null) => void;
}

export const TransactionEngine = {
	recalculateAccountBalance,

	async recordTransaction(
		key: CryptoKey,
		input: NewTransactionInput,
		splits: SplitInput[] = [],
		options: RecordOptions & PurposeEffectOptions = {}
	): Promise<Transaction> {
		// A purpose that moves a balance, a goal or a bill is refused up front, before the entry exists,
		// so a refusal leaves nothing behind. An entry still waiting in Review applies it on confirm.
		const purposeTakesEffect =
			!!input.purpose &&
			!options.skipPurposeEffects &&
			(input.reviewStatus ?? 'confirmed') === 'confirmed';
		if (purposeTakesEffect && input.purpose) {
			const problem = await validatePurpose(key, input, input.purpose);
			if (problem) throw new Error(problem);
		}

		// Auto-categorization pre-fill (spec 006, FR-002): only when the caller hasn't
		// already specified a category — today that's every source but Quick Add/bulk/file
		// import, which never pass splits of their own.
		let resolvedSplits = splits;
		let categorizationTagIds: string[] = [];
		// An entry needs *something* to match on: a merchant (merchant rules, learned suggestions) or
		// a description (keyword rules). A statement row whose description normalizes to no merchant
		// is still categorizable by keyword.
		const matchText = input.notes ?? options.categorizationText ?? null;
		if (splits.length === 0 && (input.merchantId || matchText) && input.type !== 'transfer') {
			const categorizer = options.categorizer ?? (await createCategorizationResolver(key));
			const result = await categorizer.resolve({
				merchantId: input.merchantId ?? null,
				aliasId: input.merchantAliasId ?? null,
				notes: matchText
			});
			if (result) {
				resolvedSplits = [
					{
						categoryId: result.categoryId,
						amount: input.amount,
						categorizationSource: result.source
					}
				];
				categorizationTagIds = result.tagIds;
			}
		}

		const tx = await TransactionRepository.create(key, input, resolvedSplits);
		if (categorizationTagIds.length > 0) {
			await TransactionTagRepository.setTags(tx.id, categorizationTagIds);
		}
		if (!options.deferBalance) await recalculateAccountBalance(key, tx.accountId);

		// A category the user chose by hand on an already-confirmed entry is just as much a
		// confirmation as accepting one in the Review Queue. Only Review used to feed the learning
		// signal, so a merchant entered manually twenty times in the same category never became a
		// suggestion. An explicit single category only: a multi-way split says nothing about what
		// the merchant "is", and an unreviewed entry has not been confirmed yet.
		if (
			!options.skipLearning &&
			splits.length === 1 &&
			input.merchantId &&
			input.type !== 'transfer' &&
			(input.reviewStatus ?? 'confirmed') === 'confirmed' &&
			splits[0].categoryId !== UNCATEGORIZED_CATEGORY_ID
		) {
			await recordConfirmation(key, input.merchantId, splits[0].categoryId);
		}

		// Best-effort recurring-event matching (FR-030): try each split's category until
		// one matches a pending expected event. Never blocks/fails the transaction itself.
		try {
			const txSplits = await TransactionRepository.getSplits(key, tx.id);
			for (const split of txSplits) {
				const matched = await matchTransaction(key, tx, split.categoryId);
				if (matched) break;
			}
		} catch {
			// The entry is already saved. A failure in this convenience must not surface as "could not
			// save", which invites a retry and a duplicate (and, for a deferred-balance import, skips
			// the balance recalculation the caller owes).
		}

		// After the automatic matching, so a bill the user named is the one that ends up marked paid.
		if (purposeTakesEffect) {
			try {
				// Awaited on its own: `callback?.(await x)` never evaluates `x` when there is no callback.
				const effect = await applyPurpose(key, tx);
				options.onPurposeEffect?.(effect);
			} catch (err) {
				// Never leave an entry that says it paid something it did not.
				await TransactionEngine.deleteTransaction(key, tx.id).catch(() => undefined);
				throw err;
			}
		}

		return tx;
	},

	async recordTransfer(
		key: CryptoKey,
		params: {
			fromAccountId: string;
			toAccountId: string;
			amount: number;
			date: string;
			notes?: string;
		}
	): Promise<[Transaction, Transaction]> {
		if (params.fromAccountId === params.toAccountId) {
			throw new Error('A transfer must be between two different accounts.');
		}
		if (params.amount <= 0) {
			throw new Error('Transfer amount must be positive.');
		}
		const pair = await TransactionRepository.createTransferPair(key, params);
		await recalculateAccountBalance(key, params.fromAccountId);
		await recalculateAccountBalance(key, params.toAccountId);
		return pair;
	},

	/**
	 * Posts the correction that brings an account to the balance its owner says it really has
	 * (`amount` is the signed difference). A correction is neither income nor spending, so it is a
	 * one-sided movement - like a person loan's or an investment trade's: the balance moves, but it
	 * stays out of income, expenses, budgets and every report. It was posted as an ordinary income or
	 * expense, which counted it as both. It still leaves an auditable entry, so "balance = opening
	 * balance + entries" keeps holding.
	 */
	async recordBalanceAdjustment(
		key: CryptoKey,
		params: { accountId: string; amount: number; date: string }
	): Promise<Transaction> {
		if (params.amount === 0) throw new Error('There is no difference to adjust.');
		return TransactionEngine.recordTransaction(key, {
			accountId: params.accountId,
			date: params.date,
			amount: params.amount,
			type: 'transfer',
			transferPairId: null,
			source: 'balance_adjustment',
			notes: 'Balance adjustment'
		});
	},

	async editTransaction(
		key: CryptoKey,
		id: string,
		changes: Partial<Transaction>,
		splits?: SplitInput[],
		options: PurposeEffectOptions = {}
	): Promise<Transaction> {
		const before = await TransactionRepository.getById(key, id);
		if (before) {
			const candidate = { ...before, ...changes };
			// Income and transfers have no purpose; changing an entry to one drops the tag.
			if (candidate.purpose && candidate.type !== 'expense')
				changes = { ...changes, purpose: null };
			else if (
				candidate.purpose &&
				candidate.reviewStatus === 'confirmed' &&
				(!samePurpose(before.purpose, candidate.purpose) ||
					candidate.amount !== before.amount ||
					candidate.date !== before.date ||
					candidate.accountId !== before.accountId ||
					before.reviewStatus !== 'confirmed')
			) {
				const problem = await validatePurpose(key, candidate, candidate.purpose);
				if (problem) throw new Error(problem);
			}
		}
		// Choosing the account settles the "we guessed this one" flag a captured entry carries.
		const accountChosen =
			before?.capture?.accountCheck &&
			!changes.capture &&
			changes.accountId !== undefined &&
			changes.accountId !== before.accountId;
		const updated = await TransactionRepository.update(
			key,
			id,
			accountChosen && before?.capture
				? { ...changes, capture: { ...before.capture, accountCheck: null, tailHint: null } }
				: changes,
			splits
		);
		await recalculateAccountBalance(key, updated.accountId);
		if (before && before.accountId !== updated.accountId) {
			await recalculateAccountBalance(key, before.accountId);
		}
		if (before) {
			const effect = await syncPurpose(key, before, updated);
			options.onPurposeEffect?.(effect);
		}
		// A changed amount, date, account or category can make it match a different expected
		// payment — or stop matching the one it had.
		await rematchTransaction(key, updated, before?.date);
		return updated;
	},

	/**
	 * Permanently deletes a transaction. A transfer is ONE movement of money recorded as two legs,
	 * so deleting either leg deletes both, atomically: deleting only the clicked leg would leave the
	 * other account permanently debited (or credited) for a transfer that no longer existed — the
	 * two balances would then disagree with each other with nothing on screen explaining why.
	 */
	async deleteTransaction(key: CryptoKey, id: string): Promise<void> {
		const tx = await TransactionRepository.getById(key, id);
		if (!tx) throw new Error(`Transaction ${id} not found`);
		const pair = tx.transferPairId
			? await TransactionRepository.getById(key, tx.transferPairId)
			: null;
		// What the entry did to its target (a balance owed, a goal, a bill) goes with it.
		if (tx.purpose) await clearPurpose(key, tx, tx.purpose).catch(() => undefined);
		await TransactionRepository.remove(pair ? [tx.id, pair.id] : [tx.id]);
		if (pair) await recalculateAccountBalance(key, pair.accountId);
		await recalculateAccountBalance(key, tx.accountId);
		// A deleted payment must not keep an expected recurring payment marked as paid. (Transfers
		// never match a schedule, so they skip the lookup.)
		if (tx.type !== 'transfer') await releaseMatches(key, id, undefined, [tx.date]).catch(() => 0);
	},

	/**
	 * Other accounts' entries that look like the opposite side of `txId` — same amount with the
	 * sign flipped, within `windowDays` of its date, not already part of a transfer or a person
	 * loan. This is what lets a card payment imported from the bank statement (a debit) and from
	 * the card statement ("payment received", a credit) be recognised as ONE transfer instead of
	 * counting as an expense plus an unrelated income.
	 */
	async findTransferCandidates(
		key: CryptoKey,
		txId: string,
		windowDays = 3
	): Promise<Transaction[]> {
		const tx = await TransactionRepository.getById(key, txId);
		if (!tx) return [];
		const nearby = await TransactionRepository.search(key, {
			dateFrom: addDaysISO(tx.date, -windowDays),
			dateTo: addDaysISO(tx.date, windowDays)
		});
		const candidates = nearby.filter(
			(other) =>
				other.id !== tx.id &&
				other.accountId !== tx.accountId &&
				other.amount === -tx.amount &&
				other.type !== 'transfer' &&
				!other.transferPairId
		);
		const links = await Promise.all(
			candidates.map((c) => TransactionRepository.getLoanLink(key, c.id))
		);
		return candidates.filter((_, index) => links[index] === null);
	},

	/**
	 * Turns an ordinary income/expense entry into one leg of an account-to-account transfer:
	 * either by pairing it with an existing entry on the other account (`{ transactionId }`), or by
	 * creating the missing opposite leg there (`{ accountId }`). The fix for "I recorded the
	 * credit-card bill payment as a plain expense": the expense stops counting as spending, the
	 * card's balance goes down, and both ledgers agree — in one atomic write.
	 */
	async convertToTransfer(
		key: CryptoKey,
		txId: string,
		target: { accountId: string } | { transactionId: string }
	): Promise<[Transaction, Transaction]> {
		const tx = await TransactionRepository.getById(key, txId);
		if (!tx) throw new Error('Transaction not found.');
		if (tx.transferPairId) throw new Error('This transaction is already part of a transfer.');
		const link = await TransactionRepository.getLoanLink(key, txId);
		if (tx.type === 'transfer' || link) {
			throw new Error(
				link
					? linkedTransactionNotice(link).message
					: 'This entry records a loan or repayment, so it is managed from the People page.'
			);
		}

		const now = Date.now();
		let counterpart: Transaction;
		if ('transactionId' in target) {
			const other = await TransactionRepository.getById(key, target.transactionId);
			if (!other) {
				throw new Error('The matching transaction was not found.');
			}
			if (other.transferPairId || other.type === 'transfer') {
				throw new Error('The matching transaction is already part of a transfer.');
			}
			if (other.accountId === tx.accountId) {
				throw new Error('A transfer must be between two different accounts.');
			}
			if (other.amount !== -tx.amount) {
				throw new Error(
					'The matching transaction must be for the same amount in the opposite direction.'
				);
			}
			if (await TransactionRepository.getLoanLink(key, other.id)) {
				throw new Error('The matching transaction belongs to a loan or liability record.');
			}
			// The entry stops being spending, so what it did as a savings or bill entry is undone, as
			// it is for the entry being converted below.
			if (other.purpose) await clearPurpose(key, other, other.purpose);
			counterpart = {
				...other,
				purpose: null,
				type: 'transfer',
				transferPairId: tx.id,
				reviewStatus: 'confirmed',
				duplicateOfId: null,
				updatedAt: now
			};
		} else {
			if (target.accountId === tx.accountId) {
				throw new Error('A transfer must be between two different accounts.');
			}
			const account = await AccountRepository.getById(key, target.accountId);
			if (!account) throw new Error('Account not found.');
			counterpart = {
				id: crypto.randomUUID(),
				accountId: target.accountId,
				date: tx.date,
				amount: -tx.amount,
				type: 'transfer',
				transferPairId: tx.id,
				merchantId: null,
				notes: tx.notes,
				source: 'manual',
				reviewStatus: 'confirmed',
				duplicateOfId: null,
				createdAt: now,
				updatedAt: now
			};
		}

		// A transfer is not spending, so it has no purpose to keep.
		if (tx.purpose) await clearPurpose(key, tx, tx.purpose);
		const converted: Transaction = {
			...tx,
			purpose: null,
			type: 'transfer',
			transferPairId: counterpart.id,
			reviewStatus: 'confirmed',
			duplicateOfId: null,
			updatedAt: now
		};
		// A transfer is not spending or income, so neither leg keeps a category.
		await TransactionRepository.writeAtomic(key, [
			{
				transaction: converted,
				splits: [{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: converted.amount }]
			},
			{
				transaction: counterpart,
				splits: [{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: counterpart.amount }]
			}
		]);
		await recalculateAccountBalance(key, converted.accountId);
		await recalculateAccountBalance(key, counterpart.accountId);
		// No longer an expense/income, so it can no longer be the payment a schedule was waiting for —
		// on either leg.
		await releaseMatches(key, converted.id, undefined, [converted.date]).catch(() => 0);
		await releaseMatches(key, counterpart.id, undefined, [counterpart.date]).catch(() => 0);
		return [converted, counterpart];
	},

	/**
	 * Edits a transfer as one movement: the date, the (positive) amount and the note are applied
	 * to BOTH legs together, each keeping its own sign. Editing one leg alone would silently
	 * unbalance the two accounts.
	 */
	async editTransferPair(
		key: CryptoKey,
		id: string,
		changes: { date?: string; amount?: number; notes?: string | null }
	): Promise<[Transaction, Transaction]> {
		const tx = await TransactionRepository.getById(key, id);
		if (!tx || !tx.transferPairId) throw new Error('This transaction is not part of a transfer.');
		const pair = await TransactionRepository.getById(key, tx.transferPairId);
		if (!pair) throw new Error('The other side of this transfer is missing.');
		if (changes.amount !== undefined && Math.abs(changes.amount) <= 0) {
			throw new Error('Transfer amount must be positive.');
		}
		if (changes.date !== undefined && !isValidIsoDate(changes.date)) {
			throw new Error('Enter a valid date.');
		}

		const now = Date.now();
		const apply = (leg: Transaction): Transaction => ({
			...leg,
			date: changes.date ?? leg.date,
			notes: changes.notes !== undefined ? changes.notes : leg.notes,
			amount:
				changes.amount !== undefined
					? Math.sign(leg.amount) * Math.abs(changes.amount)
					: leg.amount,
			updatedAt: now
		});
		const first = apply(tx);
		const second = apply(pair);
		await TransactionRepository.writeAtomic(key, [
			{
				transaction: first,
				splits: [{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: first.amount }]
			},
			{
				transaction: second,
				splits: [{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: second.amount }]
			}
		]);
		await recalculateAccountBalance(key, first.accountId);
		await recalculateAccountBalance(key, second.accountId);
		return [first, second];
	},

	/**
	 * Confirms a Review Queue transaction (spec 006), optionally applying a user's edited
	 * category/tags before it leaves `unreviewed` — the only entry point that carries a
	 * pre-filled category from `recordTransaction` through to a permanent, confirmed choice.
	 */
	async confirmTransaction(
		key: CryptoKey,
		id: string,
		splits?: SplitInput[],
		tagIds?: string[],
		options: PurposeEffectOptions = {}
	): Promise<Transaction> {
		// Refused before the entry leaves Review, so it stays there for the user to fix.
		const current = await TransactionRepository.getById(key, id);
		if (current?.purpose) {
			const problem = await validatePurpose(key, current, current.purpose);
			if (problem) throw new Error(problem);
		}
		const updated = await TransactionRepository.update(
			key,
			id,
			// Confirming settles a "possible duplicate" flag: the user looked and kept it.
			{ reviewStatus: 'confirmed', duplicateOfId: null },
			splits
		);
		if (tagIds) {
			await TransactionTagRepository.setTags(id, tagIds);
		}

		// Learning signal (spec 006, FR-003/FR-007): only the three auto-entry sources ever
		// reach `unreviewed`/this confirm path, so this naturally scopes learning to exactly
		// "confirmed during review" without needing to branch on `source` explicitly.
		if (updated.merchantId && updated.type !== 'transfer') {
			const [firstSplit] = await TransactionRepository.getSplits(key, id);
			// "Uncategorized" is the absence of a decision, not a category the merchant belongs
			// to: recording it filled the three-slot streak with a placeholder, so a user who
			// confirmed a merchant uncategorized twice and then categorized it once could never
			// build a streak that survived.
			if (firstSplit && firstSplit.categoryId !== UNCATEGORIZED_CATEGORY_ID) {
				await recordConfirmation(key, updated.merchantId, firstSplit.categoryId);
			}
		}

		// Now that it is confirmed, its purpose takes effect on the debt, goal or bill it names.
		if (updated.purpose) {
			const effect = await applyPurpose(key, updated);
			options.onPurposeEffect?.(effect);
		}

		// The category chosen in Review is what finally lets a bill that arrived uncategorized (a bank
		// statement row, an SMS) be matched to its expected recurring payment.
		await rematchTransaction(key, updated);

		return updated;
	}
};
