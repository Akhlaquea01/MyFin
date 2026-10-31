// Delete or recategorise many entries at once. Each entry goes through the same engine call as its
// single-entry counterpart, so balances, purposes and recurring matches behave identically; what
// the single flows refuse (an entry that belongs to a loan, payment or trade) is skipped here, and
// the batch carries on and reports counts instead of stopping half way.
import { TransactionRepository } from '../../data/dexie/transactionRepository';
import { TransactionEngine } from './transactionEngine';

export interface BulkDeleteResult {
	deleted: number;
	/** Belong to a loan, liability payment or investment trade, which is reversed from its own page. */
	linked: number;
	failed: number;
}

export interface BulkCategoryResult {
	updated: number;
	/** Transfers have no category. */
	transfers: number;
	/** Already split across categories; one category for the lot would discard the split. */
	split: number;
	linked: number;
	failed: number;
}

export async function bulkDeleteTransactions(
	key: CryptoKey,
	ids: string[]
): Promise<BulkDeleteResult> {
	const links = await TransactionRepository.linkKindsByTransaction(key);
	const result: BulkDeleteResult = { deleted: 0, linked: 0, failed: 0 };
	// Deleting one leg of a transfer deletes both, so the other leg, if also selected, is already gone.
	const removedWithPair = new Set<string>();
	for (const id of new Set(ids)) {
		if (removedWithPair.has(id)) {
			result.deleted++;
			continue;
		}
		if (links.has(id)) {
			result.linked++;
			continue;
		}
		try {
			const tx = await TransactionRepository.getById(key, id);
			if (!tx) {
				result.failed++;
				continue;
			}
			await TransactionEngine.deleteTransaction(key, id);
			result.deleted++;
			if (tx.transferPairId) removedWithPair.add(tx.transferPairId);
		} catch {
			result.failed++;
		}
	}
	return result;
}

export async function bulkSetCategory(
	key: CryptoKey,
	ids: string[],
	categoryId: string
): Promise<BulkCategoryResult> {
	const links = await TransactionRepository.linkKindsByTransaction(key);
	const result: BulkCategoryResult = { updated: 0, transfers: 0, split: 0, linked: 0, failed: 0 };
	for (const id of new Set(ids)) {
		try {
			const tx = await TransactionRepository.getById(key, id);
			if (!tx) {
				result.failed++;
			} else if (tx.type === 'transfer') {
				result.transfers++;
			} else if (links.has(id)) {
				result.linked++;
			} else if ((await TransactionRepository.getSplits(key, id)).length > 1) {
				result.split++;
			} else {
				// A manual choice carries no `categorizationSource`, as in the edit dialog.
				await TransactionEngine.editTransaction(key, id, {}, [{ categoryId, amount: tx.amount }]);
				result.updated++;
			}
		} catch {
			result.failed++;
		}
	}
	return result;
}

export interface BulkSummary {
	message: string;
	/** True when something was skipped or failed, so the page shows a warning rather than a success. */
	partial: boolean;
}

const count = (n: number, noun: string, plural = `${noun}s`) => `${n} ${n === 1 ? noun : plural}`;

export function summarizeBulkDelete({ deleted, linked, failed }: BulkDeleteResult): BulkSummary {
	const parts = [
		deleted > 0 ? `Deleted ${count(deleted, 'transaction')}.` : 'Nothing was deleted.'
	];
	if (linked > 0) {
		parts.push(
			`${count(linked, 'entry', 'entries')} belonging to a loan, payment or investment ${linked === 1 ? 'was' : 'were'} kept; undo ${linked === 1 ? 'it' : 'them'} from the page that owns ${linked === 1 ? 'it' : 'them'}.`
		);
	}
	if (failed > 0) parts.push(`${count(failed, 'entry', 'entries')} could not be deleted.`);
	return { message: parts.join(' '), partial: linked > 0 || failed > 0 };
}

export function summarizeBulkCategory(r: BulkCategoryResult): BulkSummary {
	const parts = [
		r.updated > 0 ? `Updated ${count(r.updated, 'transaction')}.` : 'Nothing was changed.'
	];
	const skipped: string[] = [];
	if (r.transfers > 0) skipped.push(`${count(r.transfers, 'transfer')} (no category)`);
	if (r.split > 0) skipped.push(`${r.split} already split across categories`);
	if (r.linked > 0) skipped.push(`${r.linked} belonging to a loan, payment or investment`);
	if (skipped.length > 0) parts.push(`Skipped: ${skipped.join(', ')}.`);
	if (r.failed > 0) parts.push(`${r.failed} could not be updated.`);
	return { message: parts.join(' '), partial: skipped.length > 0 || r.failed > 0 };
}
