import { cn } from 'cn';

export interface BarSegment {
	label: string;
	value: number;
	/** Any CSS colour, normally a token such as `var(--income)`. */
	color: string;
}

/**
 * One horizontal bar split into coloured parts, with a legend underneath. For "how is this pile
 * made up" at a glance: the Review queue by readiness, a month by category. Pure CSS, so it is
 * sharp on any screen and costs nothing to render.
 */
export function SegmentedBar({
	segments,
	className,
	format = (n) => String(n)
}: {
	segments: BarSegment[];
	className?: string;
	/** How a value is written in the legend. */
	format?: (value: number) => string;
}) {
	const shown = segments.filter((s) => s.value > 0);
	const total = shown.reduce((sum, s) => sum + s.value, 0);
	const summary = shown.map((s) => `${format(s.value)} ${s.label}`).join(', ');

	return (
		<div className={cn('flex flex-col gap-2', className)}>
			<div
				role="img"
				aria-label={summary || 'Nothing to show'}
				className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
			>
				{shown.map((s) => (
					<div
						key={s.label}
						className="h-full min-w-1 first:rounded-l-full last:rounded-r-full"
						style={{ flexGrow: s.value / total, flexBasis: 0, backgroundColor: s.color }}
					/>
				))}
			</div>
			{shown.length > 0 && (
				<ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					{shown.map((s) => (
						<li key={s.label} className="flex items-center gap-1.5">
							<span
								aria-hidden
								className="size-2 rounded-full"
								style={{ backgroundColor: s.color }}
							/>
							{format(s.value)} {s.label}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
