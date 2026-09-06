import { useEffect, useRef, useState } from 'react';
import {
	Chart,
	type ChartConfiguration,
	LineController,
	LineElement,
	PointElement,
	LinearScale,
	CategoryScale,
	Tooltip,
	Legend
} from 'chart.js';
import { HeartPulse } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Progress } from '../components/ui/progress';
import { DateRangeSelector, type DateRange } from '../components/DateRangeSelector';
import { useSession } from '../context/SessionContext';
import {
	getFinancialHealthTrend,
	getFinancialHealthScore
} from '../domain/analytics/financialHealthService';
import type { FinancialHealthMetrics, FinancialHealthScore } from '../domain/analytics/financialHealthEngine';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

function formatPercent(ratio: number | null): string {
	if (ratio === null) return 'Not applicable';
	return `${(ratio * 100).toFixed(1)}%`;
}

function formatAdherence(percent: number | null): string {
	if (percent === null) return 'Not applicable';
	return `${percent.toFixed(0)}%`;
}

function defaultRange(): DateRange {
	const now = new Date();
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
	return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

/** Mounts/updates/destroys a Chart.js chart on a canvas as `config` changes (same pattern as
 *  AnalyticsPage.tsx's ChartCanvas). */
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

function MetricCard({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-2xl font-semibold tracking-tight">{value}</p>
			</CardContent>
		</Card>
	);
}

function ScoreCard({ score }: { score: FinancialHealthScore | null }) {
	if (!score) return null;
	return (
		<Card className="sm:col-span-2 lg:col-span-3">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<HeartPulse className="size-4 text-primary" />
					Financial Health Score
					{score.dataQuality === 'limited' && <Badge variant="outline">Based on limited data</Badge>}
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{score.score === null ? (
					<p className="text-sm text-muted-foreground">Not enough data yet.</p>
				) : (
					<>
						<div className="flex items-baseline gap-2">
							<span className="text-3xl font-semibold tracking-tight">{score.score}</span>
							<span className="text-sm text-muted-foreground">/ 100</span>
						</div>
						<Progress value={score.score} />
					</>
				)}
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div className="flex flex-col gap-1">
						<div className="flex items-center justify-between text-sm">
							<span>Savings rate ({Math.round(score.breakdown.savingsRate.weight * 100)}% weight)</span>
							<span className="font-medium">{formatPercent(score.breakdown.savingsRate.value)}</span>
						</div>
						<Progress value={score.breakdown.savingsRate.component ?? 0} />
					</div>
					<div className="flex flex-col gap-1">
						<div className="flex items-center justify-between text-sm">
							<span>
								Budget adherence ({Math.round(score.breakdown.budgetAdherence.weight * 100)}% weight)
							</span>
							<span className="font-medium">
								{formatAdherence(score.breakdown.budgetAdherence.value)}
							</span>
						</div>
						<Progress value={score.breakdown.budgetAdherence.component ?? 0} />
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

// User Story 007: derived read-only insights (savings rate, expense/income ratio, budget
// adherence, trend, composite score) computed entirely from existing ledger/budget data —
// see specs/007-financial-health-insights.
export function FinancialHealthPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [range, setRange] = useState<DateRange>(defaultRange);
	const [loading, setLoading] = useState(true);
	const [trend, setTrend] = useState<FinancialHealthMetrics[]>([]);
	const [score, setScore] = useState<FinancialHealthScore | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void Promise.all([
			getFinancialHealthTrend(key, range.from, range.to),
			getFinancialHealthScore(key, range.from, range.to)
		]).then(([t, s]) => {
			if (cancelled) return;
			setTrend(t);
			setScore(s);
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [key, range]);

	const latest = trend.length > 0 ? trend[trend.length - 1] : null;

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Financial Health</h1>
				<DateRangeSelector value={range} onChange={setRange} />
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : !latest ? (
				<Card>
					<CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
						<HeartPulse className="size-4" /> No data in this range yet.
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-4">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<MetricCard label="Savings rate" value={formatPercent(latest.savingsRate)} />
						<MetricCard
							label="Expense-to-income ratio"
							value={formatPercent(latest.expenseToIncomeRatio)}
						/>
						<MetricCard label="Budget adherence" value={formatAdherence(latest.budgetAdherence)} />
					</div>

					<ScoreCard score={score} />

					<Card>
						<CardHeader>
							<CardTitle className="text-base">Trend</CardTitle>
						</CardHeader>
						<CardContent>
							{trend.length < 2 ? (
								<p className="py-10 text-sm text-muted-foreground">
									Not enough months in this range to show a trend yet.
								</p>
							) : (
								<ChartCanvas
									label={`Line chart of savings rate and budget adherence by month: ${trend
										.map(
											(m) =>
												`${m.month} savings rate ${formatPercent(m.savingsRate)}, budget adherence ${formatAdherence(m.budgetAdherence)}`
										)
										.join(', ')}`}
									config={{
										type: 'line',
										data: {
											labels: trend.map((m) => m.month),
											datasets: [
												{
													label: 'Savings rate (%)',
													data: trend.map((m) => (m.savingsRate === null ? null : m.savingsRate * 100)),
													borderColor: '#0f766e',
													backgroundColor: 'rgba(15, 118, 110, 0.2)',
													spanGaps: true,
													tension: 0.3
												},
												{
													label: 'Budget adherence (%)',
													data: trend.map((m) => m.budgetAdherence),
													borderColor: '#6366f1',
													backgroundColor: 'rgba(99, 102, 241, 0.2)',
													spanGaps: true,
													tension: 0.3
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
				</div>
			)}
		</div>
	);
}
