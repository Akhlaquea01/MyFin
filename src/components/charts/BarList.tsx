import { cn } from 'cn';

export interface BarListItem {
	id: string;
	label: string;
	value: number;
	/** Any CSS colour, normally a category token such as `var(--cat-2)`. */
	color: string;
	/** A short extra beside the value, e.g. "34%". */
	note?: string;
}

/**
 * Ranked horizontal bars: the label and its figure on one line, a thin bar beneath. The figure is
 * always written out, so the bars add shape without being the only way to read a value, and the
 * longest bar fills the row so shorter ones compare against it on a single scale.
 */
export function BarList({
	items,
	format,
	className
}: {
	items: BarListItem[];
	format: (value: number) => string;
	className?: string;
}) {
	const max = Math.max(0, ...items.map((i) => i.value));
	return (
		<ul className={cn('flex flex-col gap-3', className)}>
			{items.map((item) => (
				<li key={item.id} className="flex flex-col gap-1.5">
					<div className="flex items-baseline justify-between gap-3 text-sm">
						<span className="flex min-w-0 items-center gap-2">
							<span
								aria-hidden
								className="size-2.5 shrink-0 rounded-full"
								style={{ backgroundColor: item.color }}
							/>
							<span className="truncate">{item.label}</span>
						</span>
						<span className="shrink-0">
							<span className="font-medium">{format(item.value)}</span>
							{item.note && (
								<span className="ml-1.5 text-xs text-muted-foreground">{item.note}</span>
							)}
						</span>
					</div>
					<div aria-hidden className="h-2 w-full rounded-full bg-muted/60">
						<div
							className="h-full rounded-full"
							style={{
								width: max > 0 ? `${Math.max(2, (item.value / max) * 100)}%` : '0%',
								backgroundColor: item.color
							}}
						/>
					</div>
				</li>
			))}
		</ul>
	);
}
