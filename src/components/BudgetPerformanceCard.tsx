import { useEffect, useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ProgressBar } from './charts/ProgressBar';
import { useSession } from '../context/SessionContext';
import {
	budgetPerformance,
	withLiveBudgetActuals,
	type BudgetPerformanceItem
} from '../domain/analytics/analyticsEngine';
import {
	budgetPerformanceInMonth,
	budgetYears,
	groupBudgetPerformance
} from '../domain/analytics/budgetPeriodLabel';
import { MONTH_NAMES } from '../domain/reports/reportEngine';
import { formatMoney } from '../domain/shared/money';
import { cn } from '../lib/utils';

// One month at a time: every period of every budget on one screen grew without bound.
export function BudgetPerformanceCard({ className }: { className?: string }) {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [all, setAll] = useState<BudgetPerformanceItem[] | null>(null);
	const [year, setYear] = useState(() => new Date().getFullYear());
	const [month, setMonth] = useState(() => new Date().getMonth() + 1);

	useEffect(() => {
		let cancelled = false;
		budgetPerformance(key, '0000-01-01', '9999-12-31')
			.then((items) => {
				if (!cancelled) setAll(items);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				toast.error(err instanceof Error ? err.message : 'Could not load budget performance.');
				setAll([]);
			});
		return () => {
			cancelled = true;
		};
	}, [key]);

	const years = useMemo(() => budgetYears(all ?? [], new Date().getFullYear()), [all]);
	const monthRows = useMemo(
		() => budgetPerformanceInMonth(all ?? [], year, month),
		[all, year, month]
	);

	// Only the chosen month is brought up to date: the stored spend lags behind new transactions.
	const [rows, setRows] = useState<BudgetPerformanceItem[] | null>(null);
	useEffect(() => {
		if (all === null) return;
		let cancelled = false;
		setRows(null);
		withLiveBudgetActuals(key, monthRows)
			.then((live) => {
				if (!cancelled) setRows(live);
			})
			.catch(() => {
				if (cancelled) return;
				toast.error('Could not refresh this month’s spending; showing the last saved figures.');
				setRows(monthRows);
			});
		return () => {
			cancelled = true;
		};
	}, [key, all, monthRows]);

	const groups = useMemo(() => groupBudgetPerformance(rows ?? []), [rows]);
	const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

	return (
		<Card className={className}>
			<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
				<CardTitle className="flex items-center gap-2 text-base">
					<Target className="size-4 text-primary" /> Budget performance
				</CardTitle>
				<div className="flex gap-2">
					<Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
						<SelectTrigger className="w-32" aria-label="Month">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{MONTH_NAMES.map((name, i) => (
								<SelectItem key={name} value={String(i + 1)}>
									{name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
						<SelectTrigger className="w-24" aria-label="Year">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{years.map((y) => (
								<SelectItem key={y} value={String(y)}>
									{y}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</CardHeader>
			<CardContent>
				{rows === null ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : rows.length === 0 ? (
					<p className="py-6 text-sm text-muted-foreground">No budgets for {monthLabel}.</p>
				) : (
					<div className="flex flex-col gap-5">
						{groups.map((group) => (
							<section key={group.id} className="flex flex-col gap-3">
								{/* The pickers already name a month; a heading only tells apart other periods. */}
								<h3 className={cn('text-sm font-medium', groups.length === 1 && 'sr-only')}>
									{group.label}
								</h3>
								{group.items.map((b) => (
									<div key={`${b.budgetId}-${b.periodStart}`} className="flex flex-col gap-1.5">
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
	);
}
