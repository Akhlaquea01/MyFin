import type { ReactNode } from 'react';
import { PiggyBank, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { ProgressBar } from './charts/ProgressBar';
import { meterTone } from './charts/meterTone';
import type { BudgetItem } from '../domain/entities';
import { formatMoney } from '../domain/shared/money';

/** Actual-vs-planned progress for one budget's current period (User Story 5, FR-024/027). */
export function BudgetProgressCard({
	categoryName,
	note,
	item,
	actions
}: {
	categoryName: string;
	/** Small line under the name, e.g. "Includes 2 subcategories". */
	note?: string;
	item: BudgetItem;
	/** Optional per-budget actions (Edit/Delete, spec 017 FR-011/FR-013) rendered in the header. */
	actions?: ReactNode;
}) {
	const isOverspent = item.actualAmount > item.plannedAmount;
	const tone = meterTone(item.actualAmount, item.plannedAmount);
	const left = item.plannedAmount - item.actualAmount;

	return (
		<Card>
			<CardHeader className="flex items-center justify-between space-y-0 pb-2">
				<CardTitle className="flex items-center gap-2 text-base">
					<PiggyBank className="size-4 text-primary" /> {categoryName}
				</CardTitle>
				<div className="flex items-center gap-1.5">
					{isOverspent && (
						<Badge variant="destructive" className="gap-1">
							<AlertTriangle className="size-3" /> Over budget
						</Badge>
					)}
					{actions}
				</div>
			</CardHeader>
			<CardContent>
				{note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
				<div className="mb-2 flex items-baseline justify-between text-sm">
					<span className="font-mono">{formatMoney(item.actualAmount)}</span>
					<span className="text-muted-foreground">of {formatMoney(item.plannedAmount)}</span>
				</div>
				<ProgressBar
					value={item.actualAmount}
					max={item.plannedAmount}
					label={`${categoryName} budget used`}
				/>
				<p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
					{tone === 'danger' ? (
						<>
							<AlertTriangle className="size-3.5 text-expense" aria-hidden /> Over by{' '}
							{formatMoney(-left)}
						</>
					) : tone === 'warning' ? (
						<>
							<AlertTriangle className="size-3.5 text-warning" aria-hidden /> Close to the limit ·{' '}
							{formatMoney(left)} left
						</>
					) : (
						<>{formatMoney(left)} left</>
					)}
				</p>
				{item.rolloverInAmount !== 0 && (
					<p className="mt-2 text-xs text-muted-foreground">
						{item.rolloverInAmount > 0
							? `Includes ${formatMoney(item.rolloverInAmount)} rolled over from last period`
							: `Includes a ${formatMoney(Math.abs(item.rolloverInAmount))} deficit carried over from last period`}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
