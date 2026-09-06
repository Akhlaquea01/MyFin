import { Button } from './ui/button';
import { cn } from '../lib/utils';

export interface DateRange {
	from: string;
	to: string;
}

interface Preset {
	label: string;
	range: () => DateRange;
}

function toISODate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function monthsAgo(n: number, today: Date): Date {
	return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n, 1));
}

const PRESETS: Preset[] = [
	{
		label: 'This month',
		range: () => {
			const now = new Date();
			const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
			return { from: toISODate(start), to: toISODate(now) };
		}
	},
	{
		label: 'Last 3 months',
		range: () => {
			const now = new Date();
			return { from: toISODate(monthsAgo(2, now)), to: toISODate(now) };
		}
	},
	{
		label: 'Last 6 months',
		range: () => {
			const now = new Date();
			return { from: toISODate(monthsAgo(5, now)), to: toISODate(now) };
		}
	},
	{
		label: 'This year',
		range: () => {
			const now = new Date();
			return { from: `${now.getUTCFullYear()}-01-01`, to: toISODate(now) };
		}
	},
	{
		label: 'All time',
		range: () => ({ from: '1970-01-01', to: toISODate(new Date()) })
	}
];

/** A reusable time-range picker for analytics/report views (User Story 8, FR-035). */
export function DateRangeSelector({
	value,
	onChange
}: {
	value: DateRange;
	onChange: (range: DateRange) => void;
}) {
	return (
		<div className="flex flex-wrap gap-2">
			{PRESETS.map((preset) => {
				const presetRange = preset.range();
				const active = presetRange.from === value.from && presetRange.to === value.to;
				return (
					<Button
						key={preset.label}
						type="button"
						size="sm"
						variant={active ? 'default' : 'outline'}
						className={cn(!active && 'text-muted-foreground')}
						onClick={() => onChange(presetRange)}
					>
						{preset.label}
					</Button>
				);
			})}
		</div>
	);
}
