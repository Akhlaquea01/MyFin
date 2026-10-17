import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import {
	SavingsGoalRepository,
	GoalContributionRepository
} from '../../src/data/dexie/savingsGoalRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import { addDaysISO, todayLocalISO } from '../../src/domain/shared/dateMath';

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

	it('removes a goal from list()', async () => {
		const goal = await SavingsGoalRepository.create(key, {
			name: 'Vacation',
			targetAmount: 500000,
			targetDate: null
		});
		await SavingsGoalRepository.remove(goal.id);
		expect((await SavingsGoalRepository.list(key)).map((g) => g.id)).not.toContain(goal.id);
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
		// Local calendar, matching the repository's validation: a UTC "tomorrow" equals today's
		// local date for the first hours of the day in zones ahead of UTC.
		const tomorrow = addDaysISO(todayLocalISO(), 1);
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

	it("removes a goal's contributions with it, and leaves other goals' alone", async () => {
		const goal = await SavingsGoalRepository.create(key, {
			name: 'New Laptop',
			targetAmount: 800000,
			targetDate: null
		});
		const other = await SavingsGoalRepository.create(key, {
			name: 'Bike',
			targetAmount: 100000,
			targetDate: null
		});
		for (const goalId of [goal.id, other.id]) {
			await GoalContributionRepository.create(key, { goalId, amount: 50000, date: '2026-01-01' });
		}

		await SavingsGoalRepository.remove(goal.id);

		expect(await GoalContributionRepository.listForGoal(key, goal.id)).toEqual([]);
		expect(await GoalContributionRepository.listForGoal(key, other.id)).toHaveLength(1);
	});
});
