import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import {
	SavingsGoalRepository,
	GoalContributionRepository
} from '../../src/data/dexie/savingsGoalRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('SavingsGoalRepository + GoalContributionRepository against Dexie', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8888', randomSaltBase64());
	});

	it('creates, updates, and lists goals', async () => {
		const goal = await SavingsGoalRepository.create(key, {
			name: 'Emergency Fund',
			targetAmount: 1000000,
			targetDate: null
		});
		expect((await SavingsGoalRepository.list(key)).map((g) => g.id)).toContain(goal.id);

		const updated = await SavingsGoalRepository.update(key, goal.id, { targetAmount: 1200000 });
		expect(updated.targetAmount).toBe(1200000);
	});

	it('soft-deletes and restores a goal, excluding/including it from list()', async () => {
		const goal = await SavingsGoalRepository.create(key, {
			name: 'Vacation',
			targetAmount: 500000,
			targetDate: null
		});
		await SavingsGoalRepository.softDelete(key, goal.id);
		expect((await SavingsGoalRepository.list(key)).map((g) => g.id)).not.toContain(goal.id);

		await SavingsGoalRepository.restore(key, goal.id);
		expect((await SavingsGoalRepository.list(key)).map((g) => g.id)).toContain(goal.id);
	});

	it('logs, lists, and removes contributions for a goal', async () => {
		const goal = await SavingsGoalRepository.create(key, {
			name: 'New Laptop',
			targetAmount: 800000,
			targetDate: null
		});
		const contribution = await GoalContributionRepository.create(key, {
			goalId: goal.id,
			amount: 50000,
			date: '2026-01-01'
		});
		expect((await GoalContributionRepository.listForGoal(key, goal.id)).map((c) => c.id)).toEqual([
			contribution.id
		]);

		await GoalContributionRepository.remove(key, contribution.id);
		expect(await GoalContributionRepository.listForGoal(key, goal.id)).toEqual([]);
	});

	it('rejects a future-dated contribution (FR-009)', async () => {
		const goal = await SavingsGoalRepository.create(key, {
			name: 'New Laptop',
			targetAmount: 800000,
			targetDate: null
		});
		const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		await expect(
			GoalContributionRepository.create(key, { goalId: goal.id, amount: 1000, date: tomorrow })
		).rejects.toThrow();
	});

	it('rejects a zero-amount contribution', async () => {
		const goal = await SavingsGoalRepository.create(key, {
			name: 'New Laptop',
			targetAmount: 800000,
			targetDate: null
		});
		await expect(
			GoalContributionRepository.create(key, { goalId: goal.id, amount: 0, date: '2026-01-01' })
		).rejects.toThrow();
	});

	it("keeps a restored goal's prior contributions immediately visible again (research.md §4)", async () => {
		const goal = await SavingsGoalRepository.create(key, {
			name: 'New Laptop',
			targetAmount: 800000,
			targetDate: null
		});
		await GoalContributionRepository.create(key, {
			goalId: goal.id,
			amount: 50000,
			date: '2026-01-01'
		});

		await SavingsGoalRepository.softDelete(key, goal.id);
		await SavingsGoalRepository.restore(key, goal.id);

		const contributions = await GoalContributionRepository.listForGoal(key, goal.id);
		expect(contributions).toHaveLength(1);
		expect(contributions[0].amount).toBe(50000);
	});
});
