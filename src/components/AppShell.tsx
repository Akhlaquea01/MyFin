import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
	ArrowLeftRight,
	BarChart3,
	Bell,
	BellRing,
	CalendarClock,
	CreditCard,
	DatabaseBackup,
	Download,
	HeartPulse,
	Inbox,
	Info,
	ShieldCheck,
	Smartphone,
	Landmark,
	LayoutDashboard,
	LineChart,
	Menu,
	MoreHorizontal,
	Plus,
	PiggyBank,
	Repeat,
	Sparkles,
	TrendingDown,
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from './ui/dropdown-menu';
import { PageErrorBoundary } from './PageErrorBoundary';
import { CommandPalette } from './CommandPalette';
import { useQuickTour } from '../hooks/useQuickTour';
import { useUnreadAlerts } from '../hooks/useUnreadAlerts';
import { useWaitingReview } from '../hooks/useWaitingReview';
import { useSession } from '../context/SessionContext';
import { isNativeApp } from '../lib/native/platform';
import { TransactionRepository } from '../data/dexie/transactionRepository';
import { MerchantRepository } from '../data/dexie/merchantRepository';
import { AccountRepository } from '../data/dexie/accountRepository';
import { buildSearchIndex, type SearchIndexEntry } from '../domain/search/searchIndex';

/** Bounds the command palette's index build to recent history rather than the full ledger —
 *  same "narrow, don't decrypt everything" discipline as `getDashboardSummary` (spec 019,
 *  contracts/command-palette-search.md). */
const SEARCH_INDEX_TRANSACTION_LIMIT = 500;

/** Tailwind's `md` breakpoint (768px) — the point at which the sidebar replaces this sheet. */
const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

interface NavItem {
	to: string;
	label: string;
	icon: typeof LayoutDashboard;
	end?: boolean;
	dataTour?: string;
	nativeOnly?: boolean;
}

// Grouped so a menu of this length can be scanned: the everyday screens first, the rarely-opened
// settings last.
const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
	{
		label: null,
		items: [
			{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
			{ to: '/accounts', label: 'Accounts', icon: Wallet, dataTour: 'accounts-nav' },
			{
				to: '/transactions',
				label: 'Transactions',
				icon: ArrowLeftRight,
				dataTour: 'transactions-nav'
			},
			{ to: '/quick-add', label: 'Quick Add', icon: Sparkles },
			{ to: '/review', label: 'Review', icon: Inbox },
			{ to: '/alerts', label: 'Alerts', icon: BellRing }
		]
	},
	{
		label: 'Planning',
		items: [
			{ to: '/budgets', label: 'Budgets', icon: PiggyBank, dataTour: 'budgets-nav' },
			{ to: '/budgets/variance', label: 'Budget vs. Actual', icon: BarChart3 },
			{ to: '/savings-goals', label: 'Savings Goals', icon: Target },
			{ to: '/recurring', label: 'Recurring', icon: CalendarClock },
			{ to: '/subscriptions', label: 'Subscriptions', icon: Repeat },
			{ to: '/forecast', label: 'Forecast', icon: TrendingDown }
		]
	},
	{
		label: 'Wealth',
		items: [
			{ to: '/people', label: 'People', icon: Users },
			{ to: '/investments', label: 'Investments', icon: LineChart },
			{ to: '/liabilities', label: 'Liabilities', icon: CreditCard },
			{ to: '/liabilities/payoff-planner', label: 'Payoff Planner', icon: Landmark },
			{ to: '/net-worth', label: 'Net Worth', icon: TrendingUp }
		]
	},
	{
		label: 'Insights',
		items: [
			{ to: '/financial-health', label: 'Financial Health', icon: HeartPulse },
			{ to: '/analytics', label: 'Analytics', icon: BarChart3 }
		]
	},
	{
		label: 'Data & settings',
		items: [
			{ to: '/import', label: 'Import', icon: Upload },
			{ to: '/export', label: 'Export', icon: Download },
			{ to: '/backup', label: 'Backup', icon: DatabaseBackup, dataTour: 'settings-nav' },
			{ to: '/security', label: 'Security', icon: ShieldCheck },
			// Reading bank SMS and payment notifications only exists in the Android app.
			{ to: '/auto-capture', label: 'Auto-capture', icon: Smartphone, nativeOnly: true },
			{ to: '/notification-settings', label: 'Notifications', icon: Bell },
			{ to: '/categorization-rules', label: 'Auto-Categorize', icon: Wand2 },
			{ to: '/categories', label: 'Categories', icon: Tags, dataTour: 'categories-nav' },
			{ to: '/trash', label: 'Trash', icon: Trash2 },
			{ to: '/about', label: 'About', icon: Info }
		]
	}
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
	const unreadAlerts = useUnreadAlerts();
	return (
		<nav className="flex flex-col gap-1">
			{NAV_GROUPS.map((group, index) => {
				const items = group.items.filter((item) => !item.nativeOnly || isNativeApp());
				if (items.length === 0) return null;
				return (
					<div
						key={group.label ?? 'main'}
						className={cn('flex flex-col gap-1', index > 0 && 'mt-3')}
					>
						{group.label && (
							<p className="px-3 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
								{group.label}
							</p>
						)}
						{items.map(({ to, label, icon: Icon, end, dataTour }) => (
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
								{to === '/alerts' && unreadAlerts > 0 && (
									<span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none font-semibold text-primary-foreground">
										{unreadAlerts}
									</span>
								)}
							</NavLink>
						))}
					</div>
				);
			})}
		</nav>
	);
}

/**
 * The phone's bottom bar: the four places used every day, a button that adds something, and the
 * full menu. Labels are drawn with CSS (`data-label`) rather than text nodes so they cannot be
 * mistaken for page content, and the whole bar is gone from md up, where the sidebar takes over.
 */
function BottomBar({ onOpenMenu }: { onOpenMenu: () => void }) {
	const waiting = useWaitingReview(useLocation().pathname);
	const tab = (isActive: boolean) =>
		cn(
			'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-muted-foreground transition-colors',
			'after:text-[10px] after:leading-none after:font-medium after:content-[attr(data-label)]',
			isActive && 'text-primary'
		);
	return (
		<nav
			aria-label="Primary shortcuts"
			className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
		>
			<NavLink
				to="/"
				end
				aria-label="Home"
				data-label="Home"
				className={({ isActive }) => tab(isActive)}
			>
				<LayoutDashboard className="size-5" />
			</NavLink>
			<NavLink
				to="/transactions"
				end
				aria-label="Activity"
				data-label="Activity"
				className={({ isActive }) => tab(isActive)}
			>
				<ArrowLeftRight className="size-5" />
			</NavLink>
			<div className="flex flex-1 items-center justify-center">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label="Add"
							className="-mt-5 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
						>
							<Plus className="size-6" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="center" side="top" className="w-56">
						<DropdownMenuItem asChild>
							<Link to="/transactions/new">New transaction</Link>
						</DropdownMenuItem>
						<DropdownMenuItem asChild>
							<Link to="/quick-add">Paste a bank message</Link>
						</DropdownMenuItem>
						<DropdownMenuItem asChild>
							<Link to="/transactions/transfer">Move money between accounts</Link>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<NavLink
				to="/review"
				aria-label="Review queue"
				data-label="Review"
				className={({ isActive }) => tab(isActive)}
			>
				<Inbox className="size-5" />
				{waiting > 0 && (
					<span className="absolute top-1 left-1/2 ml-2 min-w-4 rounded-full bg-warning px-1 text-center text-[10px] leading-4 font-semibold text-background">
						{waiting > 99 ? '99+' : waiting}
					</span>
				)}
			</NavLink>
			<button
				type="button"
				aria-label="More"
				data-label="More"
				className={tab(false)}
				onClick={onOpenMenu}
			>
				<MoreHorizontal className="size-5" />
			</button>
		</nav>
	);
}

export function AppShell() {
	const [mobileOpen, setMobileOpen] = useState(false);
	const location = useLocation();
	const unreadAlerts = useUnreadAlerts();
	const { isTourActive } = useQuickTour();
	const { getEncryptionKey } = useSession();
	// True only when this component itself opened the sheet for the tour, so ending the tour
	// doesn't blow away a sheet the user had already opened manually.
	const tourOpenedSheetRef = useRef(false);

	// Every current tour step targets a nav item, which on a narrow viewport lives only inside
	// this sheet (the sidebar's copy is `display:none` there) — without opening it, the tour
	// could never find a visible target and fell back to an unanchored centered card.
	useEffect(() => {
		if (isTourActive) {
			if (!mobileOpen && window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches) {
				tourOpenedSheetRef.current = true;
				setMobileOpen(true);
			}
		} else if (tourOpenedSheetRef.current) {
			tourOpenedSheetRef.current = false;
			setMobileOpen(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isTourActive]);

	// User Story 5 (spec 019): the command palette's index. AppShell only ever mounts inside
	// the authenticated route tree (Gate() renders <LockScreen> instead of these routes while
	// locked, see App.tsx), so this state — and the Ctrl+K listener below — structurally cannot
	// exist while locked, and is discarded automatically the moment AppShell unmounts on lock
	// (FR-021, contracts/command-palette-search.md) — no separate teardown call needed.
	const [searchIndex, setSearchIndex] = useState<SearchIndexEntry[]>([]);
	const [paletteOpen, setPaletteOpen] = useState(false);

	async function refreshSearchIndex() {
		const key = getEncryptionKey();
		const [transactions, merchants, accounts] = await Promise.all([
			TransactionRepository.listRecent(key, SEARCH_INDEX_TRANSACTION_LIMIT),
			MerchantRepository.list(key),
			AccountRepository.list(key)
		]);
		setSearchIndex(buildSearchIndex(transactions, merchants, accounts));
	}

	useEffect(() => {
		void refreshSearchIndex();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Rebuild on every open, not just once at mount — the index is otherwise a stale snapshot
	// of whatever existed at unlock time, missing anything the user added mid-session.
	useEffect(() => {
		if (paletteOpen) void refreshSearchIndex();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [paletteOpen]);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				setPaletteOpen((open) => !open);
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	return (
		<div className="flex min-h-dvh">
			<CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} index={searchIndex} />
			<aside className="hidden w-56 shrink-0 overflow-y-auto border-r bg-card/50 p-4 md:sticky md:top-0 md:flex md:h-dvh md:max-h-dvh md:flex-col">
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
						<SheetContent side="left" className="w-56 overflow-y-auto p-4">
							<div className="mb-6 flex items-center gap-2 px-2">
								<Wallet className="size-5 text-primary" />
								<span className="font-semibold">MyFin</span>
							</div>
							<NavLinks onNavigate={() => setMobileOpen(false)} />
						</SheetContent>
					</Sheet>
					<span className="font-semibold">MyFin</span>
					<Link
						to="/alerts"
						aria-label="Open alerts"
						className="relative ml-auto inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
					>
						<BellRing className="size-5" />
						{unreadAlerts > 0 && (
							<span className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground">
								{unreadAlerts}
							</span>
						)}
					</Link>
				</header>

				<main className="min-w-0 flex-1 pb-20 md:pb-0">
					{/* Keyed by pathname so navigating away from a crashed page fully remounts the
					    boundary — a stale failure never lingers after the user moves on. */}
					<PageErrorBoundary key={location.pathname}>
						<Outlet />
					</PageErrorBoundary>
				</main>
			</div>
			<BottomBar onOpenMenu={() => setMobileOpen(true)} />
		</div>
	);
}
