import { parseQuickAddText, isConfident } from '../../domain/parser/quickAddParser';
import { resolveMerchant, normalizeMerchantText } from '../../domain/parser/merchantResolver';
import { findCardMatches } from '../../domain/parser/cardIdentifierMatcher';
import { detectCardPayment } from '../../domain/parser/cardPaymentDetector';
import { TransactionRepository } from '../dexie/transactionRepository';
import { TransactionEngine } from '../../domain/transactions/transactionEngine';
import { createCategorizationResolver } from '../../domain/categorization/resolveCategorization';
import type { Account } from '../../domain/entities';
import { todayLocalISO } from '../../domain/shared/dateMath';

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
 * A line that states its own date ("on 12/10/2026", "12-Oct-26") is filed on that date; a line
 * that does not is dated "today", and the user can correct it from the review queue (FR-022)
 * like any other unreviewed transaction. Duplicate checking is relative to each line's own date.
 */
export async function importBulkText(
	key: CryptoKey,
	fileText: string,
	accountId: string,
	accounts: Account[] = []
): Promise<ImportResult> {
	if (fileText.length > MAX_TEXT_LENGTH) {
		throw new Error(
			`That's ${fileText.length.toLocaleString()} characters. Paste at most ` +
				`${MAX_TEXT_LENGTH.toLocaleString()} at a time.`
		);
	}
	const today = todayLocalISO();
	const lines = fileText.split(/\r?\n/);
	if (lines.length > MAX_TEXT_LINES) {
		throw new Error(
			`That's ${lines.length.toLocaleString()} lines. Import at most ` +
				`${MAX_TEXT_LINES.toLocaleString()} at a time.`
		);
	}
	const result: ImportResult = { createdCount: 0, skippedMalformedRows: [], flaggedDuplicates: [] };

	// Per-account duplicate index, built lazily the first time a line resolves to that account
	// (mirrors importService.ts's importRows) — most pastes still touch a single account, so this
	// costs no more than today's one-account case in the common path. Rows created during this
	// run are added as we go, so a repeated line inside one paste is still flagged.
	type SeenEntry = { id: string; date: string };
	const seenAmountsByAccount = new Map<string, Map<number, SeenEntry[]>>();
	async function seenAmountsFor(forAccountId: string): Promise<Map<number, SeenEntry[]>> {
		let seenAmounts = seenAmountsByAccount.get(forAccountId);
		if (!seenAmounts) {
			const existing = await TransactionRepository.search(key, { accountId: forAccountId });
			seenAmounts = new Map<number, SeenEntry[]>();
			for (const tx of existing) {
				const entries = seenAmounts.get(tx.amount) ?? [];
				entries.push({ id: tx.id, date: tx.date });
				seenAmounts.set(tx.amount, entries);
			}
			seenAmountsByAccount.set(forAccountId, seenAmounts);
		}
		return seenAmounts;
	}
	/** An entry of the same amount within a day of `date`, if there is one. */
	function findSeen(
		seenAmounts: Map<number, SeenEntry[]>,
		amount: number,
		date: string
	): string | null {
		const wanted = new Date(`${date}T00:00:00Z`).getTime();
		for (const entry of seenAmounts.get(amount) ?? []) {
			const at = new Date(`${entry.date}T00:00:00Z`).getTime();
			if (Math.abs(at - wanted) <= ONE_DAY_MS) return entry.id;
		}
		return null;
	}
	const touchedAccountIds = new Set<string>();
	// One resolver for the whole paste — see importService.ts.
	const categorizer = await createCategorizationResolver(key);

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

		// FR-020/FR-021/FR-024: a single distinct match on this specific line routes it to that
		// tagged card instead of the pre-matched/manually-chosen default; an ambiguous or
		// unmatched line falls back to the default without blocking the rest of the import.
		// A card *payment* line names the card but belongs to the paying account — see importService.ts.
		const lineMatches = detectCardPayment(line) ? [] : findCardMatches(line, accounts);
		const distinctLineAccountIds = [...new Set(lineMatches.map((m) => m.accountId))];
		const lineAccountId =
			distinctLineAccountIds.length === 1 ? distinctLineAccountIds[0] : accountId;

		const signedAmount = candidate.type === 'expense' ? -candidate.amount : candidate.amount;
		const lineDate = candidate.date ?? today;
		const seenAmounts = await seenAmountsFor(lineAccountId);
		const duplicateOfId = findSeen(seenAmounts, signedAmount, lineDate);

		// Normalized before resolving, for the same reason file import normalizes: raw parsed
		// text carries reference numbers that would mint one Merchant per line.
		const merchantText = candidate.merchantText
			? normalizeMerchantText(candidate.merchantText)
			: null;
		const resolved = merchantText ? await resolveMerchant(key, merchantText) : null;

		const created = await TransactionEngine.recordTransaction(
			key,
			{
				accountId: lineAccountId,
				date: lineDate,
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
			{ deferBalance: true, categorizer }
		);
		const entries = seenAmounts.get(signedAmount) ?? [];
		entries.push({ id: created.id, date: lineDate });
		seenAmounts.set(signedAmount, entries);
		touchedAccountIds.add(lineAccountId);

		result.createdCount++;
		if (duplicateOfId) {
			result.flaggedDuplicates.push({ rowNumber, existingTransactionId: duplicateOfId });
		}
	}

	// Recalculate every account actually touched — not just the default `accountId` — since a
	// mixed-statement paste (FR-024) can route different lines to different tagged cards.
	for (const touchedAccountId of touchedAccountIds) {
		await TransactionEngine.recalculateAccountBalance(key, touchedAccountId);
	}
	return result;
}
