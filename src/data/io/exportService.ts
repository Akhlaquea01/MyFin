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

	const rows: ExportRow[] = [];
	for (const tx of transactions) {
		const splits = await TransactionRepository.getSplits(key, tx.id);
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

export function exportToCsvBlob(rows: ExportRow[]): Blob {
	const csv = Papa.unparse(rows);
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
	sheet.addRows(rows);
	const buffer = await workbook.xlsx.writeBuffer();
	return new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
}
