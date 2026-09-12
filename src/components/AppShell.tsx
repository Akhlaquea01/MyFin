import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
	ArrowLeftRight,
	BarChart3,
	Bell,
	CalendarClock,
	CreditCard,
	DatabaseBackup,
	Download,
	HeartPulse,
	Inbox,
	Landmark,
	LayoutDashboard,
	LineChart,
	Menu,
	PiggyBank,
	Sparkles,
	Tags,
	Target,
	Trash2,
	TrendingUp,
	Upload,
	Users,
	Wallet,
	Wand2
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';

const NAV_ITEMS = [
	{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
	{ to: '/accounts', label: 'Accounts', icon: Wallet, dataTour: 'accounts-nav' },
	{ to: '/transactions', label: 'Transactions', icon: ArrowLeftRight, dataTour: 'transactions-nav' },
	{ to: '/quick-add', label: 'Quick Add', icon: Sparkles },
	{ to: '/review', label: 'Review', icon: Inbox },
	{ to: '/budgets', label: 'Budgets', icon: PiggyBank, dataTour: 'budgets-nav' },
	{ to: '/savings-goals', label: 'Savings Goals', icon: Target },
	{ to: '/people', label: 'People', icon: Users },
	{ to: '/recurring', label: 'Recurring', icon: CalendarClock },
	{ to: '/investments', label: 'Investments', icon: LineChart },
	{ to: '/liabilities', label: 'Liabilities', icon: CreditCard },
	{ to: '/liabilities/payoff-planner', label: 'Payoff Planner', icon: Landmark },
	{ to: '/net-worth', label: 'Net Worth', icon: TrendingUp },
	{ to: '/financial-health', label: 'Financial Health', icon: HeartPulse },
	{ to: '/analytics', label: 'Analytics', icon: BarChart3 },
	{ to: '/import', label: 'Import', icon: Upload },
	{ to: '/export', label: 'Export', icon: Download },
	{ to: '/backup', label: 'Backup', icon: DatabaseBackup, dataTour: 'settings-nav' },
	{ to: '/notification-settings', label: 'Notifications', icon: Bell },
	{ to: '/categorization-rules', label: 'Auto-Categorize', icon: Wand2 },
	{ to: '/categories', label: 'Categories', icon: Tags, dataTour: 'categories-nav' },
	{ to: '/trash', label: 'Trash', icon: Trash2 }
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
	return (
		<nav className="flex flex-col gap-1">
			{NAV_ITEMS.map(({ to, label, icon: Icon, end, dataTour }) => (
				<NavLink
					key={to}
					to={to}
					end={end}
					onClick={onNavigate}
					data-tour={dataTour}
					className={({ isActive }) =>
						cn(
							'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
							isActive
								? 'bg-primary/10 text-primary'
								: 'text-muted-foreground hover:bg-muted hover:text-foreground'
						)
					}
				>
					<Icon className="size-4" />
					{label}
				</NavLink>
			))}
		</nav>
	);
}

export function AppShell() {
	const [mobileOpen, setMobileOpen] = useState(false);

	return (
		<div className="flex min-h-dvh">
			<aside className="hidden w-56 shrink-0 border-r bg-card/50 p-4 md:flex md:flex-col">
				<div className="mb-6 flex items-center gap-2 px-2">
					<Wallet className="size-5 text-primary" />
					<span className="font-semibold">MyFin</span>
				</div>
				<NavLinks />
			</aside>

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex items-center gap-2 border-b p-3 md:hidden">
					<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
						<SheetTrigger asChild>
							<Button variant="ghost" size="icon" aria-label="Open navigation menu">
								<Menu />
							</Button>
						</SheetTrigger>
						<SheetContent side="left" className="w-56 p-4">
							<div className="mb-6 flex items-center gap-2 px-2">
								<Wallet className="size-5 text-primary" />
								<span className="font-semibold">MyFin</span>
							</div>
							<NavLinks onNavigate={() => setMobileOpen(false)} />
						</SheetContent>
					</Sheet>
					<span className="font-semibold">MyFin</span>
				</header>

				<main className="min-w-0 flex-1">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
