import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
	AlertTriangle,
	ArrowDownLeft,
	ArrowUpRight,
	CheckCircle2,
	Inbox,
	Rocket,
	TrendingUp,
	Wallet
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from 'cn';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { BackupNudgeBanner } from '../components/BackupNudgeBanner';
import { Sparkline } from '../components/Sparkline';
import { BarList } from '../components/charts/BarList';
import { ProgressBar } from '../components/charts/ProgressBar';
import { meterTone } from '../components/charts/meterTone';
import { SegmentedBar } from '../components/charts/SegmentedBar';
import { TrendBars } from '../components/charts/TrendBars';
import { DashboardCustomizeSheet } from '../components/DashboardCustomizeSheet';
import { useSession } from '../context/SessionContext';
import { getDashboardSummary, type DashboardSummary } from '../domain/analytics/dashboardService';
import {
	getDashboardInsights,
	type DashboardInsights
} from '../domain/analytics/dashboardInsights';
import { PersonLoanRepository, LoanRepaymentRepository } from '../data/dexie/personLoanRepository';
import { MerchantRepository } from '../data/dexie/merchantRepository';
import { AccountRepository } from '../data/dexie/accountRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { addStarterCategories } from '../data/io/starterCategories';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import { computePendingBalance, computeOpenLoanTotals } from '../domain/personLoans/loanProgress';
import { formatTransactionLabel } from '../domain/transactions/transactionLabel';
import {
	resolveDashboardLayout,
	type DashboardWidgetConfig,
	type DashboardWidgetId
} from '../domain/analytics/dashboardLayout';
import type { OpenLoanTotals } from '../domain/personLoans/types';
import type { Merchant } from '../domain/entities';
import { formatMoney, formatMoneyCompact } from '../domain/shared/money';

/** Feature 010, User Story 3 (FR-010): "you're owed / you owe" totals across all open loans. */
async function getLendingSummary(key: CryptoKey): Promise<OpenLoanTotals> {
	const loans = await PersonLoanRepository.listAllOpen(key);
	const withBalances = await Promise.all(
		loans.map(async (loan) => {
			const repayments = await LoanRepaymentRepository.listForLoan(key, loan.id);
			return {
				direction: loan.direction,
				pendingBalance: computePendingBalance({
					principalAmount: loan.principalAmount,
					writeOffAmount: loan.writeOffAmount,
					repayments
				})
			};
		})
	);
	return computeOpenLoanTotals({ loans: withBalances });
}

/** Cards that carry a chart or a list take the full row; plain figures sit two to a row. */
const FULL_WIDTH: Record<DashboardWidgetId, boolean> = {
	'total-balance': true,
	'month-summary': true,
	spending: true,
	trend: true,
	budgets: true,
	'recent-transactions': true,
	'net-worth': false,
	lending: false,
	unreviewed: false
};

function monthName(month: string): string {
	return new Date(`${month}-01T00:00:00`).toLocaleString(undefined, { month: 'long' });
}

function CardLink({ to, children }: { to: string; children: ReactNode }) {
	return (
		<Link to={to} className="text-sm text-primary underline-offset-2 hover:underline">
			{children}
		</Link>
	);
}

// User Story 3 (P3): at-a-glance summary reconciled exactly with the ledger (FR-016/017).
// User Story 6 (spec 019, P3): which cards render, and in what order, is config-driven
// (`resolveDashboardLayout`) rather than fixed JSX — see contracts/dashboard-widgets.md.
/** A figure of a crore or more steps down in size so it stays whole on a phone instead of clipping. */
function headlineSize(text: string): string {
	if (text.length > 15) return 'text-[clamp(1.25rem,6.5vw,2rem)]';
	if (text.length > 12) return 'text-[clamp(1.75rem,8.5vw,2.5rem)]';
	return 'text-[clamp(2.25rem,11vw,3rem)]';
}

export function DashboardPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [summary, setSummary] = useState<DashboardSummary | null>(null);
	const [insights, setInsights] = useState<DashboardInsights | null>(null);
	const [lending, setLending] = useState<OpenLoanTotals | null>(null);
	const [merchants, setMerchants] = useState<Merchant[]>([]);
	const [layout, setLayout] = useState<DashboardWidgetConfig[]>(() =>
		resolveDashboardLayout(undefined)
	);
	const [loadError, setLoadError] = useState(false);
	// Bumped by "Try again" and after seeding categories, to load everything afresh.
	const [reloadToken, setReloadToken] = useState(0);
	// First-run state: nothing to show yet, so the page offers the next step instead.
	const [accountCount, setAccountCount] = useState<number | null>(null);
	const [categoryCount, setCategoryCount] = useState(0);
	const [seeding, setSeeding] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoadError(false);
		Promise.all([
			getDashboardSummary(key),
			getLendingSummary(key),
			MerchantRepository.list(key),
			UserProfileRepository.get(),
			AccountRepository.list(key, false),
			CategoryRepository.list(key)
		])
			.then(([nextSummary, nextLending, nextMerchants, profile, accounts, categories]) => {
				if (cancelled) return;
				setSummary(nextSummary);
				setLending(nextLending);
				setMerchants(nextMerchants);
				setAccountCount(accounts.length);
				setCategoryCount(categories.length);
				setLayout(resolveDashboardLayout(profile?.dashboardLayout));
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setLoadError(true);
				toast.error(err instanceof Error ? err.message : 'Could not load dashboard.');
			});
		// The charts read six months of entries, so they load beside the headline figures instead of
		// holding them back.
		getDashboardInsights(key)
			.then((next) => {
				if (!cancelled) setInsights(next);
			})
			.catch(() => {
				// The cards below say "could not load" rather than showing a toast over the whole page.
				if (!cancelled) setInsights(null);
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [reloadToken]);

	async function seedCategories() {
		setSeeding(true);
		try {
			const added = await addStarterCategories(key);
			toast.success(added > 0 ? `Added ${added} categories` : 'You already have these categories');
			setReloadToken((n) => n + 1);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not add categories.');
		} finally {
			setSeeding(false);
		}
	}

	async function saveLayout(next: DashboardWidgetConfig[]) {
		// `next` is the raw form to persist (an empty array is "reset to default" — FR-025's
		// sentinel), but local render state must always be the fully-resolved layout, or a
		// reset would render nothing until the next reload.
		setLayout(resolveDashboardLayout(next));
		try {
			await UserProfileRepository.update({ dashboardLayout: next });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save dashboard layout.');
		}
	}

	if (loadError && !summary) {
		return (
			<div className="mx-auto flex max-w-4xl flex-col items-start gap-3 px-4 py-8 sm:px-6">
				<p className="text-sm text-destructive">Could not load the dashboard.</p>
				<Button variant="outline" onClick={() => setReloadToken((n) => n + 1)}>
					Try again
				</Button>
			</div>
		);
	}
	if (!summary) {
		return <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">Loading…</div>;
	}

	const monthLabel = insights ? monthName(insights.month) : 'this month';
	const spentShare =
		insights && insights.income > 0 ? Math.round((insights.expense / insights.income) * 100) : null;

	const widgets: Record<DashboardWidgetId, ReactNode> = {
		'total-balance': (
			<Link to="/accounts">
				<Card className="h-full bg-gradient-to-br from-primary/20 via-card to-card transition-colors hover:bg-muted/50">
					<CardHeader className="pb-0">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Total Balance
						</CardTitle>
					</CardHeader>
					<CardContent>
						{/* The one headline number, set large in the same sans as everything else. */}
						<p
							className={`${headlineSize(formatMoney(summary.totalBalance))} leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]`}
						>
							{formatMoney(summary.totalBalance)}
						</p>
						{/* This total is net of credit card debt; say so, with both halves, whenever there is a
						    card — otherwise "37,500" reads as cash in hand when 12,500 of it is a debt. */}
						{summary.hasCreditCards && (
							<p className="mt-1 text-xs text-muted-foreground">
								Cash &amp; bank {formatMoney(summary.cashBalance)} ·{' '}
								{summary.cardBalance <= 0 ? 'owed on cards' : 'credit on cards'}{' '}
								{formatMoney(Math.abs(summary.cardBalance))}
							</p>
						)}
						{summary.balanceTrend.length > 1 && (
							<div className="mt-3">
								<Sparkline values={summary.balanceTrend} />
							</div>
						)}
					</CardContent>
				</Card>
			</Link>
		),
		'month-summary': (
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle className="text-base">This month</CardTitle>
					<span className="text-xs text-muted-foreground">{monthLabel}</span>
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					{insights ? (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div>
									<p className="flex items-center gap-1 text-xs text-muted-foreground">
										<ArrowDownLeft className="size-3.5 text-income" aria-hidden /> Money in
									</p>
									<p className="text-xl font-semibold text-income">
										{formatMoney(insights.income)}
									</p>
								</div>
								<div>
									<p className="flex items-center gap-1 text-xs text-muted-foreground">
										<ArrowUpRight className="size-3.5 text-expense" aria-hidden /> Money out
									</p>
									<p className="text-xl font-semibold text-expense">
										{formatMoney(insights.expense)}
									</p>
								</div>
							</div>
							{insights.income > 0 ? (
								<div className="flex flex-col gap-1.5">
									<ProgressBar
										value={insights.expense}
										max={insights.income}
										label="Share of this month's money in that has gone out"
									/>
									<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
										{insights.expense > insights.income ? (
											<>
												<AlertTriangle className="size-3.5 text-warning" aria-hidden />
												Spent {formatMoney(insights.expense - insights.income)} more than came in
											</>
										) : (
											<>
												<CheckCircle2 className="size-3.5 text-income" aria-hidden />
												{spentShare}% of it has gone out ·{' '}
												{formatMoney(insights.income - insights.expense)} left
											</>
										)}
									</p>
								</div>
							) : (
								<p className="text-xs text-muted-foreground">
									{insights.expense > 0
										? 'Nothing has come in yet this month.'
										: 'Nothing recorded yet this month.'}
								</p>
							)}
						</>
					) : (
						<p className="text-sm text-muted-foreground">Loading…</p>
					)}
				</CardContent>
			</Card>
		),
		spending: (
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle className="text-base">Where it went</CardTitle>
					<CardLink to="/analytics">Details</CardLink>
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					{!insights ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : insights.spending.length === 0 ? (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<Wallet className="size-4" aria-hidden /> No spending recorded in {monthLabel} yet.
						</p>
					) : (
						<>
							<p className="text-2xl font-semibold">
								{formatMoney(insights.spendingTotal)}{' '}
								<span className="text-xs font-normal text-muted-foreground">
									spent in {monthLabel}
								</span>
							</p>
							<SegmentedBar
								showLegend={false}
								segments={insights.spending.map((s) => ({
									label: s.label,
									value: s.total,
									color: s.color
								}))}
								format={formatMoney}
							/>
							<BarList
								format={formatMoney}
								items={insights.spending.map((s) => ({
									id: s.id,
									label: s.label,
									value: s.total,
									color: s.color,
									note: `${Math.round((s.total / insights.spendingTotal) * 100)}%`
								}))}
							/>
						</>
					)}
				</CardContent>
			</Card>
		),
		trend: (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Last 6 months</CardTitle>
				</CardHeader>
				<CardContent>
					{insights ? (
						<TrendBars
							format={formatMoney}
							formatCompact={formatMoneyCompact}
							points={insights.trend.map((p) => ({
								label: new Date(`${p.month}-01T00:00:00`).toLocaleString(undefined, {
									month: 'short'
								}),
								title: new Date(`${p.month}-01T00:00:00`).toLocaleString(undefined, {
									month: 'long',
									year: 'numeric'
								}),
								income: p.income,
								expense: p.expense
							}))}
						/>
					) : (
						<p className="text-sm text-muted-foreground">Loading…</p>
					)}
				</CardContent>
			</Card>
		),
		budgets: (
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle className="text-base">Budgets</CardTitle>
					<CardLink to="/budgets">All budgets</CardLink>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{!insights ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : insights.budgets.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No budgets for {monthLabel}.{' '}
							<Link to="/budgets" className="text-primary underline underline-offset-2">
								Set one
							</Link>{' '}
							to see how spending compares.
						</p>
					) : (
						insights.budgets.map((budget) => {
							const tone = meterTone(budget.actual, budget.planned);
							return (
								<div key={budget.id} className="flex flex-col gap-1.5">
									<div className="flex items-baseline justify-between gap-3 text-sm">
										<span className="flex min-w-0 items-center gap-2">
											<span
												aria-hidden
												className="size-2.5 shrink-0 rounded-full"
												style={{ backgroundColor: budget.color }}
											/>
											<span className="truncate">{budget.label}</span>
										</span>
										<span className="shrink-0 text-xs text-muted-foreground">
											{formatMoney(budget.actual)} of {formatMoney(budget.planned)}
										</span>
									</div>
									<ProgressBar
										value={budget.actual}
										max={budget.planned}
										label={`${budget.label} budget used`}
									/>
									<p
										className={cn(
											'flex items-center gap-1.5 text-xs',
											tone === 'good' ? 'text-muted-foreground' : 'text-foreground'
										)}
									>
										{tone === 'danger' ? (
											<>
												<AlertTriangle className="size-3.5 text-expense" aria-hidden /> Over by{' '}
												{formatMoney(budget.actual - budget.planned)}
											</>
										) : tone === 'warning' ? (
											<>
												<AlertTriangle className="size-3.5 text-warning" aria-hidden /> Close to the
												limit · {formatMoney(budget.planned - budget.actual)} left
											</>
										) : (
											<>{formatMoney(budget.planned - budget.actual)} left</>
										)}
									</p>
								</div>
							);
						})
					)}
				</CardContent>
			</Card>
		),
		lending: (
			<Link to="/people">
				<Card className="h-full transition-colors hover:bg-muted/50">
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">Lending</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-1">
						<p className="text-sm">
							You're owed{' '}
							<span className="font-semibold text-income">
								{formatMoney(lending?.totalLent ?? 0)}
							</span>
						</p>
						<p className="text-sm">
							You owe{' '}
							<span className="font-semibold text-expense">
								{formatMoney(lending?.totalBorrowed ?? 0)}
							</span>
						</p>
					</CardContent>
				</Card>
			</Link>
		),
		'net-worth': (
			<Link to="/net-worth">
				<Card className="h-full transition-colors hover:bg-muted/50">
					<CardHeader className="pb-2">
						<CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
							<TrendingUp className="size-3.5 text-primary" /> Net Worth
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p
							className={`${formatMoney(summary.netWorth).length > 13 ? 'text-base' : 'text-xl'} font-semibold [overflow-wrap:anywhere]`}
						>
							{formatMoney(summary.netWorth)}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Cash, cards, investments &amp; loans. Tap for the breakdown.
						</p>
					</CardContent>
				</Card>
			</Link>
		),
		unreviewed: (
			<Link to="/review">
				<Card
					className={cn(
						'h-full transition-colors hover:bg-muted/50',
						summary.unreviewedCount > 0 && 'ring-warning/50'
					)}
				>
					<CardHeader className="pb-2">
						<CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
							<Inbox
								className={cn('size-3.5', summary.unreviewedCount > 0 && 'text-warning')}
								aria-hidden
							/>
							Unreviewed
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p
							className={cn(
								'text-3xl leading-none font-semibold',
								summary.unreviewedCount > 0 && 'text-warning'
							)}
						>
							{summary.unreviewedCount}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							{summary.unreviewedCount > 0 ? 'Transactions awaiting review' : 'All caught up'}
						</p>
					</CardContent>
				</Card>
			</Link>
		),
		'recent-transactions': (
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle className="text-base">Recent Transactions</CardTitle>
					<CardLink to="/transactions">View all</CardLink>
				</CardHeader>
				<CardContent>
					{summary.recentTransactions.length === 0 ? (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<Wallet className="size-4" /> No transactions yet.
						</p>
					) : (
						<ul className="flex flex-col gap-3">
							{summary.recentTransactions.map((tx) => (
								<li key={tx.id} className="flex items-center justify-between gap-3 text-sm">
									<div className="flex min-w-0 flex-1 items-center gap-2">
										<span
											aria-hidden
											className={cn(
												'flex size-8 shrink-0 items-center justify-center rounded-full',
												tx.amount < 0 ? 'bg-expense/15 text-expense' : 'bg-income/15 text-income'
											)}
										>
											{tx.amount < 0 ? (
												<ArrowUpRight className="size-4" />
											) : (
												<ArrowDownLeft className="size-4" />
											)}
										</span>
										<div className="min-w-0">
											<p className="truncate" title={formatTransactionLabel(tx, merchants)}>
												{formatTransactionLabel(tx, merchants)}
											</p>
											<p className="text-xs text-muted-foreground">
												{tx.date}
												{tx.reviewStatus === 'unreviewed' && (
													<Badge variant="outline" className="ml-2 align-middle">
														Unreviewed
													</Badge>
												)}
											</p>
										</div>
									</div>
									<span
										className={cn(
											'shrink-0 font-mono',
											tx.amount < 0 ? 'text-expense' : 'text-income'
										)}
									>
										{formatMoney(tx.amount)}
									</span>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		)
	};

	const visibleIds = layout.filter((w) => w.visible).map((w) => w.widgetId as DashboardWidgetId);

	return (
		<div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
			<div className="mb-4 flex items-center justify-between sm:mb-6">
				<h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
				<DashboardCustomizeSheet
					layout={layout}
					onChange={(next) => void saveLayout(next)}
					onReset={() => void saveLayout([])}
				/>
			</div>

			{accountCount === 0 && (
				<Card className="mb-6 border-primary/40 bg-primary/5">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<Rocket className="size-4 text-primary" /> Get started
						</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-3 text-sm">
						<p className="text-muted-foreground">
							Three steps and MyFin is useful. Everything stays on this device.
						</p>
						<ol className="flex list-decimal flex-col gap-2 pl-5">
							<li>
								Add the places your money sits — a bank account, a wallet, a card.{' '}
								<Link
									to="/accounts"
									className="font-medium text-primary underline underline-offset-2"
								>
									Add an account
								</Link>
							</li>
							<li>
								{categoryCount === 0 ? (
									<>
										Set up categories so spending can be sorted.{' '}
										<Button
											variant="link"
											size="sm"
											className="h-auto p-0"
											disabled={seeding}
											onClick={() => void seedCategories()}
										>
											{seeding ? 'Adding…' : 'Add common categories'}
										</Button>
									</>
								) : (
									<>Categories are set up.</>
								)}
							</li>
							<li>
								Record your first spend — or paste a bank message and let MyFin read it.{' '}
								<Link
									to="/transactions/new"
									className="font-medium text-primary underline underline-offset-2"
								>
									Add your first transaction
								</Link>
							</li>
						</ol>
					</CardContent>
				</Card>
			)}

			<BackupNudgeBanner hasData={(accountCount ?? 0) > 0} />

			<div className="grid grid-cols-2 gap-3 sm:gap-4">
				{visibleIds.map((id) => (
					<div key={id} className={FULL_WIDTH[id] ? 'col-span-2' : 'col-span-1'}>
						{widgets[id]}
					</div>
				))}
			</div>
		</div>
	);
}
