import { parseQuickAddText, isConfident } from '../../domain/parser/quickAddParser';
import { resolveMerchant } from '../../domain/parser/merchantResolver';
import { TransactionRepository } from '../dexie/transactionRepository';
import { TransactionEngine } from '../../domain/transactions/transactionEngine';

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
	const today = new Date().toISOString().slice(0, 10);
	const lines = fileText.split(/\r?\n/);
	const result: ImportResult = { createdCount: 0, skippedMalformedRows: [], flaggedDuplicates: [] };

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
		const duplicates = await TransactionRepository.findPossibleDuplicates(
			key,
			accountId,
			signedAmount,
			today
		);

		const resolved = candidate.merchantText
			? await resolveMerchant(key, candidate.merchantText)
			: null;

		await TransactionEngine.recordTransaction(key, {
			accountId,
			date: today,
			amount: signedAmount,
			type: candidate.type === 'income' ? 'income' : 'expense',
			merchantId: resolved?.merchantId ?? null,
			merchantAliasId: resolved?.aliasId ?? null,
			source: 'bulk_import',
			reviewStatus: 'unreviewed',
			duplicateOfId: duplicates[0]?.id ?? null
		});

		result.createdCount++;
		if (duplicates[0]) {
			result.flaggedDuplicates.push({ rowNumber, existingTransactionId: duplicates[0].id });
		}
	}

	return result;
}
