import { cn } from 'cn';
import { meterTone, type MeterTone } from './meterTone';

const TONE_COLOR: Record<MeterTone, string> = {
	good: 'var(--income)',
	warning: 'var(--warning)',
	danger: 'var(--expense)'
};

/**
 * A meter: how much of a limit is used. The fill takes the colour of its state and the track is a
 * pale step of the same colour, so the state reads across the whole bar. The state is also
 * written by the caller beside it (colour is never the only signal).
 */
export function ProgressBar({
	value,
	max,
	label,
	tone,
	className
}: {
	value: number;
	max: number;
	/** What is measured, for assistive technology. */
	label: string;
	tone?: MeterTone;
	className?: string;
}) {
	const color = TONE_COLOR[tone ?? meterTone(value, max)];
	const percent = max > 0 ? Math.min(100, (Math.max(0, value) / max) * 100) : value > 0 ? 100 : 0;
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={Math.max(max, 0)}
			aria-valuenow={Math.max(0, value)}
			className={cn('h-2.5 w-full overflow-hidden rounded-full', className)}
			style={{ backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)` }}
		>
			<div
				className="h-full rounded-full"
				style={{ width: `${percent}%`, backgroundColor: color }}
			/>
		</div>
	);
}
