import { describe, it, expect } from 'vitest';
import {
	findDueRecurringEvents,
	findCrossedBudgetThresholds
} from '../../src/domain/notifications/notificationEngine';

const asOfDate = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01

describe('findDueRecurringEvents', () => {
	it('includes a pending event due today', () => {
		const candidates = findDueRecurringEvents(
			[{ id: 'e1', expectedDate: '2026-06-01', status: 'pending', categoryName: 'Rent' }],
			1,
			asOfDate
		);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({ kind: 'recurring', key: 'recurring:e1' });
	});

	it('includes a pending event due within the lead time window', () => {
		const candidates = findDueRecurringEvents(
			[{ id: 'e1', expectedDate: '2026-06-03', status: 'pending', categoryName: 'Rent' }],
			3,
			asOfDate
		);
		expect(candidates).toHaveLength(1);
	});

	it('excludes a pending event due beyond the lead time window', () => {
		const candidates = findDueRecurringEvents(
			[{ id: 'e1', expectedDate: '2026-06-05', status: 'pending', categoryName: 'Rent' }],
			3,
			asOfDate
		);
		expect(candidates).toHaveLength(0);
	});

	it('excludes matched and missed events regardless of date', () => {
		const candidates = findDueRecurringEvents(
			[
				{ id: 'e1', expectedDate: '2026-06-01', status: 'matched', categoryName: 'Rent' },
				{ id: 'e2', expectedDate: '2026-06-01', status: 'missed', categoryName: 'Rent' }
			],
			5,
			asOfDate
		);
		expect(candidates).toHaveLength(0);
	});

	it('produces a title/body referencing the category and due date', () => {
		const [candidate] = findDueRecurringEvents(
			[{ id: 'e1', expectedDate: '2026-06-02', status: 'pending', categoryName: 'Rent' }],
			1,
			asOfDate
		);
		expect(candidate.title).toContain('Rent');
		expect(candidate.body).toContain('2026-06-02');
	});
});

describe('findCrossedBudgetThresholds', () => {
	it('includes a budget at or above the threshold', () => {
		const candidates = findCrossedBudgetThresholds(
			[
				{
					budgetId: 'b1',
					periodStart: '2026-06-01',
					plannedAmount: 10000,
					actualAmount: 8200,
					categoryName: 'Dining'
				}
			],
			80
		);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			kind: 'budget',
			key: 'budget:b1:2026-06-01:80'
		});
		expect(candidates[0].body).toContain('82%');
	});

	it('excludes a budget below the threshold', () => {
		const candidates = findCrossedBudgetThresholds(
			[
				{
					budgetId: 'b1',
					periodStart: '2026-06-01',
					plannedAmount: 10000,
					actualAmount: 7999,
					categoryName: 'Dining'
				}
			],
			80
		);
		expect(candidates).toHaveLength(0);
	});

	it('excludes a budget with a zero planned amount regardless of actual spend', () => {
		const candidates = findCrossedBudgetThresholds(
			[
				{
					budgetId: 'b1',
					periodStart: '2026-06-01',
					plannedAmount: 0,
					actualAmount: 5000,
					categoryName: 'Dining'
				}
			],
			80
		);
		expect(candidates).toHaveLength(0);
	});
});
