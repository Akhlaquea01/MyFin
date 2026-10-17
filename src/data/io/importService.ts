import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { TransactionRepository } from '../dexie/transactionRepository';
import { TransactionEngine } from '../../domain/transactions/transactionEngine';
import { createCategorizationResolver } from '../../domain/categorization/resolveCategorization';
import { resolveMerchant, normalizeMerchantText } from '../../domain/parser/merchantResolver';
import { findCardMatches } from '../../domain/parser/cardIdentifierMatcher';
import { extractRefNo } from '../../domain/capture/captureParser';
import { detectCardPayment } from '../../domain/parser/cardPaymentDetector';
import { parseMoneyToMinorUnits } from '../../domain/shared/money';
import type { Account } from '../../domain/entities';

export interface ColumnMapping {
	dateColumn: string;
	amountColumn: string;
	descriptionColumn?: string;
	accountId: string;
	/** Optional column carrying a per-row account name. When set, each row is routed to the
	 *  account it names instead of `accountId` (FR-002/FR-003). */
	accountColumn?: string;
	dateFormat: string; // e.g. "DD/MM/YYYY", tokens: YYYY, MM, DD
	amountSignConvention:
		| 'negative-is-expense'
		/** Credit-card statements list purchases as positive amounts and payments/refunds as negative. */
		| 'positive-is-expense'
		| 'separate-debit-credit-columns';
	debitColumn?: string;
	creditColumn?: string;
}

export interface ImportResult {
	createdCount: number;
	skippedMalformedRows: { rowNumber: number; reason: string }[];
	flaggedDuplicates: { rowNumber: number; existingTransactionId: string }[];
	/** Present only when `mapping.accountColumn` was used (FR-007); one entry per account
	 *  that received at least one created transaction. */
	perAccountSummary?: Record<string, { count: number; accountName: string }>;
}

export interface ParsedFile {
	headers: string[];
	rows: Record<string, string>[];
	/** Papa Parse's own complaints (malformed quoting, inconsistent field counts). Surfaced so
	 *  a file that parsed into garbage doesn't look identical to one that parsed cleanly. */
	errors: { row: number; message: string }[];
}

/** Refuses input large enough to lock the tab. All parsing and crypto runs on the main
 *  thread, so an unbounded file is a self-inflicted denial of service. */
export const MAX_IMPORT_ROWS = 20_000;

/** Rejected before `parseCsv`/`parseXlsx` ever runs — both parse the whole file synchronously
 *  (Papa.parse) or load it entirely into memory (ExcelJS), so the row-count cap above is too
 *  late to prevent the tab from hanging on an oversized file; this catches it first. Sized
 *  generously above what a MAX_IMPORT_ROWS-row bank statement could plausibly weigh. */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

/** How often to yield to the event loop and report progress during a long import. */
const PROGRESS_INTERVAL = 100;

/** ±1 day, same-amount duplicate rule (FR-020/FR-038), expressed as an in-memory lookup so
 *  it costs one index build per import rather than one index walk per row. */
export function duplicateKey(date: string, amount: number): string {
	return `${date}|${amount}`;
}

export function shiftIsoDay(date: string, deltaDays: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return date;
	parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
	return parsed.toISOString().slice(0, 10);
}

/** Index key for a captured entry's bank reference, so a statement row quoting it matches however
 *  late the bank posted it. */
export function referenceKey(refNo: string, amount: number): string {
	return `ref|${refNo}|${amount}`;
}

export function findDuplicateId(
	index: Map<string, string>,
	date: string,
	amount: number
): string | null {
	for (const delta of [0, -1, 1]) {
		const found = index.get(duplicateKey(shiftIsoDay(date, delta), amount));
		if (found) return found;
	}
	return null;
}

/** Parses a CSV file's header row and data rows into string-keyed records (contract: preview step). */
export function parseCsv(fileText: string): ParsedFile {
	const result = Papa.parse<Record<string, string>>(fileText, {
		header: true,
		skipEmptyLines: true
	});
	const headers = result.meta.fields ?? [];
	return {
		headers,
		rows: result.data,
		errors: (result.errors ?? []).map((e) => ({ row: (e.row ?? 0) + 2, message: e.message }))
	};
}

/**
 * A worksheet cell as the text a CSV would have carried. `String(cell.value)` turned a real Excel
 * date into "Thu Mar 05 2026 …" and a formula, rich-text or hyperlink cell into "[object Object]",
 * so every row of a typical bank workbook was skipped as an unparseable date or amount.
 */
export function cellToText(value: ExcelJS.CellValue): string {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) {
		// Excel dates carry no timezone; ExcelJS hands them back as UTC midnight (plus any time of day).
		return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
	}
	if (typeof value === 'number') {
		// A computed cell can come back as 1234.5600000000002; two decimals is all a rupee amount has.
		const rounded = Math.round(value * 100) / 100;
		return Math.abs(value - rounded) < 1e-6 ? String(rounded) : String(value);
	}
	if (typeof value === 'object') {
		if ('result' in value) return cellToText(value.result as ExcelJS.CellValue);
		if ('richText' in value) return value.richText.map((part) => part.text).join('');
		if ('text' in value) return String(value.text);
		if ('error' in value) return '';
	}
	return String(value);
}

/** Parses the first worksheet of an XLSX file's header row and data rows. */
export async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(buffer);
	const sheet = workbook.worksheets[0];
	if (!sheet) return { headers: [], rows: [], errors: [] };

	const headerRow = sheet.getRow(1);
	const headers: string[] = [];
	headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
		headers[colNumber - 1] = cellToText(cell.value);
	});

	const rows: Record<string, string>[] = [];
	for (let r = 2; r <= sheet.rowCount; r++) {
		const row = sheet.getRow(r);
		if (row.cellCount === 0) continue;
		const record: Record<string, string> = {};
		headers.forEach((header, i) => {
			const cell = row.getCell(i + 1);
			record[header] = cellToText(cell.value);
		});
		// A styled-but-empty spacer/border row (common in real bank exports) has cells with no
		// values, so `cellCount` alone doesn't catch it — mirrors parseCsv's `skipEmptyLines`.
		if (Object.values(record).every((v) => v === '')) continue;
		rows.push(record);
	}
	return { headers, rows, errors: [] };
}

/** Returns the first `limit` parsed rows for a mapping-confirmation preview (contract: preview step). */
export function previewRows(parsed: ParsedFile, limit = 5): Record<string, string>[] {
	return parsed.rows.slice(0, limit);
}

const MONTH_ABBREVIATIONS = [
	'jan',
	'feb',
	'mar',
	'apr',
	'may',
	'jun',
	'jul',
	'aug',
	'sep',
	'oct',
	'nov',
	'dec'
];

/** A trailing clock time ("14:30", "14:30:05", "2:30 PM", "T14:30:05Z"): banks that stamp one still
 *  mean the calendar date in front of it. */
const TRAILING_TIME =
	/[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AaPp][Mm])?\s*(?:Z|[+-]\d{2}:?\d{2})?$/;

/** Builds "YYYY-MM-DD" from numeric parts, or null if they do not name a real calendar day. */
function toIsoDate(year: number, month: number, day: number): string | null {
	const asDate = new Date(Date.UTC(year, month - 1, day));
	// Round-trip through a Date and check the parts survive: `new Date('2026-02-31')` does not fail,
	// it rolls forward to 3 March, so a plain NaN check accepted dates that do not exist. The bogus
	// string then sorted as the 31st in the indexed `date` column while every downstream
	// `new Date()` silently shifted it into the next month.
	if (
		year < 1000 ||
		asDate.getUTCFullYear() !== year ||
		asDate.getUTCMonth() !== month - 1 ||
		asDate.getUTCDate() !== day
	) {
		return null;
	}
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parses a date string against a simple token format into an ISO "YYYY-MM-DD" string, or null if
 * it doesn't match — the format is required precisely because the source format is unknown
 * (contracts/csv-import-contract.md). Tokens are separated by one literal (`/`, `-`, `.` or a
 * space): YYYY or YY for the year, MM for a numeric month or MMM for a name ("Mar"), DD for the day.
 * A clock time after the date is ignored, and an unambiguous ISO date is accepted whatever the
 * format says (an Excel date cell is handed over as one).
 */
export function parseDateWithFormat(value: string, format: string): string | null {
	const text = value.trim().replace(TRAILING_TIME, '').trim();

	const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (isoMatch && !format.trim().toUpperCase().startsWith('Y')) {
		return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
	}

	const separatorMatch = format.match(/[^A-Za-z]/);
	const separator = separatorMatch ? separatorMatch[0] : '-';
	const formatParts = format.split(separator);
	const valueParts = /\s/.test(separator) ? text.split(/\s+/) : text.split(separator);
	if (formatParts.length !== 3 || valueParts.length !== 3) return null;

	let year = NaN;
	let month = NaN;
	let day = NaN;
	for (let i = 0; i < formatParts.length; i++) {
		const token = formatParts[i];
		// Trimmed so a loosely-formatted value (e.g. "06 / 09 / 2026", from a hand-edited or
		// copy-pasted statement) isn't rejected just for whitespace around the separator.
		const part = valueParts[i]?.trim();
		if (!part) return null;
		if (token.startsWith('Y')) {
			if (!/^\d+$/.test(part)) return null;
			if (token.length <= 2) {
				if (part.length !== 2) return null;
				// Two-digit years: 00-69 are this century, 70-99 the last.
				year = Number(part) + (Number(part) <= 69 ? 2000 : 1900);
			} else {
				if (part.length !== 4) return null;
				year = Number(part);
			}
		} else if (token.startsWith('M')) {
			if (token.length >= 3) {
				const index = MONTH_ABBREVIATIONS.indexOf(part.slice(0, 3).toLowerCase());
				if (index === -1) return null;
				month = index + 1;
			} else {
				if (!/^\d{1,2}$/.test(part)) return null;
				month = Number(part);
			}
		} else if (token.startsWith('D')) {
			if (!/^\d{1,2}$/.test(part)) return null;
			day = Number(part);
		} else {
			return null;
		}
	}
	if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
	return toIsoDate(year, month, day);
}

/**
 * Parses a row's amount into integer paise, or `null` if the cell isn't a well-formed amount.
 *
 * Uses the strict shared parser rather than `parseFloat`: bank exports routinely write
 * "1,234.56", which `parseFloat` truncated to `1` — importing a ₹1,234.56 transaction as
 * ₹1.00 and reporting it as a success. A `null` here becomes a visible `skippedMalformedRows`
 * entry instead (Constitution Principle VI).
 */
function parseAmount(
	row: Record<string, string>,
	mapping: ColumnMapping
): { amountPaise: number } | null {
	if (mapping.amountSignConvention === 'separate-debit-credit-columns') {
		const debitStr = mapping.debitColumn ? row[mapping.debitColumn] : '';
		const creditStr = mapping.creditColumn ? row[mapping.creditColumn] : '';
		const debit = parseMoneyToMinorUnits(debitStr?.trim() || '0');
		const credit = parseMoneyToMinorUnits(creditStr?.trim() || '0');
		if (debit === null || credit === null) return null;
		return { amountPaise: credit - debit };
	}
	const raw = parseMoneyToMinorUnits(row[mapping.amountColumn]);
	if (raw === null) return null;
	return { amountPaise: mapping.amountSignConvention === 'positive-is-expense' ? -raw : raw };
}

/**
 * Resolves a multi-account import row's destination account (FR-003) by matching `value`
 * against `accounts` by name, case-insensitively and whitespace-trimmed. `accounts` must
 * include archived accounts — they are equally valid matches here (FR-003) even though the
 * plain single-account picker excludes them. Matching is name-only: an account's internal id
 * is never checked, since it is an opaque UUID no real source file would contain
 * (research.md §6).
 */
export function resolveAccountForRow(value: string, accounts: Account[]): Account | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	return accounts.find((a) => a.name.trim().toLowerCase() === trimmed.toLowerCase()) ?? null;
}

/**
 * Whole-file pre-pass (FR-006): the app does not enforce unique account names today, so a
 * value that matches more than one account is ambiguous, not resolvable. Returns the distinct
 * values (first-seen order) that match more than one account; an empty result means every
 * value is safe to resolve individually via `resolveAccountForRow`.
 */
export function findAccountNameCollisions(values: string[], accounts: Account[]): string[] {
	const seen = new Set<string>();
	const distinct: string[] = [];
	for (const raw of values) {
		const trimmed = raw.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		distinct.push(trimmed);
	}
	return distinct.filter((value) => {
		const matches = accounts.filter((a) => a.name.trim().toLowerCase() === value.toLowerCase());
		return matches.length > 1;
	});
}

/**
 * Commits mapped rows as transactions (FR-037/FR-038): a row that fails to parse under the
 * given mapping is reported in `skippedMalformedRows` rather than silently guessed at, and
 * a likely duplicate (FR-020/FR-038 rule) is still created — flagged and left unreviewed —
 * rather than auto-merged or auto-discarded.
 */
export async function importRows(
	key: CryptoKey,
	rows: Record<string, string>[],
	mapping: ColumnMapping,
	accounts: Account[] = [],
	onProgress?: (done: number, total: number) => void
): Promise<ImportResult> {
	const result: ImportResult = { createdCount: 0, skippedMalformedRows: [], flaggedDuplicates: [] };
	if (rows.length > MAX_IMPORT_ROWS) {
		throw new Error(
			`This file has ${rows.length.toLocaleString()} rows. Import at most ` +
				`${MAX_IMPORT_ROWS.toLocaleString()} at a time.`
		);
	}

	// Fail fast on a misconfigured mapping rather than letting every single row resolve to a
	// zero amount and get reported as N identical "Zero-amount transactions are not imported"
	// skips, which reads as a corrupt file rather than the one-time setup mistake it actually is.
	if (
		mapping.amountSignConvention === 'separate-debit-credit-columns' &&
		(!mapping.debitColumn || !mapping.creditColumn)
	) {
		throw new Error('Choose both a debit column and a credit column for this amount format.');
	}

	// Whole-file pre-pass (FR-006): block the ENTIRE import — before any transaction is
	// created — if an account name referenced anywhere in the file is ambiguous. The app does
	// not enforce unique account names today, so this can't be assumed away (research.md §3).
	if (mapping.accountColumn) {
		const distinctValues = rows
			.map((r) => r[mapping.accountColumn!]?.trim())
			.filter((v): v is string => !!v);
		const collisions = findAccountNameCollisions(distinctValues, accounts);
		if (collisions.length > 0) {
			throw new Error(
				`Account name "${collisions[0]}" matches more than one account. Rename one of ` +
					`them and try again.`
			);
		}
	}

	// Per-account duplicate index, built lazily the first time a row resolves to that account
	// (research.md §4) — a file that references a handful of accounts should only pay the cost
	// of fetching those accounts' existing transactions, not every account regardless of use.
	const duplicateIndexes = new Map<string, Map<string, string>>();
	async function duplicateIndexFor(accountId: string): Promise<Map<string, string>> {
		let index = duplicateIndexes.get(accountId);
		if (!index) {
			const existing = await TransactionRepository.search(key, { accountId });
			index = new Map<string, string>();
			for (const tx of existing) {
				index.set(duplicateKey(tx.date, tx.amount), tx.id);
				if (tx.capture?.refNo) index.set(referenceKey(tx.capture.refNo, tx.amount), tx.id);
			}
			duplicateIndexes.set(accountId, index);
		}
		return index;
	}
	const touchedAccountIds = new Set<string>();
	// One resolver for the whole file: keyword rules are loaded once and per-merchant lookups cached,
	// instead of re-queried for each of up to MAX_IMPORT_ROWS rows.
	const categorizer = await createCategorizationResolver(key);
	// FR-024: tracked so `perAccountSummary` also appears when routing came from card-identifier
	// matching, not just from an explicit `accountColumn` mapping.
	let usedCardMatching = false;

	// Balances are deferred per row (the recalculation is O(account size)), so they are brought up to
	// date here whatever happens: a row that fails part-way used to leave the rows already created with
	// no balance recalculation at all, so the account disagreed with its own ledger until the next edit.
	try {
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			const rowNumber = i + 2; // header is row 1

			// Yield to the event loop periodically so a large import doesn't freeze the tab, and
			// report progress so the user sees something happening.
			if (i > 0 && i % PROGRESS_INTERVAL === 0) {
				onProgress?.(i, rows.length);
				await new Promise((resolve) => setTimeout(resolve, 0));
			}

			// Resolve the row's destination account (FR-002/FR-003/FR-004). A blank or unresolved
			// value is skipped and reported — it never falls back to `mapping.accountId`.
			let txAccountId: string;
			if (mapping.accountColumn) {
				const rawValue = row[mapping.accountColumn] ?? '';
				if (!rawValue.trim()) {
					result.skippedMalformedRows.push({ rowNumber, reason: 'Account column is empty.' });
					continue;
				}
				const resolvedAccount = resolveAccountForRow(rawValue, accounts);
				if (!resolvedAccount) {
					result.skippedMalformedRows.push({
						rowNumber,
						reason: `Account "${rawValue.trim()}" not found.`
					});
					continue;
				}
				txAccountId = resolvedAccount.id;
			} else {
				// FR-020/FR-021/FR-024: when no explicit account column is mapped, a single tagged-
				// card identifier detected in this row's description overrides the file-level
				// fallback; an ambiguous or unmatched row falls back to it unchanged (never blocks).
				let cardMatchedAccountId: string | null = null;
				if (mapping.descriptionColumn) {
					const cellText = row[mapping.descriptionColumn] ?? '';
					// A line like "CREDIT CARD PAYMENT XX1234" on a BANK statement names the card but is not a
					// card transaction: routing it to the card recorded the payment as an expense ON the card
					// (the debt went up) and left the bank balance untouched. It stays on the account the file
					// belongs to; Review then offers "Record as transfer" with the card suggested.
					const rowMatches = detectCardPayment(cellText) ? [] : findCardMatches(cellText, accounts);
					const distinctIds = [...new Set(rowMatches.map((m) => m.accountId))];
					if (distinctIds.length === 1) cardMatchedAccountId = distinctIds[0];
				}
				if (cardMatchedAccountId) usedCardMatching = true;
				txAccountId = cardMatchedAccountId ?? mapping.accountId;
			}

			const dateIso = parseDateWithFormat(row[mapping.dateColumn] ?? '', mapping.dateFormat);
			if (!dateIso) {
				result.skippedMalformedRows.push({ rowNumber, reason: 'Unparseable date.' });
				continue;
			}
			const amount = parseAmount(row, mapping);
			if (!amount) {
				result.skippedMalformedRows.push({ rowNumber, reason: 'Unparseable amount.' });
				continue;
			}
			if (amount.amountPaise === 0) {
				// Distinct from the malformed case above: this amount parsed correctly as zero (e.g. a
				// reversed/void entry), which is intentionally excluded rather than a sign the column
				// mapping is wrong.
				result.skippedMalformedRows.push({
					rowNumber,
					reason: 'Zero-amount transactions are not imported.'
				});
				continue;
			}

			const duplicateIndex = await duplicateIndexFor(txAccountId);
			const notes = mapping.descriptionColumn ? (row[mapping.descriptionColumn] ?? null) : null;
			const rowRef = notes ? extractRefNo(notes) : null;
			const duplicateOfId =
				findDuplicateId(duplicateIndex, dateIso, amount.amountPaise) ??
				(rowRef ? (duplicateIndex.get(referenceKey(rowRef, amount.amountPaise)) ?? null) : null);
			// Auto-categorization (spec 006, FR-002) needs a resolved Merchant to match rules/
			// suggestions against. The raw description is normalized first: bank descriptions carry
			// per-transaction reference numbers, so passing them verbatim created one Merchant and
			// one MerchantAlias per row, which defeated both the alias model and the learning signal.
			const merchantText = notes ? normalizeMerchantText(notes) : null;
			const resolved = merchantText ? await resolveMerchant(key, merchantText) : null;

			const created = await TransactionEngine.recordTransaction(
				key,
				{
					accountId: txAccountId,
					date: dateIso,
					amount: amount.amountPaise,
					type: amount.amountPaise >= 0 ? 'income' : 'expense',
					notes,
					merchantId: resolved?.merchantId ?? null,
					merchantAliasId: resolved?.aliasId ?? null,
					source: 'file_import',
					reviewStatus: 'unreviewed',
					duplicateOfId
				},
				[],
				// Recalculated once below instead of once per row: the recalculation is O(account
				// size), so doing it per row made an N-row import cost ~N^2/2 decryptions.
				{ deferBalance: true, categorizer }
			);
			duplicateIndex.set(duplicateKey(dateIso, amount.amountPaise), created.id);
			touchedAccountIds.add(txAccountId);

			result.createdCount++;
			if (duplicateOfId) {
				result.flaggedDuplicates.push({ rowNumber, existingTransactionId: duplicateOfId });
			}
			if (mapping.accountColumn || usedCardMatching) {
				result.perAccountSummary ??= {};
				const accountName = accounts.find((a) => a.id === txAccountId)?.name ?? txAccountId;
				const entry = (result.perAccountSummary[txAccountId] ??= { count: 0, accountName });
				entry.count++;
			}
		}
	} finally {
		// Recalculate balance once per touched account (research.md §5) — not once per row, and
		// not just for `mapping.accountId`, since a multi-account import can touch several.
		for (const accountId of touchedAccountIds) {
			await TransactionEngine.recalculateAccountBalance(key, accountId);
		}
	}
	onProgress?.(rows.length, rows.length);
	return result;
}
