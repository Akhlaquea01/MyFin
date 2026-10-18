import { useEffect, useState } from 'react';
import {
	Chart,
	BarController,
	BarElement,
	LineController,
	LineElement,
	PointElement,
	LinearScale,
	CategoryScale,
	Tooltip,
	Legend
} from 'chart.js';
import { BarChart3, PieChart, ArrowLeftRight, Activity, TrendingUp, Target } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ChartCanvas } from '../components/ChartCanvas';
import { BarList } from '../components/charts/BarList';
import { ProgressBar } from '../components/charts/ProgressBar';
import { PURPOSE_LABELS } from '../domain/transactions/purposeEngine';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { DateRangeSelector, type DateRange } from '../components/DateRangeSelector';
import { useSession } from '../context/SessionContext';
import { getChartPalette, getAxisColor, getGridColor, withAlpha } from '../lib/chartColors';
import {
	categoryBreakdown,
	purposeBreakdown,
	incomeExpenseTrend,
	cashFlowTrend,
	budgetPerformance,
	netWorthTrend,
	type CategoryBreakdownItem,
	type PurposeBreakdownItem,
	type MonthlyTrendPoint,
	type CashFlowPoint,
	type BudgetPerformanceItem,
	type NetWorthTrendPoint
} from '../domain/analytics/analyticsEngine';
import { groupBudgetPerformance } from '../domain/analytics/budgetPeriodLabel';
import { todayLocalISO } from '../domain/shared/dateMath';
import { formatMoney } from '../domain/shared/money';

Chart.register(
	BarController,
	BarElement,
	LineController,
	LineElement,
	PointElement,
	LinearScale,
	CategoryScale,
	Tooltip,
	Legend
);

function defaultRange(): DateRange {
	const now = new Date();
	// Local calendar dates (see DateRangeSelector): the UTC date excluded today's entries early in
	// the day for anyone ahead of UTC.
	const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
	return { from: todayLocalISO(start), to: todayLocalISO(now) };
}

// User Story 8 (P8): visual breakdowns of spending, income/expense, cash flow, budget
// performance, and net worth trend over a selectable range (FR-035/FR-036).
export function AnalyticsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	// Resolved once per render from CSS custom properties (index.css) rather than hardcoded —
	// see src/lib/chartColors.ts for why canvas needs literal color strings, not var(...).
	const palette = getChartPalette();
	const axisColor = getAxisColor();
	const gridColor = getGridColor();
	const baseScales = {
		x: { ticks: { color: axisColor }, grid: { color: gridColor } },
		y: { ticks: { color: axisColor }, grid: { color: gridColor } }
	};

	const [range, setRange] = useState<DateRange>(defaultRange);
	const [loading, setLoading] = useState(true);
	const [categories, setCategories] = useState<CategoryBreakdownItem[]>([]);
	const [purposes, setPurposes] = useState<PurposeBreakdownItem[]>([]);
	// Offered only when there is a hierarchy to group by. Off by default: each category on its own,
	// labelled with its full path, is what this chart has always shown.
	const [hasSubcategories, setHasSubcategories] = useState(false);
	const [rollUp, setRollUp] = useState(false);
	const [trend, setTrend] = useState<MonthlyTrendPoint[]>([]);
	const [cashFlow, setCashFlow] = useState<CashFlowPoint[]>([]);
	const [budgets, setBudgets] = useState<BudgetPerformanceItem[]>([]);
	const [netWorth, setNetWorth] = useState<NetWorthTrendPoint[]>([]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void Promise.all([
			categoryBreakdown(key, range.from, range.to, { rollUp }),
			purposeBreakdown(key, range.from, range.to),
			incomeExpenseTrend(key, range.from, range.to),
			cashFlowTrend(key, range.from, range.to),
			budgetPerformance(key, range.from, range.to),
			netWorthTrend(key, range.from, range.to)
		])
			.then(([cat, purpose, inc, flow, perf, nw]) => {
				if (cancelled) return;
				setCategories(cat);
				setPurposes(purpose);
				setTrend(inc);
				setCashFlow(flow);
				setBudgets(perf);
				setNetWorth(nw);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				toast.error(err instanceof Error ? err.message : 'Could not load analytics.');
			})
			.finally(() => {
				// Always clears: a rejection here previously left the page on "Loading..." forever.
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [key, range, rollUp]);

	useEffect(() => {
		void CategoryRepository.list(key)
			.then((all) => setHasSubcategories(all.some((c) => c.parentId !== null)))
			.catch(() => setHasSubcategories(false));
	}, [key]);

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
				<DateRangeSelector value={range} onChange={setRange} />
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<PieChart className="size-4 text-primary" /> Spending by category
							</CardTitle>
							{hasSubcategories && (
								<label className="mt-1 flex items-center gap-2 text-xs font-normal text-muted-foreground">
									<input
										type="checkbox"
										checked={rollUp}
										onChange={(e) => setRollUp(e.target.checked)}
									/>
									Group subcategories under their parent
								</label>
							)}
						</CardHeader>
						<CardContent>
							{categories.length === 0 ? (
								<EmptyState />
							) : (
								<ChartCanvas
									label={`Bar chart of spending by category: ${categories
										.map((c) => `${c.categoryName} ${formatMoney(c.total)}`)
										.join(', ')}`}
									config={{
										type: 'bar',
										data: {
											labels: categories.map((c) => c.categoryName),
											datasets: [
												{
													label: 'Spent',
													data: categories.map((c) => c.total / 100),
													backgroundColor: categories.map((_, i) => palette[i % palette.length])
												}
											]
										},
										options: {
											responsive: true,
											maintainAspectRatio: false,
											scales: baseScales,
											plugins: { legend: { display: false } }
										}
									}}
								/>
							)}
						</CardContent>
					</Card>

					{purposes.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-base">
									<Target className="size-4 text-primary" /> Spending by purpose
								</CardTitle>
							</CardHeader>
							<CardContent>
								<BarList
									items={purposes.map((p, i) => ({
										id: p.kind,
										label: PURPOSE_LABELS[p.kind],
										value: p.total,
										color: `var(--cat-${(i % 8) + 1})`,
										note: `${p.count} ${p.count === 1 ? 'entry' : 'entries'}`
									}))}
									format={formatMoney}
								/>
							</CardContent>
						</Card>
					)}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<ArrowLeftRight className="size-4 text-primary" /> Income vs. expense
							</CardTitle>
						</CardHeader>
						<CardContent>
							{trend.length === 0 ? (
								<EmptyState />
							) : (
								<ChartCanvas
									label={`Bar chart of monthly income vs. expense: ${trend
										.map(
											(t) =>
												`${t.month} income ${formatMoney(t.income)}, expense ${formatMoney(t.expense)}`
										)
										.join(', ')}`}
									config={{
										type: 'bar',
										data: {
											labels: trend.map((t) => t.month),
											datasets: [
												{
													label: 'Income',
													data: trend.map((t) => t.income / 100),
													backgroundColor: 'rgba(34, 197, 94, 0.7)'
												},
												{
													label: 'Expense',
													data: trend.map((t) => t.expense / 100),
													backgroundColor: 'rgba(239, 68, 68, 0.7)'
												}
											]
										},
										options: {
											responsive: true,
											maintainAspectRatio: false,
											scales: baseScales,
											plugins: { legend: { labels: { color: axisColor } } }
										}
									}}
								/>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<Activity className="size-4 text-primary" /> Cash flow
							</CardTitle>
						</CardHeader>
						<CardContent>
							{cashFlow.length === 0 ? (
								<EmptyState />
							) : (
								<ChartCanvas
									label={`Line chart of cumulative cash flow: ${cashFlow
										.map((f) => `${f.month} ${formatMoney(f.cumulativeFlow)}`)
										.join(', ')}`}
									config={{
										type: 'line',
										data: {
											labels: cashFlow.map((f) => f.month),
											datasets: [
												{
													label: 'Cumulative',
													data: cashFlow.map((f) => f.cumulativeFlow / 100),
													borderColor: palette[0],
													backgroundColor: withAlpha(palette[0], 0.2),
													fill: true,
													tension: 0.3
												}
											]
										},
										options: {
											responsive: true,
											maintainAspectRatio: false,
											scales: baseScales,
											plugins: { legend: { display: false } }
										}
									}}
								/>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<TrendingUp className="size-4 text-primary" /> Net worth trend
							</CardTitle>
						</CardHeader>
						<CardContent>
							{netWorth.length === 0 ? (
								<EmptyState />
							) : (
								<ChartCanvas
									label={`Line chart of net worth trend: ${netWorth
										.map((p) => `${p.date} ${formatMoney(p.netWorth)}`)
										.join(', ')}`}
									config={{
										type: 'line',
										data: {
											labels: netWorth.map((p) => p.date),
											datasets: [
												{
													label: 'Net worth',
													data: netWorth.map((p) => p.netWorth / 100),
													borderColor: palette[1],
													backgroundColor: withAlpha(palette[1], 0.2),
													fill: true,
													tension: 0.3
												}
											]
										},
										options: {
											responsive: true,
											maintainAspectRatio: false,
											scales: baseScales,
											plugins: { legend: { display: false } }
										}
									}}
								/>
							)}
						</CardContent>
					</Card>

					<Card className="sm:col-span-2">
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<Target className="size-4 text-primary" /> Budget performance
							</CardTitle>
						</CardHeader>
						<CardContent>
							{budgets.length === 0 ? (
								<EmptyState />
							) : (
								<div className="flex flex-col gap-5">
									{groupBudgetPerformance(budgets).map((group) => (
										<section key={group.id} className="flex flex-col gap-3">
											<h3 className="text-sm font-medium">{group.label}</h3>
											{group.items.map((b) => (
												<div
													key={`${b.budgetId}-${b.periodStart}`}
													className="flex flex-col gap-1.5"
												>
													<div className="flex items-baseline justify-between gap-3 text-sm">
														<span className="min-w-0">{b.categoryName}</span>
														<span className="shrink-0 text-muted-foreground tabular-nums">
															{formatMoney(b.actualAmount)} of {formatMoney(b.plannedAmount)}
														</span>
													</div>
													<ProgressBar
														value={b.actualAmount}
														max={b.plannedAmount}
														label={`${b.categoryName} spent against its budget`}
													/>
													{b.actualAmount > b.plannedAmount && (
														<p className="text-xs text-destructive">
															{formatMoney(b.actualAmount - b.plannedAmount)} over budget
														</p>
													)}
												</div>
											))}
										</section>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</div>
	);
}

function EmptyState() {
	return (
		<p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
			<BarChart3 className="size-4" /> No data in this range yet.
		</p>
	);
}
