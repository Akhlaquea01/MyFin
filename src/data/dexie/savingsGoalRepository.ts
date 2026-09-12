import { db, type SavingsGoalRow, type GoalContributionRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import { deletedAtIndex, NOT_DELETED } from './indexable';
import type { SavingsGoal, GoalContribution } from '../../domain/entities';

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
			updatedAt: now,
			deletedAt: null
		};
		await putEncrypted(db.savingsGoals, key, goal, { deletedAt: NOT_DELETED });
		return goal;
	},

	async update(key: CryptoKey, id: string, changes: Partial<SavingsGoal>): Promise<SavingsGoal> {
		const existing = await getDecrypted<SavingsGoalRow, SavingsGoal>(db.savingsGoals, key, id);
		if (!existing) throw new Error(`SavingsGoal ${id} not found`);
		const updated: SavingsGoal = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.savingsGoals, key, updated, {
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
		return updated;
	},

	async softDelete(key: CryptoKey, id: string): Promise<void> {
		await this.update(key, id, { deletedAt: Date.now() });
	},

	async restore(key: CryptoKey, id: string): Promise<void> {
		await this.update(key, id, { deletedAt: null });
	},

	async list(key: CryptoKey): Promise<SavingsGoal[]> {
		const rows = await db.savingsGoals.filter((row) => row.deletedAt === NOT_DELETED).toArray();
		return decryptRows<SavingsGoalRow, SavingsGoal>(key, rows);
	}
};

export const GoalContributionRepository = {
	async create(
		key: CryptoKey,
		input: { goalId: string; amount: number; date: string }
	): Promise<GoalContribution> {
		if (input.amount === 0) {
			throw new Error('Contribution amount must be non-zero');
		}
		const today = new Date().toISOString().slice(0, 10);
		if (input.date > today) {
			throw new Error('Contribution date cannot be in the future');
		}
		const now = Date.now();
		const contribution: GoalContribution = {
			id: crypto.randomUUID(),
			goalId: input.goalId,
			amount: input.amount,
			date: input.date,
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

