import { db, type BudgetRow, type BudgetItemRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import type { Budget, BudgetItem, BudgetPeriodType } from '../../domain/entities';

export interface NewBudget {
	categoryId: string;
	periodType: BudgetPeriodType;
	amount: number;
	rolloverEnabled: boolean;
	isSinkingFund: boolean;
}

export const BudgetRepository = {
	async create(key: CryptoKey, input: NewBudget): Promise<Budget> {
		const now = Date.now();
		const budget: Budget = {
			id: crypto.randomUUID(),
			categoryId: input.categoryId,
			periodType: input.periodType,
			amount: input.amount,
			rolloverEnabled: input.rolloverEnabled,
			isSinkingFund: input.isSinkingFund,
			createdAt: now,
			updatedAt: now
		};
		await putEncrypted(db.budgets, key, budget, { categoryId: budget.categoryId });
		return budget;
	},

	async update(key: CryptoKey, id: string, changes: Partial<Budget>): Promise<Budget> {
		const existing = await getDecrypted<BudgetRow, Budget>(db.budgets, key, id);
		if (!existing) throw new Error(`Budget ${id} not found`);
		const updated: Budget = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.budgets, key, updated, { categoryId: updated.categoryId });
		return updated;
	},

	async getById(key: CryptoKey, id: string): Promise<Budget | null> {
		return (await getDecrypted<BudgetRow, Budget>(db.budgets, key, id)) ?? null;
	},

	async list(key: CryptoKey): Promise<Budget[]> {
		const rows = await db.budgets.toArray();
		return decryptRows<BudgetRow, Budget>(key, rows);
	}
};

export const BudgetItemRepository = {
	async findForPeriod(
		key: CryptoKey,
		budgetId: string,
		periodStart: string
	): Promise<BudgetItem | null> {
		const rows = await db.budgetItems.where('budgetId').equals(budgetId).toArray();
		const items = await decryptRows<BudgetItemRow, BudgetItem>(key, rows);
		return items.find((item) => item.periodStart === periodStart) ?? null;
	},

	async create(
		key: CryptoKey,
		input: Omit<BudgetItem, 'id' | 'createdAt' | 'updatedAt'>
	): Promise<BudgetItem> {
		const now = Date.now();
		const item: BudgetItem = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...input };
		await putEncrypted(db.budgetItems, key, item, {
			budgetId: item.budgetId,
			periodStart: item.periodStart,
			periodEnd: item.periodEnd
		});
		return item;
	},

	async update(key: CryptoKey, id: string, changes: Partial<BudgetItem>): Promise<BudgetItem> {
		const existing = await getDecrypted<BudgetItemRow, BudgetItem>(db.budgetItems, key, id);
		if (!existing) throw new Error(`BudgetItem ${id} not found`);
		const updated: BudgetItem = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.budgetItems, key, updated, {
			budgetId: updated.budgetId,
			periodStart: updated.periodStart,
			periodEnd: updated.periodEnd
		});
		return updated;
	},

	async listForBudget(key: CryptoKey, budgetId: string): Promise<BudgetItem[]> {
		const rows = await db.budgetItems.where('budgetId').equals(budgetId).toArray();
		const items = await decryptRows<BudgetItemRow, BudgetItem>(key, rows);
		return items.sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
	}
};
