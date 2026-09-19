import { describe, it, expect } from 'vitest';
import { resolveDashboardLayout, DASHBOARD_WIDGETS } from '../../src/domain/analytics/dashboardLayout';

describe('Dashboard layout resolver', () => {
	it('returns the built-in default when no layout is stored', () => {
		const resolved = resolveDashboardLayout(undefined);
		expect(resolved.map((w) => w.widgetId)).toEqual(DASHBOARD_WIDGETS.map((w) => w.id));
		expect(resolved.every((w) => w.visible)).toBe(true);
	});

	it('treats an empty stored array the same as absent (reset-to-default sentinel)', () => {
		const resolved = resolveDashboardLayout([]);
		expect(resolved).toHaveLength(DASHBOARD_WIDGETS.length);
	});

	it('respects a stored visibility toggle', () => {
		const stored = DASHBOARD_WIDGETS.map((w) => ({
			widgetId: w.id,
			visible: w.id !== 'lending'
		}));
		const resolved = resolveDashboardLayout(stored);
		expect(resolved.find((w) => w.widgetId === 'lending')?.visible).toBe(false);
	});

	it('respects a stored reorder', () => {
		const stored = [
			{ widgetId: 'unreviewed', visible: true },
			{ widgetId: 'total-balance', visible: true },
			{ widgetId: 'lending', visible: true },
			{ widgetId: 'net-worth', visible: true },
			{ widgetId: 'recent-transactions', visible: true }
		];
		const resolved = resolveDashboardLayout(stored);
		expect(resolved[0].widgetId).toBe('unreviewed');
		expect(resolved[1].widgetId).toBe('total-balance');
	});

	it('drops an unrecognized stored widget id', () => {
		const resolved = resolveDashboardLayout([{ widgetId: 'some-removed-widget', visible: true }]);
		expect(resolved.some((w) => w.widgetId === 'some-removed-widget')).toBe(false);
		// Falls through to appending every known widget.
		expect(resolved).toHaveLength(DASHBOARD_WIDGETS.length);
	});

	it('appends a known widget missing from a stale stored layout, defaulting to visible', () => {
		const resolved = resolveDashboardLayout([{ widgetId: 'total-balance', visible: true }]);
		const netWorth = resolved.find((w) => w.widgetId === 'net-worth');
		expect(netWorth).toBeDefined();
		expect(netWorth?.visible).toBe(true);
	});

	it('forces at least one core widget visible even if the stored layout hides all of them', () => {
		const stored = DASHBOARD_WIDGETS.map((w) => ({ widgetId: w.id, visible: false }));
		const resolved = resolveDashboardLayout(stored);
		const coreIds = DASHBOARD_WIDGETS.filter((w) => w.core).map((w) => w.id);
		expect(resolved.some((w) => coreIds.includes(w.widgetId as (typeof coreIds)[number]) && w.visible)).toBe(
			true
		);
	});
});
