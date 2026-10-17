import { db, type SavingsGoalRow, type GoalContributionRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import type { SavingsGoal, GoalContribution } from '../../domain/entities';
import { todayLocalISO } from '../../domain/shared/dateMath';

export const SavingsGoalRepository = {
	async create(
		key: CryptoKey,
		input: { name: string; targetAmount: number; targetDate: string | null }
	): Promise<SavingsGoal> {
		const now = Date.now();
		const goal: SavingsGoal = {
			id: crypto.randomUUID(),
			name: input.name,
			targetAmount: input.targetAmount,
			targetDate: input.targetDate,
			createdAt: now,
			updatedAt: now
		};
		await putEncrypted(db.savingsGoals, key, goal, {});
		return goal;
	},

	async update(key: CryptoKey, id: string, changes: Partial<SavingsGoal>): Promise<SavingsGoal> {
		const existing = await getDecrypted<SavingsGoalRow, SavingsGoal>(db.savingsGoals, key, id);
		if (!existing) throw new Error(`SavingsGoal ${id} not found`);
		const updated: SavingsGoal = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.savingsGoals, key, updated, {});
		return updated;
	},

	/** Deletes the goal along with its contributions. */
	async remove(id: string): Promise<void> {
		await db.transaction('rw', db.savingsGoals, db.goalContributions, async () => {
			await db.goalContributions.where('goalId').equals(id).delete();
			await db.savingsGoals.delete(id);
		});
	},

	async list(key: CryptoKey): Promise<SavingsGoal[]> {
		const rows = await db.savingsGoals.toArray();
		return decryptRows<SavingsGoalRow, SavingsGoal>(key, rows);
	}
};

export const GoalContributionRepository = {
	async create(
		key: CryptoKey,
		input: { goalId: string; amount: number; date: string; transactionId?: string | null }
	): Promise<GoalContribution> {
		if (input.amount === 0) {
			throw new Error('Contribution amount must be non-zero');
		}
		const today = todayLocalISO();
		if (input.date > today) {
			throw new Error('Contribution date cannot be in the future');
		}
		const now = Date.now();
		const contribution: GoalContribution = {
			id: crypto.randomUUID(),
			goalId: input.goalId,
			amount: input.amount,
			date: input.date,
			// Written only when set, so a contribution logged on the goal keeps the shape it always had.
			...(input.transactionId ? { transactionId: input.transactionId } : {}),
			createdAt: now,
			updatedAt: now
		};
		await putEncrypted(db.goalContributions, key, contribution, {
			goalId: contribution.goalId,
			date: contribution.date
		});
		return contribution;
	},

	// `_key` is unused (a direct removal needs no decryption) but kept for signature
	// symmetry with the rest of this repository's methods.
	async remove(_key: CryptoKey, id: string): Promise<void> {
		await db.goalContributions.delete(id);
	},

	async listForGoal(key: CryptoKey, goalId: string): Promise<GoalContribution[]> {
		const rows = await db.goalContributions.where('goalId').equals(goalId).toArray();
		return decryptRows<GoalContributionRow, GoalContribution>(key, rows);
	},

	async list(key: CryptoKey): Promise<GoalContribution[]> {
		const rows = await db.goalContributions.toArray();
		return decryptRows<GoalContributionRow, GoalContribution>(key, rows);
	}
};
