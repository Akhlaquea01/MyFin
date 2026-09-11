import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { TransactionRepository } from '../dexie/transactionRepository';
import { TransactionEngine } from '../../domain/transactions/transactionEngine';
import { resolveMerchant, normalizeMerchantText } from '../../domain/parser/merchantResolver';
import { parseMoneyToMinorUnits } from '../../domain/shared/money';

export interface ColumnMapping {
	dateColumn: string;
	amountColumn: string;
	descriptionColumn?: string;
	accountId: string;
	dateFormat: string; // e.g. "DD/MM/YYYY", tokens: YYYY, MM, DD
	amountSignConvention: 'negative-is-expense' | 'separate-debit-credit-columns';
	debitColumn?: string;
	creditColumn?: string;
}

export interface ImportResult {
	createdCount: number;
	skippedMalformedRows: { rowNumber: number; reason: string }[];
	flaggedDuplicates: { rowNumber: number; existingTransactionId: string }[];
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

/** How often to yield to the event loop and report progress during a long import. */
const PROGRESS_INTERVAL = 100;

/** ±1 day, same-amount duplicate rule (FR-020/FR-038), expressed as an in-memory lookup so
 *  it costs one index build per import rather than one index walk per row. */
function duplicateKey(date: string, amount: number): string {
	return `${date}|${amount}`;
}

function shiftIsoDay(date: string, deltaDays: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return date;
	parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
	return parsed.toISOString().slice(0, 10);
}

function findDuplicateId(index: Map<string, string>, date: string, amount: number): string | null {
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

/** Parses the first worksheet of an XLSX file's header row and data rows. */
export async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(buffer);
	const sheet = workbook.worksheets[0];
	if (!sheet) return { headers: [], rows: [], errors: [] };

	const headerRow = sheet.getRow(1);
	const headers: string[] = [];
	headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
		headers[colNumber - 1] = String(cell.value ?? '');
	});

	const rows: Record<string, string>[] = [];
	for (let r = 2; r <= sheet.rowCount; r++) {
		const row = sheet.getRow(r);
		if (row.cellCount === 0) continue;
		const record: Record<string, string> = {};
		headers.forEach((header, i) => {
			const cell = row.getCell(i + 1);
			record[header] = cell.value == null ? '' : String(cell.value);
		});
		rows.push(record);
	}
	return { headers, rows, errors: [] };
}

/** Returns the first `limit` parsed rows for a mapping-confirmation preview (contract: preview step). */
export function previewRows(parsed: ParsedFile, limit = 5): Record<string, string>[] {
	return parsed.rows.slice(0, limit);
}

/**
 * Parses a date string against a simple token format (YYYY, MM, DD separated by a single
 * non-alphanumeric literal, e.g. "DD/MM/YYYY") into an ISO "YYYY-MM-DD" string, or null if
 * it doesn't match — the format is required precisely because the source format is unknown
 * (contracts/csv-import-contract.md).
 */
export function parseDateWithFormat(value: string, format: string): string | null {
	const separatorMatch = format.match(/[^A-Za-z]/);
	const separator = separatorMatch ? separatorMatch[0] : '-';
	const formatParts = format.split(separator);
	const valueParts = value.trim().split(separator);
	if (formatParts.length !== 3 || valueParts.length !== 3) return null;

	let year = '';
	let month = '';
	let day = '';
	for (let i = 0; i < formatParts.length; i++) {
		const token = formatParts[i];
		const part = valueParts[i];
		if (!part) return null;
		if (token.startsWith('Y')) year = part;
		else if (token.startsWith('M')) month = part.padStart(2, '0');
		else if (token.startsWith('D')) day = part.padStart(2, '0');
		else return null;
	}
	if (year.length !== 4 || month.length !== 2 || day.length !== 2) return null;
	const iso = `${year}-${month}-${day}`;

	// Round-trip the parts through a Date and check they survive. `new Date('2026-02-31')` does
	// not fail — it rolls forward to 3 March — so a plain NaN check accepted dates that do not
	// exist. The bogus string then sorted as the 31st in the indexed `date` column while every
	// downstream `new Date()` silently shifted it into the next month.
	const y = Number(year);
	const mo = Number(month);
	const d = Number(day);
	const asDate = new Date(Date.UTC(y, mo - 1, d));
	if (
		asDate.getUTCFullYear() !== y ||
		asDate.getUTCMonth() !== mo - 1 ||
		asDate.getUTCDate() !== d
	) {
		return null;
	}
	return iso;
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
	return { amountPaise: raw };
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
	onProgress?: (done: number, total: number) => void
): Promise<ImportResult> {
	const result: ImportResult = { createdCount: 0, skippedMalformedRows: [], flaggedDuplicates: [] };
	if (rows.length > MAX_IMPORT_ROWS) {
		throw new Error(
			`This file has ${rows.length.toLocaleString()} rows. Import at most ` +
				`${MAX_IMPORT_ROWS.toLocaleString()} at a time.`
		);
	}

	// Fetch the account's existing date/amount pairs once. `findPossibleDuplicates` walks the
	// `accountId` index on every call, so calling it per row made duplicate detection scale with
	// (rows x existing transactions) — and it has to see rows added earlier in *this* import too,
	// which is why the index below is appended to as we go.
	const existing = await TransactionRepository.search(key, { accountId: mapping.accountId });
	const duplicateIndex = new Map<string, string>();
	for (const tx of existing) duplicateIndex.set(duplicateKey(tx.date, tx.amount), tx.id);

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNumber = i + 2; // header is row 1

		// Yield to the event loop periodically so a large import doesn't freeze the tab, and
		// report progress so the user sees something happening.
		if (i > 0 && i % PROGRESS_INTERVAL === 0) {
			onProgress?.(i, rows.length);
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		const dateIso = parseDateWithFormat(row[mapping.dateColumn] ?? '', mapping.dateFormat);
		if (!dateIso) {
			result.skippedMalformedRows.push({ rowNumber, reason: 'Unparseable date.' });
			continue;
		}
		const amount = parseAmount(row, mapping);
		if (!amount || amount.amountPaise === 0) {
			result.skippedMalformedRows.push({ rowNumber, reason: 'Unparseable or zero amount.' });
			continue;
		}

		const duplicateOfId = findDuplicateId(duplicateIndex, dateIso, amount.amountPaise);
		const notes = mapping.descriptionColumn ? (row[mapping.descriptionColumn] ?? null) : null;
		// Auto-categorization (spec 006, FR-002) needs a resolved Merchant to match rules/
		// suggestions against. The raw description is normalized first: bank descriptions carry
		// per-transaction reference numbers, so passing them verbatim created one Merchant and
		// one MerchantAlias per row, which defeated both the alias model and the learning signal.
		const merchantText = notes ? normalizeMerchantText(notes) : null;
		const resolved = merchantText ? await resolveMerchant(key, merchantText) : null;

		const created = await TransactionEngine.recordTransaction(
			key,
			{
				accountId: mapping.accountId,
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
			{ deferBalance: true }
		);
		duplicateIndex.set(duplicateKey(dateIso, amount.amountPaise), created.id);

		result.createdCount++;
		if (duplicateOfId) {
			result.flaggedDuplicates.push({ rowNumber, existingTransactionId: duplicateOfId });
		}
	}

	if (result.createdCount > 0) {
		await TransactionEngine.recalculateAccountBalance(key, mapping.accountId);
	}
	onProgress?.(rows.length, rows.length);
	return result;
}
