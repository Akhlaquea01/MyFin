import { useEffect, useState } from 'react';
import { Camera, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
	Chart,
	LineController,
	LineElement,
	PointElement,
	LinearScale,
	CategoryScale,
	Tooltip
} from 'chart.js';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Sparkline } from '../components/Sparkline';
import { ChartCanvas } from '../components/ChartCanvas';
import { useSession } from '../context/SessionContext';
import { getChartPalette, getAxisColor, getGridColor, withAlpha } from '../lib/chartColors';
import {
	computeNetWorth,
	netWorthHistory,
	recordNetWorthSnapshot,
	type NetWorthBreakdown
} from '../domain/wealth/wealthEngine';
import type { NetWorthSnapshot } from '../domain/entities';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

// User Story 7 (P7): net worth = assets - liabilities, with a recorded history (FR-034).
export function NetWorthPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const palette = getChartPalette();
	const axisColor = getAxisColor();
	const gridColor = getGridColor();

	const [breakdown, setBreakdown] = useState<NetWorthBreakdown | null>(null);
	const [history, setHistory] = useState<NetWorthSnapshot[]>([]);

	async function refresh() {
		setBreakdown(await computeNetWorth(key));
		setHistory(await netWorthHistory(key));
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function handleSnapshot() {
		await recordNetWorthSnapshot(key);
		toast.success('Snapshot recorded');
		await refresh();
	}

	if (!breakdown) return <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">Loading…</div>;

	return (
		<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Net Worth</h1>
				<Button variant="outline" onClick={handleSnapshot}>
					<Camera /> Record snapshot
				</Button>
			</div>

			<Card className="mb-6">
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						Total Net Worth
					</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="font-mono text-3xl font-semibold">{formatMoney(breakdown.netWorth)}</p>
					{history.length > 1 && <Sparkline values={history.map((s) => s.netWorth)} />}
					<dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
						<dt className="text-muted-foreground">Cash</dt>
						<dd className="text-right font-mono">{formatMoney(breakdown.cashBalance)}</dd>
						<dt className="text-muted-foreground">Investments</dt>
						<dd className="text-right font-mono">{formatMoney(breakdown.investmentValue)}</dd>
						<dt className="text-muted-foreground">Liabilities</dt>
						<dd className="text-right font-mono text-destructive">
							-{formatMoney(breakdown.totalLiabilities)}
						</dd>
					</dl>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">History</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{history.length === 0 ? (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<TrendingUp className="size-4" /> No snapshots recorded yet.
						</p>
					) : (
						<>
							{history.length > 1 && (
								<ChartCanvas
									label={`Line chart of net worth history: ${history
										.map((s) => `${s.date} ${formatMoney(s.netWorth)}`)
										.join(', ')}`}
									config={{
										type: 'line',
										data: {
											labels: history.map((s) => s.date),
											datasets: [
												{
													label: 'Net worth',
													data: history.map((s) => s.netWorth / 100),
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
											scales: {
												x: { ticks: { color: axisColor }, grid: { color: gridColor } },
												y: { ticks: { color: axisColor }, grid: { color: gridColor } }
											},
											plugins: { legend: { display: false } }
										}
									}}
								/>
							)}
							<ul className="flex flex-col gap-2">
								{history
									.slice()
									.reverse()
									.map((snapshot, i, reversed) => {
										const previous = reversed[i + 1];
										const TrendIcon =
											previous === undefined || snapshot.netWorth === previous.netWorth
												? Minus
												: snapshot.netWorth > previous.netWorth
													? TrendingUp
													: TrendingDown;
										return (
											<li key={snapshot.id} className="flex items-center justify-between text-sm">
												<span className="flex items-center gap-2 text-muted-foreground">
													<TrendIcon className="size-3.5" /> {snapshot.date}
												</span>
												<span className="font-mono">{formatMoney(snapshot.netWorth)}</span>
											</li>
										);
									})}
							</ul>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
