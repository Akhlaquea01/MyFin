export type DashboardWidgetId =
	| 'total-balance'
	| 'month-summary'
	| 'unreviewed'
	| 'spending'
	| 'trend'
	| 'budgets'
	| 'net-worth'
	| 'lending'
	| 'recent-transactions';

export interface DashboardWidgetConfig {
	widgetId: string;
	visible: boolean;
}

export interface DashboardWidgetMeta {
	id: DashboardWidgetId;
	title: string;
	/** A core widget can never be hidden (FR-024) — enforced by the resolver below, not just
	 *  the settings UI, so a corrupted/hand-edited layout can never blank the page. */
	core: boolean;
}

/** The built-in order. Charts come before the figures that are only a number. */
export const DASHBOARD_WIDGETS: DashboardWidgetMeta[] = [
	{ id: 'total-balance', title: 'Total Balance', core: true },
	{ id: 'month-summary', title: 'This month', core: false },
	{ id: 'unreviewed', title: 'Unreviewed', core: false },
	{ id: 'spending', title: 'Where it went', core: false },
	{ id: 'trend', title: 'Last 6 months', core: false },
	{ id: 'budgets', title: 'Budgets', core: false },
	{ id: 'net-worth', title: 'Net Worth', core: false },
	{ id: 'lending', title: 'Lending', core: false },
	{ id: 'recent-transactions', title: 'Recent Transactions', core: false }
];

const KNOWN_IDS = new Set<string>(DASHBOARD_WIDGETS.map((w) => w.id));
const CORE_IDS = new Set<string>(DASHBOARD_WIDGETS.filter((w) => w.core).map((w) => w.id));

function defaultLayout(): DashboardWidgetConfig[] {
	return DASHBOARD_WIDGETS.map((w) => ({ widgetId: w.id, visible: true }));
}

/**
 * Resolves a persisted `UserProfile.dashboardLayout` into a concrete, always-safe render order
 * (User Story 6, spec 019, FR-022–FR-025, contracts/dashboard-widgets.md). Pure — no I/O.
 *
 * - Absent/empty stored layout -> the built-in default (every widget, all visible, in the built-in order). An empty array is also treated as "use defaults" so "reset to
 *   default" (DashboardCustomizeSheet) can write `[]` without needing a separate sentinel.
 * - Any stored widget id no longer recognized is dropped (forward-compatible against a future
 *   widget removal).
 * - Any known widget id missing from the stored layout (e.g. a newly-added widget type) is
 *   appended at the end, defaulting to visible, so a saved layout never silently loses a widget.
 * - At least one core widget is always forced visible, regardless of what was stored.
 */
export function resolveDashboardLayout(
	stored: DashboardWidgetConfig[] | undefined
): DashboardWidgetConfig[] {
	if (!stored || stored.length === 0) return defaultLayout();

	const seen = new Set<string>();
	const result: DashboardWidgetConfig[] = [];
	for (const entry of stored) {
		if (!KNOWN_IDS.has(entry.widgetId) || seen.has(entry.widgetId)) continue;
		seen.add(entry.widgetId);
		result.push({ widgetId: entry.widgetId, visible: entry.visible });
	}
	for (const widget of DASHBOARD_WIDGETS) {
		if (!seen.has(widget.id)) result.push({ widgetId: widget.id, visible: true });
	}

	const anyCoreVisible = result.some((e) => CORE_IDS.has(e.widgetId) && e.visible);
	if (!anyCoreVisible) {
		const idx = result.findIndex((e) => CORE_IDS.has(e.widgetId));
		if (idx >= 0) result[idx] = { ...result[idx], visible: true };
	}

	return result;
}
