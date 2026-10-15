import { describe, it, expect } from 'vitest';
import { HUBS, hubForPath } from '../../src/lib/hubs';

describe('hubForPath', () => {
	it('finds the hub of a screen and marks that screen open', () => {
		const match = hubForPath('/budgets', false)!;
		expect(match.hub.id).toBe('plan');
		expect(match.active.label).toBe('Budgets');
		expect(match.items.map((i) => i.label)).toContain('Forecast');
	});

	it('does not mistake Budget vs. Actual for Budgets', () => {
		expect(hubForPath('/budgets/variance', false)!.active.label).toBe('Budget vs. Actual');
		expect(hubForPath('/liabilities/payoff-planner', false)!.active.label).toBe('Payoff Planner');
		expect(hubForPath('/import/bulk-text', false)!.active.label).toBe('Bulk import');
	});

	it('puts a page below a screen under that screen', () => {
		expect(hubForPath('/transactions/new', false)!.active.label).toBe('Transactions');
		expect(hubForPath('/transactions/transfer', false)!.hub.id).toBe('money');
		expect(hubForPath('/recurring/upcoming', false)!.active.label).toBe('Recurring');
	});

	it('does not match on a shared prefix that is not a path segment', () => {
		expect(hubForPath('/budgetsandmore', false)).toBeNull();
		expect(hubForPath('/accounts-old', false)).toBeNull();
	});

	it('has no hub for the dashboard, Alerts or an unknown page', () => {
		expect(hubForPath('/', false)).toBeNull();
		expect(hubForPath('/alerts', false)).toBeNull();
		expect(hubForPath('/nowhere', false)).toBeNull();
	});

	it('lists the Android-only screen only in the app', () => {
		expect(hubForPath('/security', false)!.items.map((i) => i.to)).not.toContain('/auto-capture');
		expect(hubForPath('/security', true)!.items.map((i) => i.to)).toContain('/auto-capture');
	});

	it('gives every screen to exactly one hub', () => {
		const seen = new Map<string, string>();
		for (const hub of HUBS) {
			for (const item of hub.items) {
				expect(seen.has(item.to), `${item.to} is in two hubs`).toBe(false);
				seen.set(item.to, hub.id);
			}
		}
	});
});
