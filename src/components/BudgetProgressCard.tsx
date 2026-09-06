import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import type { BudgetItem } from '../domain/entities';

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

/** Actual-vs-planned progress for one budget's current period (User Story 5, FR-024/027). */
export function BudgetProgressCard({
	categoryName,
	item
}: {
	categoryName: string;
	item: BudgetItem;
}) {
	const isOverspent = item.actualAmount > item.plannedAmount;
	const percent =
		item.plannedAmount > 0 ? Math.min(100, (item.actualAmount / item.plannedAmount) * 100) : 0;

	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-base">{categoryName}</CardTitle>
				{isOverspent && <Badge variant="destructive">Over budget</Badge>}
			</CardHeader>
			<CardContent>
				<div className="mb-2 flex items-baseline justify-between text-sm">
					<span className="font-mono">{formatMoney(item.actualAmount)}</span>
					<span className="text-muted-foreground">of {formatMoney(item.plannedAmount)}</span>
				</div>
				<Progress
					value={percent}
					className={isOverspent ? '[&_[data-slot=progress-indicator]]:bg-destructive' : undefined}
				/>
				{item.rolloverInAmount > 0 && (
					<p className="mt-2 text-xs text-muted-foreground">
						Includes {formatMoney(item.rolloverInAmount)} rolled over
					</p>
				)}
			</CardContent>
		</Card>
	);
}
