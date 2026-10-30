import {
	ArrowLeftRight,
	BarChart3,
	CalendarClock,
	CreditCard,
	Database,
	HeartPulse,
	Inbox,
	Landmark,
	LineChart,
	PiggyBank,
	Settings,
	Sparkles,
	Tags,
	Target,
	TrendingDown,
	TrendingUp,
	Users,
	Wallet,
	Wand2,
	type LucideIcon
} from 'lucide-react';

/** Sidebar icon per screen of an unfolded hub; the hubs test fails if one is missing. */
export const SCREEN_ICONS: Record<string, LucideIcon> = {
	'/accounts': Wallet,
	'/transactions': ArrowLeftRight,
	'/categories': Tags,
	'/quick-add': Sparkles,
	'/review': Inbox,
	'/budgets': PiggyBank,
	'/budgets/variance': BarChart3,
	'/savings-goals': Target,
	'/recurring': CalendarClock,
	'/forecast': TrendingDown,
	'/net-worth': TrendingUp,
	'/investments': LineChart,
	'/liabilities': CreditCard,
	'/liabilities/payoff-planner': Landmark,
	'/people': Users,
	'/analytics': BarChart3,
	'/financial-health': HeartPulse
};

/** Sidebar icon per folded hub. */
export const HUB_ICONS: Record<string, LucideIcon> = {
	data: Database,
	automation: Wand2,
	settings: Settings
};
