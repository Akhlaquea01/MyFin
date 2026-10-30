import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
	ArrowLeftRight,
	BellRing,
	Inbox,
	LayoutDashboard,
	Menu,
	MoreHorizontal,
	Plus,
	Wallet,
	type LucideIcon
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
import { HubTabs } from './HubTabs';
import { HUBS, hubEntryPath, hubForPath, type Hub, type HubItem } from '../lib/hubs';
import { HUB_ICONS, SCREEN_ICONS } from './navIcons';
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

type NavItem = {
	label: string;
	icon: LucideIcon;
	dataTour?: string;
} &
	// A page outside every hub: the Dashboard and Alerts.
	(
		| { to: string; end?: boolean }
		// One screen of a hub the sidebar lists screen by screen.
		| { screen: HubItem }
		// A folded hub: one entry for several screens, which the strip along the top of each one lists.
		| { hub: Hub }
	);

/** The Quick Tour points at these sidebar entries (see `tourSteps.ts`). */
const TOUR_TARGETS: Record<string, string> = {
	'/accounts': 'accounts-nav',
	'/transactions': 'transactions-nav',
	'/budgets': 'budgets-nav',
	'/categories': 'categories-nav',
	settings: 'settings-nav'
};

// The groups, their names and their screens come from `HUBS`, the same list the strip above each
// page is drawn from, so the menu and the strip cannot disagree about what belongs together.
// Folded hubs (Data, Automation, Settings) take one entry each, under Manage.
const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
	{
		label: null,
		items: [
			{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
			{ to: '/alerts', label: 'Alerts', icon: BellRing }
		]
	},
	...HUBS.filter((hub) => !hub.folded).map((hub) => ({
		label: hub.label,
		items: hub.items.map((screen): NavItem => ({
			screen,
			label: screen.label,
			icon: SCREEN_ICONS[screen.to],
			dataTour: TOUR_TARGETS[screen.to]
		}))
	})),
	{
		label: 'Manage',
		items: HUBS.filter((hub) => hub.folded).map((hub): NavItem => ({
			hub,
			label: hub.label,
			icon: HUB_ICONS[hub.id],
			dataTour: TOUR_TARGETS[hub.id]
		}))
	}
];

const navItemClass = (isActive: boolean) =>
	cn(
		'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
		isActive
			? 'bg-primary/10 text-primary'
			: 'text-muted-foreground hover:bg-muted hover:text-foreground'
	);

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
	const unreadAlerts = useUnreadAlerts();
	const native = isNativeApp();
	const open = hubForPath(useLocation().pathname, native);
	return (
		<nav className="flex flex-col gap-1">
			{NAV_GROUPS.map((group, index) => (
				<div key={group.label ?? 'main'} className={cn('flex flex-col gap-1', index > 0 && 'mt-3')}>
					{group.label && (
						<p className="px-3 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
							{group.label}
						</p>
					)}
					{group.items.map((item) => {
						const { label, icon: Icon, dataTour } = item;
						if ('hub' in item || 'screen' in item) {
							if ('screen' in item && item.screen.nativeOnly && !native) return null;
							// The most specific screen wins, so Budget vs. Actual does not also light up Budgets.
							const [to, isOpen] =
								'hub' in item
									? [hubEntryPath(item.hub, native), open?.hub.id === item.hub.id]
									: [item.screen.to, open?.active.to === item.screen.to];
							return (
								<Link
									key={to}
									to={to}
									onClick={onNavigate}
									data-tour={dataTour}
									aria-current={isOpen ? 'page' : undefined}
									className={navItemClass(isOpen)}
								>
									<Icon className="size-4" />
									{label}
								</Link>
							);
						}
						return (
							<NavLink
								key={item.to}
								to={item.to}
								end={item.end}
								onClick={onNavigate}
								data-tour={dataTour}
								className={({ isActive }) => navItemClass(isActive)}
							>
								<Icon className="size-4" />
								{label}
								{item.to === '/alerts' && unreadAlerts > 0 && (
									<span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none font-semibold text-primary-foreground">
										{unreadAlerts}
									</span>
								)}
							</NavLink>
						);
					})}
				</div>
			))}
		</nav>
	);
}

/** The screens with a tab of their own in the bottom bar, plus Alerts (the bell in the top bar). */
const BAR_SCREENS = ['/transactions', '/review', '/alerts'];

/**
 * The phone's bottom bar: the four places used every day, a button that adds something, and the
 * full menu. Labels are drawn with CSS (`data-label`) rather than text nodes so they cannot be
 * mistaken for page content, and the whole bar is gone from md up, where the sidebar takes over.
 */
function BottomBar({ onOpenMenu }: { onOpenMenu: () => void }) {
	const { pathname } = useLocation();
	const waiting = useWaitingReview(pathname);
	// More stands for every screen the bar has no tab for, so it is lit when one of them is open.
	const onMoreScreen =
		pathname !== '/' && !BAR_SCREENS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
			{/* Tabs replace the entry instead of stacking one: Back from any of them goes Home, then out. */}
			<NavLink
				to="/"
				end
				replace
				aria-label="Home"
				data-label="Home"
				className={({ isActive }) => tab(isActive)}
			>
				<LayoutDashboard className="size-5" />
			</NavLink>
			<NavLink
				to="/transactions"
				replace
				aria-label="Transactions"
				data-label="Transactions"
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
				replace
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
				className={tab(onMoreScreen)}
				onClick={onOpenMenu}
			>
				<MoreHorizontal className="size-5" />
			</button>
		</nav>
	);
}

/** Shown for the instant a page's code is being fetched; the shell around it stays put. */
function PageLoading() {
	return (
		<div role="status" aria-live="polite" className="p-8 text-sm text-muted-foreground">
			Loading…
		</div>
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
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg focus:ring-2 focus:ring-ring"
			>
				Skip to main content
			</a>
			<CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} index={searchIndex} />
			<aside className="hidden w-56 shrink-0 overflow-y-auto border-r bg-card/50 p-4 md:sticky md:top-0 md:flex md:h-dvh md:max-h-dvh md:flex-col">
				<div className="mb-6 flex items-center gap-2 px-2">
					<Wallet className="size-5 text-primary" />
					<span className="font-semibold">MyFin</span>
				</div>
				<NavLinks />
			</aside>

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex items-center gap-2 border-b p-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
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

				<main id="main-content" tabIndex={-1} className="min-w-0 flex-1 pb-20 outline-none md:pb-0">
					<HubTabs />
					{/* Keyed by pathname so navigating away from a crashed page fully remounts the
					    boundary — a stale failure never lingers after the user moves on. */}
					<PageErrorBoundary key={location.pathname}>
						<Suspense fallback={<PageLoading />}>
							<Outlet />
						</Suspense>
					</PageErrorBoundary>
				</main>
			</div>
			<BottomBar onOpenMenu={() => setMobileOpen(true)} />
		</div>
	);
}
