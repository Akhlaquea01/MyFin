import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
	ArrowLeftRight,
	BarChart3,
	CalendarClock,
	CreditCard,
	DatabaseBackup,
	Download,
	Inbox,
	LayoutDashboard,
	LineChart,
	Menu,
	PiggyBank,
	Sparkles,
	Tags,
	Trash2,
	TrendingUp,
	Upload,
	Wallet
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';

const NAV_ITEMS = [
	{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
	{ to: '/accounts', label: 'Accounts', icon: Wallet },
	{ to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
	{ to: '/quick-add', label: 'Quick Add', icon: Sparkles },
	{ to: '/review', label: 'Review', icon: Inbox },
	{ to: '/budgets', label: 'Budgets', icon: PiggyBank },
	{ to: '/recurring', label: 'Recurring', icon: CalendarClock },
	{ to: '/investments', label: 'Investments', icon: LineChart },
	{ to: '/liabilities', label: 'Liabilities', icon: CreditCard },
	{ to: '/net-worth', label: 'Net Worth', icon: TrendingUp },
	{ to: '/analytics', label: 'Analytics', icon: BarChart3 },
	{ to: '/import', label: 'Import', icon: Upload },
	{ to: '/export', label: 'Export', icon: Download },
	{ to: '/backup', label: 'Backup', icon: DatabaseBackup },
	{ to: '/categories', label: 'Categories', icon: Tags },
	{ to: '/trash', label: 'Trash', icon: Trash2 }
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
	return (
		<nav className="flex flex-col gap-1">
			{NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
				<NavLink
					key={to}
					to={to}
					end={end}
					onClick={onNavigate}
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
