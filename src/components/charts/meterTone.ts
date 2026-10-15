export type MeterTone = 'good' | 'warning' | 'danger';

/** Under 75% of the limit is fine, 75-100% is close, past it is over. */
export function meterTone(value: number, max: number): MeterTone {
	if (max <= 0) return value > 0 ? 'danger' : 'good';
	const ratio = value / max;
	if (ratio > 1) return 'danger';
	return ratio >= 0.75 ? 'warning' : 'good';
}
