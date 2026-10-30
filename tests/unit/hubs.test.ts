import { describe, it, expect } from 'vitest';
import { HUBS, hubEntryPath, hubForPath } from '../../src/lib/hubs';
import { HUB_ICONS, SCREEN_ICONS } from '../../src/components/navIcons';

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
		const rules = '/categorization-rules';
		expect(hubForPath(rules, false)!.items.map((i) => i.to)).not.toContain('/auto-capture');
		expect(hubForPath(rules, true)!.items.map((i) => i.to)).toContain('/auto-capture');
	});

	it('groups Import, Export and Backup under Data', () => {
		for (const path of ['/import', '/import/bulk-text', '/export', '/backup']) {
			expect(hubForPath(path, false)!.hub.id, path).toBe('data');
		}
	});

	it('groups Auto-capture, Auto-Categorize and Notifications under Automation', () => {
		for (const path of ['/auto-capture', '/categorization-rules', '/notification-settings']) {
			expect(hubForPath(path, true)!.hub.id, path).toBe('automation');
		}
	});

	it('keeps Categories with the money screens it organises', () => {
		expect(hubForPath('/categories', false)!.hub.id).toBe('money');
	});

	it('folds only the hubs the sidebar shows as one entry', () => {
		expect(HUBS.filter((h) => h.folded).map((h) => h.id)).toEqual([
			'data',
			'automation',
			'settings'
		]);
	});

	it('opens a folded hub on its first screen that exists on this platform', () => {
		const automation = HUBS.find((h) => h.id === 'automation')!;
		expect(hubEntryPath(automation, false)).toBe('/categorization-rules');
		expect(hubEntryPath(automation, true)).toBe('/auto-capture');
		expect(
			hubEntryPath(
				HUBS.find((h) => h.id === 'data')!,
				false
			)
		).toBe('/import');
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

	it('has a sidebar icon for every screen it lists and for every folded hub', () => {
		for (const hub of HUBS) {
			if (hub.folded) {
				expect(HUB_ICONS[hub.id], hub.id).toBeDefined();
				continue;
			}
			for (const item of hub.items) expect(SCREEN_ICONS[item.to], item.to).toBeDefined();
		}
	});
});
