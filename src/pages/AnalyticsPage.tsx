import { useEffect, useRef, useState } from 'react';
import {
	Chart,
	type ChartConfiguration,
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
import { BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { DateRangeSelector, type DateRange } from '../components/DateRangeSelector';
import { useSession } from '../context/SessionContext';
import {
	categoryBreakdown,
	incomeExpenseTrend,
	cashFlowTrend,
	budgetPerformance,
	netWorthTrend,
	type CategoryBreakdownItem,
	type MonthlyTrendPoint,
	type CashFlowPoint,
	type BudgetPerformanceItem,
	type NetWorthTrendPoint
} from '../domain/analytics/analyticsEngine';

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

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

function defaultRange(): DateRange {
	const now = new Date();
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
	return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

/** Mounts/updates/destroys a Chart.js chart on a canvas as `config` changes. */
function ChartCanvas({ config, label }: { config: ChartConfiguration; label: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const chartRef = useRef<Chart | null>(null);

	useEffect(() => {
		if (!canvasRef.current) return;
		chartRef.current = new Chart(canvasRef.current, config);
		return () => chartRef.current?.destroy();
	}, [config]);

	return (
		<div className="h-64 w-full">
			<canvas ref={canvasRef} role="img" aria-label={label} />
		</div>
	);
}

const AXIS_COLOR = 'rgba(148, 163, 184, 0.6)';
const GRID_COLOR = 'rgba(148, 163, 184, 0.15)';

const baseScales = {
	x: { ticks: { color: AXIS_COLOR }, grid: { color: GRID_COLOR } },
	y: { ticks: { color: AXIS_COLOR }, grid: { color: GRID_COLOR } }
};

// User Story 8 (P8): visual breakdowns of spending, income/expense, cash flow, budget
// performance, and net worth trend over a selectable range (FR-035/FR-036).
export function AnalyticsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [range, setRange] = useState<DateRange>(defaultRange);
	const [loading, setLoading] = useState(true);
	const [categories, setCategories] = useState<CategoryBreakdownItem[]>([]);
	const [trend, setTrend] = useState<MonthlyTrendPoint[]>([]);
	const [cashFlow, setCashFlow] = useState<CashFlowPoint[]>([]);
	const [budgets, setBudgets] = useState<BudgetPerformanceItem[]>([]);
	const [netWorth, setNetWorth] = useState<NetWorthTrendPoint[]>([]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void Promise.all([
			categoryBreakdown(key, range.from, range.to),
			incomeExpenseTrend(key, range.from, range.to),
			cashFlowTrend(key, range.from, range.to),
			budgetPerformance(key, range.from, range.to),
			netWorthTrend(key, range.from, range.to)
		])
			.then(([cat, inc, flow, perf, nw]) => {
				if (cancelled) return;
				setCategories(cat);
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
	}, [key, range]);

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
							<CardTitle className="text-base">Spending by category</CardTitle>
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
													backgroundColor: 'rgba(15, 118, 110, 0.7)'
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
							<CardTitle className="text-base">Income vs. expense</CardTitle>
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
											plugins: { legend: { labels: { color: AXIS_COLOR } } }
										}
									}}
								/>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="text-base">Cash flow</CardTitle>
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
													borderColor: '#0f766e',
													backgroundColor: 'rgba(15, 118, 110, 0.2)',
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
							<CardTitle className="text-base">Net worth trend</CardTitle>
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
													borderColor: '#6366f1',
													backgroundColor: 'rgba(99, 102, 241, 0.2)',
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
							<CardTitle className="text-base">Budget performance</CardTitle>
						</CardHeader>
						<CardContent>
							{budgets.length === 0 ? (
								<EmptyState />
							) : (
								<div className="flex flex-col gap-2">
									{budgets.map((b) => (
										<div
											key={`${b.budgetId}-${b.periodStart}`}
											className="flex items-center justify-between border-b py-2 text-sm last:border-0"
										>
											<span className="flex items-center gap-2">
												{b.categoryName}{' '}
												<span className="text-muted-foreground">({b.periodStart})</span>
												{b.actualAmount > b.plannedAmount && (
													<Badge variant="destructive">Over budget</Badge>
												)}
											</span>
											<span className="font-mono">
												{formatMoney(b.actualAmount)} /{' '}
												<span
													className={
														b.actualAmount > b.plannedAmount
															? 'text-destructive'
															: 'text-muted-foreground'
													}
												>
													{formatMoney(b.plannedAmount)}
												</span>
											</span>
										</div>
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
