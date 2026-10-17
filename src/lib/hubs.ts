// The screens of the app grouped by what they are for. The phone shows a strip of the active hub's
// screens above each page, so moving between related screens (Budgets, Budget vs. Actual, Goals…)
// does not mean reopening the menu. Purely navigation: every screen keeps its own address.

export interface HubItem {
	to: string;
	label: string;
	/** Only exists in the Android app. */
	nativeOnly?: boolean;
}

export interface Hub {
	id: string;
	label: string;
	/**
	 * The sidebar lists the hub as one entry (opening its first screen) instead of one entry per
	 * screen, and the strip of its screens is drawn at every screen size, not just on a phone.
	 */
	folded?: boolean;
	items: HubItem[];
}

export const HUBS: Hub[] = [
	{
		id: 'money',
		label: 'Money',
		items: [
			{ to: '/accounts', label: 'Accounts' },
			{ to: '/transactions', label: 'Transactions' },
			{ to: '/categories', label: 'Categories' },
			{ to: '/quick-add', label: 'Quick Add' },
			{ to: '/review', label: 'Review' }
		]
	},
	{
		id: 'plan',
		label: 'Plan',
		items: [
			{ to: '/budgets', label: 'Budgets' },
			{ to: '/budgets/variance', label: 'Budget vs. Actual' },
			{ to: '/savings-goals', label: 'Goals' },
			{ to: '/recurring', label: 'Recurring' },
			{ to: '/forecast', label: 'Forecast' }
		]
	},
	{
		id: 'wealth',
		label: 'Wealth',
		items: [
			{ to: '/net-worth', label: 'Net Worth' },
			{ to: '/investments', label: 'Investments' },
			{ to: '/liabilities', label: 'Liabilities' },
			{ to: '/liabilities/payoff-planner', label: 'Payoff Planner' },
			{ to: '/people', label: 'People' }
		]
	},
	{
		id: 'insights',
		label: 'Insights',
		items: [
			{ to: '/analytics', label: 'Analytics' },
			{ to: '/financial-health', label: 'Financial Health' }
		]
	},
	{
		id: 'data',
		label: 'Data',
		folded: true,
		items: [
			{ to: '/import', label: 'Import' },
			{ to: '/import/bulk-text', label: 'Bulk import' },
			{ to: '/export', label: 'Export' },
			{ to: '/backup', label: 'Backup' }
		]
	},
	{
		id: 'automation',
		label: 'Automation',
		folded: true,
		items: [
			{ to: '/auto-capture', label: 'Auto-capture', nativeOnly: true },
			{ to: '/categorization-rules', label: 'Auto-Categorize' },
			{ to: '/notification-settings', label: 'Notifications' }
		]
	},
	{
		id: 'settings',
		label: 'Settings',
		folded: true,
		items: [
			{ to: '/security', label: 'Security' },
			{ to: '/about', label: 'About' }
		]
	}
];

/** The screen a folded hub's sidebar entry opens: its first one that exists on this platform. */
export function hubEntryPath(hub: Hub, isNative: boolean): string {
	return (hub.items.find((i) => !i.nativeOnly || isNative) ?? hub.items[0]).to;
}

export interface HubMatch {
	hub: Hub;
	/** The hub's screens as they should be listed (Android-only ones left out on the web). */
	items: HubItem[];
	/** The screen `pathname` belongs to. */
	active: HubItem;
}

/**
 * The hub a page belongs to and which of its screens is open, or null for a page outside every
 * hub (the dashboard, Alerts). A page below a screen's address belongs to it too: the New
 * transaction form to Transactions, Upcoming to Recurring. The most specific address wins, so
 * Budget vs. Actual is not mistaken for Budgets.
 */
export function hubForPath(pathname: string, isNative: boolean): HubMatch | null {
	let best: { hub: Hub; item: HubItem } | null = null;
	for (const hub of HUBS) {
		for (const item of hub.items) {
			const inside = pathname === item.to || pathname.startsWith(`${item.to}/`);
			if (inside && (!best || item.to.length > best.item.to.length)) best = { hub, item };
		}
	}
	if (!best) return null;
	return {
		hub: best.hub,
		items: best.hub.items.filter((i) => !i.nativeOnly || isNative),
		active: best.item
	};
}
