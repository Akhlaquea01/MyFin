import { useEffect, useState } from 'react';
import { Camera, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight } from 'lucide-react';
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
	type NetWorthBreakdown,
	type NetWorthCategory
} from '../domain/wealth/wealthEngine';
import type { NetWorthSnapshot } from '../domain/entities';

// FR-005/FR-006: order matters for display — assets first, then liabilities, each labeled
// distinctly instead of one undifferentiated total (research.md §2).
const CATEGORY_LABELS: Record<
	keyof Pick<
		NetWorthBreakdown,
		'cash' | 'creditCardDebt' | 'investments' | 'loansLent' | 'loansBorrowed' | 'otherLiabilities'
	>,
	string
> = {
	cash: 'Cash & bank balances',
	investments: 'Investments',
	loansLent: 'Money lent',
	creditCardDebt: 'Credit card debt',
	loansBorrowed: 'Money borrowed',
	otherLiabilities: 'Other liabilities (loans)'
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[];

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
	const [loadError, setLoadError] = useState(false);
	const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

	function toggleCategory(key: string) {
		setExpandedCategories((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	async function refresh() {
		try {
			setLoadError(false);
			const [nextBreakdown, nextHistory] = await Promise.all([
				computeNetWorth(key),
				netWorthHistory(key)
			]);
			setBreakdown(nextBreakdown);
			setHistory(nextHistory);
		} catch (err) {
			setLoadError(true);
			toast.error(err instanceof Error ? err.message : 'Could not load net worth.');
		}
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function handleSnapshot() {
		try {
			await recordNetWorthSnapshot(key);
			toast.success('Snapshot recorded');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not record snapshot.');
		}
	}

	if (loadError && !breakdown) {
		return (
			<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
				<p className="mb-3 text-sm text-destructive">Could not load net worth.</p>
				<Button variant="outline" onClick={() => void refresh()}>
					Retry
				</Button>
			</div>
		);
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
					{/* FR-005/FR-006: every category is a distinct, labeled subtotal that sums exactly to
					    the total above (SC-002) — never one undifferentiated figure. */}
					<div className="mt-4 flex flex-col divide-y">
						{CATEGORY_ORDER.map((categoryKey) => {
							const category: NetWorthCategory = breakdown[categoryKey];
							const isLiability =
								categoryKey === 'creditCardDebt' ||
								categoryKey === 'loansBorrowed' ||
								categoryKey === 'otherLiabilities';
							const isExpanded = expandedCategories.has(categoryKey);
							const hasItems = category.items.length > 0;
							return (
								<div key={categoryKey} className="py-2">
									<button
										type="button"
										className="flex w-full items-center justify-between gap-2 text-sm disabled:cursor-default"
										onClick={() => hasItems && toggleCategory(categoryKey)}
										disabled={!hasItems}
									>
										<span className="flex items-center gap-1 text-muted-foreground">
											{hasItems &&
												(isExpanded ? (
													<ChevronDown className="size-3.5" />
												) : (
													<ChevronRight className="size-3.5" />
												))}
											{CATEGORY_LABELS[categoryKey]}
										</span>
										<span className={`font-mono ${isLiability ? 'text-destructive' : ''}`}>
											{isLiability && category.subtotal > 0 ? '-' : ''}
											{formatMoney(category.subtotal)}
										</span>
									</button>
									{isExpanded && hasItems && (
										<ul className="mt-2 flex flex-col gap-1 pl-5">
											{category.items.map((item) => (
												<li
													key={item.id}
													className="flex items-center justify-between text-xs text-muted-foreground"
												>
													<span>{item.name}</span>
													<span className="font-mono">{formatMoney(item.amount)}</span>
												</li>
											))}
										</ul>
									)}
								</div>
							);
						})}
					</div>
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
