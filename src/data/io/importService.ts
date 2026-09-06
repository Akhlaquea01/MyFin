import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { TransactionRepository } from '../dexie/transactionRepository';
import { TransactionEngine } from '../../domain/transactions/transactionEngine';
import { resolveMerchant } from '../../domain/parser/merchantResolver';

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
}

/** Parses a CSV file's header row and data rows into string-keyed records (contract: preview step). */
export function parseCsv(fileText: string): ParsedFile {
	const result = Papa.parse<Record<string, string>>(fileText, {
		header: true,
		skipEmptyLines: true
	});
	const headers = result.meta.fields ?? [];
	return { headers, rows: result.data };
}

/** Parses the first worksheet of an XLSX file's header row and data rows. */
export async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(buffer);
	const sheet = workbook.worksheets[0];
	if (!sheet) return { headers: [], rows: [] };

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
	return { headers, rows };
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
	const asDate = new Date(iso);
	if (Number.isNaN(asDate.getTime())) return null;
	return iso;
}

function parseAmount(
	row: Record<string, string>,
	mapping: ColumnMapping
): { amountPaise: number } | null {
	if (mapping.amountSignConvention === 'separate-debit-credit-columns') {
		const debitStr = mapping.debitColumn ? row[mapping.debitColumn] : '';
		const creditStr = mapping.creditColumn ? row[mapping.creditColumn] : '';
		const debit = parseFloat(debitStr || '0');
		const credit = parseFloat(creditStr || '0');
		if (Number.isNaN(debit) || Number.isNaN(credit)) return null;
		return { amountPaise: Math.round((credit - debit) * 100) };
	}
	const raw = parseFloat(row[mapping.amountColumn]);
	if (Number.isNaN(raw)) return null;
	return { amountPaise: Math.round(raw * 100) };
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
	mapping: ColumnMapping
): Promise<ImportResult> {
	const result: ImportResult = { createdCount: 0, skippedMalformedRows: [], flaggedDuplicates: [] };

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNumber = i + 2; // header is row 1

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

		const duplicates = await TransactionRepository.findPossibleDuplicates(
			key,
			mapping.accountId,
			amount.amountPaise,
			dateIso
		);
		const notes = mapping.descriptionColumn ? (row[mapping.descriptionColumn] ?? null) : null;
		// Auto-categorization (spec 006, FR-002) needs a resolved Merchant to match rules/
		// suggestions against — file import previously never resolved one at all.
		const resolved = notes?.trim() ? await resolveMerchant(key, notes.trim()) : null;

		await TransactionEngine.recordTransaction(key, {
			accountId: mapping.accountId,
			date: dateIso,
			amount: amount.amountPaise,
			type: amount.amountPaise >= 0 ? 'income' : 'expense',
			notes,
			merchantId: resolved?.merchantId ?? null,
			merchantAliasId: resolved?.aliasId ?? null,
			source: 'file_import',
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
