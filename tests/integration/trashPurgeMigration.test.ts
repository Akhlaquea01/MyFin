import Dexie from 'dexie';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';

// The schema as v14 left it (the last version that had a Trash): every table, with its
// `deletedAt` soft-delete index where it had one.
const V14_STORES = {
	accounts: 'id, deletedAt',
	categories: 'id, parentId, deletedAt',
	merchants: 'id, deletedAt',
	merchantAliases: 'id, merchantId, aliasHash',
	tags: 'id, nameHash',
	transactions: 'id, accountId, date, deletedAt, reviewStatus, duplicateOfId, transferPairId',
	transactionSplits: 'id, transactionId, categoryId',
	transactionTags: 'id, transactionId, tagId',
	budgets: 'id, categoryId, deletedAt',
	budgetItems: 'id, budgetId, periodStart, periodEnd',
	recurringRules: 'id, accountId, categoryId, isActive',
	expectedEvents: 'id, recurringRuleId, expectedDate, status',
	investmentHoldings: 'id, deletedAt',
	investmentValuations: 'id, holdingId, date',
	liabilities: 'id, deletedAt',
	netWorthSnapshots: 'id, date',
	backupRecords: 'id, createdAt',
	userProfile: 'id',
	debtPlannerPreferences: 'id',
	savingsGoals: 'id, deletedAt',
	goalContributions: 'id, goalId, date',
	notificationPreferences: 'id',
	notifiedItems: 'id, key',
	attachments: 'id, transactionId',
	categorizationRules: 'id, merchantId, deletedAt',
	merchantCategorySignals: 'id',
	sessionKeys: 'id',
	people: 'id, deletedAt',
	personLoans: 'id, personId, accountId, direction, deletedAt',
	personLoanRepayments: 'id, loanId, accountId, deletedAt',
	savedFilterViews: 'id, createdAt',
	autoBackupSettings: 'id',
	importMappings: 'id',
	notificationInbox: 'id, dedupeKey, createdAt, isRead',
	unreadableCaptures: 'id, receivedAt'
};

const LIVE = 0;
const TRASHED = 1_700_000_000_000;
const blob = { iv: '', ciphertext: '' };

async function keysOf(table: string): Promise<string[]> {
	return ((await db.table(table).toCollection().primaryKeys()) as string[]).sort();
}

describe('schema v15: rows that were in Trash are purged on upgrade', () => {
	beforeEach(async () => {
		db.close();
		await Dexie.delete('myfin');

		const old = new Dexie('myfin');
		old.version(14).stores(V14_STORES);
		const put = (table: string, rows: Record<string, unknown>[]) =>
			old.table(table).bulkPut(rows.map((row) => ({ encryptedData: blob, ...row })));

		await put('accounts', [
			{ id: 'acc-live', deletedAt: LIVE },
			{ id: 'acc-trash', deletedAt: TRASHED }
		]);
		await put('categories', [
			{ id: 'cat-live', parentId: '', deletedAt: LIVE },
			{ id: 'cat-trash', parentId: '', deletedAt: TRASHED }
		]);
		await put('merchants', [{ id: 'mer-live', deletedAt: LIVE }]);
		await put('transactions', [
			{ id: 'tx-live', accountId: 'acc-live', date: '2026-01-01', deletedAt: LIVE },
			{ id: 'tx-trash', accountId: 'acc-live', date: '2026-01-02', deletedAt: TRASHED }
		]);
		await put('transactionSplits', [
			{ id: 'sp-live', transactionId: 'tx-live', categoryId: 'cat-live' },
			{ id: 'sp-trash', transactionId: 'tx-trash', categoryId: 'cat-live' }
		]);
		await old.table('transactionTags').bulkPut([
			{ id: 'tt-live', transactionId: 'tx-live', tagId: 't' },
			{ id: 'tt-trash', transactionId: 'tx-trash', tagId: 't' }
		]);
		await put('attachments', [
			{ id: 'at-live', transactionId: 'tx-live' },
			{ id: 'at-trash', transactionId: 'tx-trash' }
		]);
		await put('investmentHoldings', [
			{ id: 'hold-live', deletedAt: LIVE },
			{ id: 'hold-trash', deletedAt: TRASHED }
		]);
		await put('investmentValuations', [
			{ id: 'val-live', holdingId: 'hold-live', date: '2026-01-01' },
			{ id: 'val-trash', holdingId: 'hold-trash', date: '2026-01-01' }
		]);
		await put('liabilities', [
			{ id: 'liab-live', deletedAt: LIVE },
			{ id: 'liab-trash', deletedAt: TRASHED }
		]);
		await put('savingsGoals', [
			{ id: 'goal-live', deletedAt: LIVE },
			{ id: 'goal-trash', deletedAt: TRASHED }
		]);
		await put('goalContributions', [
			{ id: 'gc-live', goalId: 'goal-live', date: '2026-01-01' },
			{ id: 'gc-trash', goalId: 'goal-trash', date: '2026-01-01' }
		]);
		await put('budgets', [
			{ id: 'bud-live', categoryId: 'cat-live', deletedAt: LIVE },
			{ id: 'bud-trash', categoryId: 'cat-live', deletedAt: TRASHED }
		]);
		await put('budgetItems', [
			{ id: 'bi-live', budgetId: 'bud-live', periodStart: '2026-01-01', periodEnd: '2026-01-31' },
			{ id: 'bi-trash', budgetId: 'bud-trash', periodStart: '2026-01-01', periodEnd: '2026-01-31' }
		]);
		await put('categorizationRules', [
			{ id: 'rule-live', merchantId: 'mer-live', deletedAt: LIVE },
			{ id: 'rule-trash', merchantId: 'mer-live', deletedAt: TRASHED }
		]);
		await put('people', [
			{ id: 'person-live', deletedAt: LIVE },
			{ id: 'person-trash', deletedAt: TRASHED }
		]);
		const loan = (id: string, personId: string, deletedAt: number) => ({
			id,
			personId,
			accountId: 'acc-live',
			direction: 'lent',
			deletedAt
		});
		await put('personLoans', [
			loan('loan-live', 'person-live', LIVE),
			loan('loan-trash', 'person-live', TRASHED),
			loan('loan-of-trashed-person', 'person-trash', LIVE)
		]);
		const repayment = (id: string, loanId: string, deletedAt: number) => ({
			id,
			loanId,
			accountId: 'acc-live',
			deletedAt
		});
		await put('personLoanRepayments', [
			repayment('rep-live', 'loan-live', LIVE),
			repayment('rep-trash', 'loan-live', TRASHED),
			repayment('rep-of-trashed-loan', 'loan-trash', LIVE),
			repayment('rep-of-trashed-person', 'loan-of-trashed-person', LIVE)
		]);
		old.close();

		await db.open();
	});

	it('keeps live rows and removes trashed ones together with what hung off them', async () => {
		expect(await keysOf('accounts')).toEqual(['acc-live']);
		expect(await keysOf('categories')).toEqual(['cat-live']);
		expect(await keysOf('merchants')).toEqual(['mer-live']);
		expect(await keysOf('liabilities')).toEqual(['liab-live']);
		expect(await keysOf('categorizationRules')).toEqual(['rule-live']);

		expect(await keysOf('transactions')).toEqual(['tx-live']);
		expect(await keysOf('transactionSplits')).toEqual(['sp-live']);
		expect(await keysOf('transactionTags')).toEqual(['tt-live']);
		expect(await keysOf('attachments')).toEqual(['at-live']);

		expect(await keysOf('investmentHoldings')).toEqual(['hold-live']);
		expect(await keysOf('investmentValuations')).toEqual(['val-live']);
		expect(await keysOf('savingsGoals')).toEqual(['goal-live']);
		expect(await keysOf('goalContributions')).toEqual(['gc-live']);
		expect(await keysOf('budgets')).toEqual(['bud-live']);
		expect(await keysOf('budgetItems')).toEqual(['bi-live']);
	});

	it("removes a trashed person's loans and repayments, and a trashed loan's repayments", async () => {
		expect(await keysOf('people')).toEqual(['person-live']);
		expect(await keysOf('personLoans')).toEqual(['loan-live']);
		expect(await keysOf('personLoanRepayments')).toEqual(['rep-live']);
	});

	it('drops the deletedAt indexes but keeps the others', () => {
		for (const table of db.tables) {
			expect(table.schema.idxByName['deletedAt'], `${table.name} index`).toBeUndefined();
		}
		expect(db.transactions.schema.idxByName['accountId']).toBeDefined();
		expect(db.personLoans.schema.idxByName['personId']).toBeDefined();
	});
});
