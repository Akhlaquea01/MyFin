import { useState } from 'react';
import { cn } from 'cn';

export interface TrendPoint {
	/** Short axis label, e.g. "Oct". */
	label: string;
	/** Longer name for the readout and the table, e.g. "October 2026". */
	title: string;
	income: number;
	expense: number;
}

const INCOME = 'var(--income)';
const EXPENSE = 'var(--expense)';
const PLOT_HEIGHT = 112;

/**
 * Money in and money out per period as paired columns on ONE shared scale. Tap (or focus) a period
 * to read its exact figures in the line above; the newest period starts selected. A table twin
 * sits under "Table view" so nothing depends on seeing colour or hovering. Because green and rose
 * are hard to tell apart for some readers, "In" and "Out" are always written in the readout and
 * the legend, and the two columns of a pair keep a fixed order (in first).
 */
export function TrendBars({
	points,
	format,
	formatCompact,
	className
}: {
	points: TrendPoint[];
	format: (value: number) => string;
	formatCompact: (value: number) => string;
	className?: string;
}) {
	const [picked, setPicked] = useState<number | null>(null);
	const selected = picked ?? points.length - 1;
	const current = points[selected];
	const max = Math.max(0, ...points.flatMap((p) => [p.income, p.expense]));
	const heightFor = (value: number) =>
		value <= 0 || max <= 0 ? 0 : Math.max(3, Math.round((value / max) * PLOT_HEIGHT));

	if (points.length === 0) return null;
	return (
		<div className={cn('flex flex-col gap-3', className)}>
			<p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" aria-live="polite">
				<span className="font-medium">{current.title}</span>
				<span>
					<span className="text-xs text-muted-foreground">In </span>
					<span className="font-medium text-income">{format(current.income)}</span>
				</span>
				<span>
					<span className="text-xs text-muted-foreground">Out </span>
					<span className="font-medium text-expense">{format(current.expense)}</span>
				</span>
			</p>

			<div
				role="group"
				aria-label="Money in and out by month"
				className="flex items-end justify-between gap-1 border-b border-border/60"
				style={{ height: PLOT_HEIGHT + 28 }}
			>
				{points.map((point, index) => (
					<button
						key={point.title}
						type="button"
						aria-pressed={index === selected}
						aria-label={`${point.title}: in ${format(point.income)}, out ${format(point.expense)}`}
						onClick={() => setPicked(index)}
						className={cn(
							'flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-md px-0.5 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
							index === selected ? 'bg-muted/50' : 'hover:bg-muted/30'
						)}
					>
						<span className="flex items-end gap-0.5" style={{ height: PLOT_HEIGHT }}>
							<span
								aria-hidden
								className="w-3 rounded-t-[4px] sm:w-4"
								style={{ height: heightFor(point.income), backgroundColor: INCOME }}
							/>
							<span
								aria-hidden
								className="w-3 rounded-t-[4px] sm:w-4"
								style={{ height: heightFor(point.expense), backgroundColor: EXPENSE }}
							/>
						</span>
						<span
							className={cn(
								'text-[11px] leading-none',
								index === selected ? 'font-medium text-foreground' : 'text-muted-foreground'
							)}
						>
							{point.label}
						</span>
					</button>
				))}
			</div>

			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span className="flex items-center gap-3">
					<span className="flex items-center gap-1.5">
						<span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: INCOME }} />
						In
					</span>
					<span className="flex items-center gap-1.5">
						<span
							aria-hidden
							className="size-2 rounded-full"
							style={{ backgroundColor: EXPENSE }}
						/>
						Out
					</span>
				</span>
				<span>Tallest column {formatCompact(max)}</span>
			</div>

			<details className="text-xs">
				<summary className="cursor-pointer text-muted-foreground">Table view</summary>
				<table className="mt-2 w-full text-left">
					<thead className="text-muted-foreground">
						<tr>
							<th className="py-1 font-normal">Month</th>
							<th className="py-1 text-right font-normal">In</th>
							<th className="py-1 text-right font-normal">Out</th>
						</tr>
					</thead>
					<tbody>
						{points.map((point) => (
							<tr key={point.title} className="border-t border-border/60">
								<td className="py-1">{point.title}</td>
								<td className="py-1 text-right font-mono">{format(point.income)}</td>
								<td className="py-1 text-right font-mono">{format(point.expense)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>
		</div>
	);
}
