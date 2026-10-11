import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { todayLocalISO } from '../domain/shared/dateMath';

export interface DateRange {
	from: string;
	to: string;
}

interface Preset {
	label: string;
	range: () => DateRange;
}

// Local calendar dates, not UTC: transaction dates come from `<input type="date">`, which is the
// user's local day, so a range ending at the UTC date excluded today's entries in any timezone
// ahead of UTC until the UTC day caught up.
const toISODate = todayLocalISO;

function monthsAgo(n: number, today: Date): Date {
	return new Date(today.getFullYear(), today.getMonth() - n, 1);
}

const PRESETS: Preset[] = [
	{
		label: 'This month',
		range: () => {
			const now = new Date();
			const start = new Date(now.getFullYear(), now.getMonth(), 1);
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
			return { from: `${now.getFullYear()}-01-01`, to: toISODate(now) };
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
