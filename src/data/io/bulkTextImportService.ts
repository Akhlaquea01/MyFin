import { parseQuickAddText, isConfident } from '../../domain/parser/quickAddParser';
import { resolveMerchant, normalizeMerchantText } from '../../domain/parser/merchantResolver';
import { TransactionRepository } from '../dexie/transactionRepository';
import { TransactionEngine } from '../../domain/transactions/transactionEngine';

/**
 * Caps on pasted input. All parsing and crypto runs on the main thread, and the merchant
 * pattern in quickAddParser backtracks super-linearly, so an unbounded paste is a
 * self-inflicted denial of service — the tab simply stops responding with no way to cancel.
 */
export const MAX_TEXT_LENGTH = 500_000;
export const MAX_TEXT_LINES = 5_000;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface ImportResult {
	createdCount: number;
	skippedMalformedRows: { rowNumber: number; reason: string }[];
	flaggedDuplicates: { rowNumber: number; existingTransactionId: string }[];
}

/**
 * Bulk text import (User Story 4, FR-019/FR-021): each non-empty line is treated as one
 * candidate message. Per contracts/csv-import-contract.md, unrecognized lines are reported
 * (never silently dropped) and likely duplicates are flagged, not auto-merged/discarded.
 *
 * Simplification: parsed messages rarely carry a machine-readable date on their own line,
 * so every imported transaction is dated "today" — the user can correct it from the
 * review queue (FR-022) like any other unreviewed transaction.
 */
export async function importBulkText(
	key: CryptoKey,
	fileText: string,
	accountId: string
): Promise<ImportResult> {
	if (fileText.length > MAX_TEXT_LENGTH) {
		throw new Error(
			`That's ${fileText.length.toLocaleString()} characters. Paste at most ` +
				`${MAX_TEXT_LENGTH.toLocaleString()} at a time.`
		);
	}
	const today = new Date().toISOString().slice(0, 10);
	const lines = fileText.split(/\r?\n/);
	if (lines.length > MAX_TEXT_LINES) {
		throw new Error(
			`That's ${lines.length.toLocaleString()} lines. Import at most ` +
				`${MAX_TEXT_LINES.toLocaleString()} at a time.`
		);
	}
	const result: ImportResult = { createdCount: 0, skippedMalformedRows: [], flaggedDuplicates: [] };

	// Duplicate detection reads the account's existing transactions once, rather than walking
	// the `accountId` index per line. Rows created during this run are added as we go, so a
	// repeated line inside one paste is still flagged.
	const existing = await TransactionRepository.search(key, { accountId });
	const seenAmounts = new Map<number, string>();
	for (const tx of existing) {
		if (Math.abs(new Date(tx.date).getTime() - new Date(today).getTime()) <= ONE_DAY_MS) {
			seenAmounts.set(tx.amount, tx.id);
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		const rowNumber = i + 1;
		if (!line) continue;

		const candidate = parseQuickAddText(line);
		if (!isConfident(candidate) || candidate.amount === null) {
			result.skippedMalformedRows.push({
				rowNumber,
				reason: 'Could not confidently parse this line.'
			});
			continue;
		}

		const signedAmount = candidate.type === 'expense' ? -candidate.amount : candidate.amount;
		const duplicateOfId = seenAmounts.get(signedAmount) ?? null;

		// Normalized before resolving, for the same reason file import normalizes: raw parsed
		// text carries reference numbers that would mint one Merchant per line.
		const merchantText = candidate.merchantText
			? normalizeMerchantText(candidate.merchantText)
			: null;
		const resolved = merchantText ? await resolveMerchant(key, merchantText) : null;

		const created = await TransactionEngine.recordTransaction(
			key,
			{
				accountId,
				date: today,
				amount: signedAmount,
				type: candidate.type === 'income' ? 'income' : 'expense',
				merchantId: resolved?.merchantId ?? null,
				merchantAliasId: resolved?.aliasId ?? null,
				source: 'bulk_import',
				reviewStatus: 'unreviewed',
				duplicateOfId
			},
			[],
			// One recalculation at the end instead of one per line — see importService.ts.
			{ deferBalance: true }
		);
		seenAmounts.set(signedAmount, created.id);

		result.createdCount++;
		if (duplicateOfId) {
			result.flaggedDuplicates.push({ rowNumber, existingTransactionId: duplicateOfId });
		}
	}

	if (result.createdCount > 0) {
		await TransactionEngine.recalculateAccountBalance(key, accountId);
	}
	return result;
}
