// When a captured payment happened, as far as the messages say. Two clocks are kept on an entry:
// `receivedAt` (when the phone got the message) and `txnAt` (the date and time written inside it).
// They answer different questions — a delayed SMS is received long after the payment — so a
// comparison only ever sets like against like: stated time to stated time, received to received.
import type { CaptureInfo, EpochMillis, ISODateString } from '../entities';

/** Same amount and this close in time: almost always one payment alerted twice. */
export const SAME_MOMENT_WINDOW_MS = 30 * 60 * 1000;

type Moments = Pick<CaptureInfo, 'receivedAt' | 'txnAt'>;

/** Local-time epoch millis for a calendar date and a 24-hour "HH:mm", or null if either is bad. */
export function momentFromDateAndTime(date: ISODateString, time: string): EpochMillis | null {
	const ms = new Date(`${date}T${time}:00`).getTime();
	return Number.isFinite(ms) ? ms : null;
}

/** How far apart two captured messages are in time, or null when neither clock can be compared. */
export function momentGapMs(
	a: Moments | null | undefined,
	b: Moments | null | undefined
): number | null {
	if (!a || !b) return null;
	if (typeof a.txnAt === 'number' && typeof b.txnAt === 'number')
		return Math.abs(a.txnAt - b.txnAt);
	if (typeof a.receivedAt === 'number' && typeof b.receivedAt === 'number') {
		return Math.abs(a.receivedAt - b.receivedAt);
	}
	return null;
}

export function isSameMoment(
	a: Moments | null | undefined,
	b: Moments | null | undefined
): boolean {
	const gap = momentGapMs(a, b);
	return gap !== null && gap <= SAME_MOMENT_WINDOW_MS;
}

/** "5 Oct 2026, 7:29:33 pm" — with the year and seconds, because two alerts a minute apart are
 *  exactly what has to be told apart. */
export function formatMoment(ms: EpochMillis): string {
	return new Date(ms).toLocaleString(undefined, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		second: '2-digit'
	});
}

/** "SMS from VM-HDFCBK · received 5 Oct 2026, 7:29:33 pm · payment time 7:28 pm". */
export function describeCaptureMoment(capture: CaptureInfo): string {
	const who =
		capture.channel === 'sms' ? `SMS from ${capture.sender}` : `${capture.sender} notification`;
	const parts = [who, `received ${formatMoment(capture.receivedAt)}`];
	if (typeof capture.txnAt === 'number') {
		parts.push(
			`payment time ${new Date(capture.txnAt).toLocaleTimeString(undefined, {
				hour: 'numeric',
				minute: '2-digit'
			})}`
		);
	}
	return parts.join(' · ');
}
