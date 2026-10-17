import { describe, it, expect } from 'vitest';
import {
	SAME_MOMENT_WINDOW_MS,
	describeCaptureMoment,
	isSameMoment,
	momentFromDateAndTime,
	momentGapMs
} from '../../src/domain/capture/captureMoment';
import type { CaptureInfo } from '../../src/domain/entities';

const at = (receivedAt: number, txnAt?: number | null) => ({ receivedAt, txnAt });
const MINUTE = 60 * 1000;

describe('momentGapMs', () => {
	it('compares stated payment times with each other when both have one', () => {
		// The messages were received an hour apart, but both say the payment was at the same time.
		expect(momentGapMs(at(0, 5 * MINUTE), at(60 * MINUTE, 6 * MINUTE))).toBe(MINUTE);
	});

	it('falls back to the time each message was received', () => {
		expect(momentGapMs(at(10 * MINUTE), at(13 * MINUTE))).toBe(3 * MINUTE);
		// One side states a time and the other does not: only the received times are comparable.
		expect(momentGapMs(at(10 * MINUTE, 99 * MINUTE), at(13 * MINUTE))).toBe(3 * MINUTE);
	});

	it('is null when there is nothing to compare', () => {
		expect(momentGapMs(null, at(1))).toBeNull();
		expect(momentGapMs(undefined, undefined)).toBeNull();
	});
});

describe('isSameMoment', () => {
	it('is true up to the window and false beyond it', () => {
		expect(isSameMoment(at(0), at(SAME_MOMENT_WINDOW_MS))).toBe(true);
		expect(isSameMoment(at(0), at(SAME_MOMENT_WINDOW_MS + 1))).toBe(false);
		expect(isSameMoment(null, at(0))).toBe(false);
	});
});

describe('momentFromDateAndTime', () => {
	it('builds a local time from a date and a 24-hour time', () => {
		const ms = momentFromDateAndTime('2026-10-05', '19:29');
		expect(ms).toBe(new Date(2026, 9, 5, 19, 29).getTime());
	});

	it('refuses a date or time that does not exist', () => {
		expect(momentFromDateAndTime('2026-13-45', '19:29')).toBeNull();
		expect(momentFromDateAndTime('2026-10-05', '25:99')).toBeNull();
	});
});

describe('describeCaptureMoment', () => {
	const base: CaptureInfo = {
		channel: 'sms',
		sender: 'VM-HDFCBK',
		receivedAt: Date.UTC(2026, 9, 5, 13, 59, 33),
		text: 'x'
	};

	it('names the sender and when the message arrived', () => {
		const text = describeCaptureMoment(base);
		expect(text).toContain('SMS from VM-HDFCBK');
		expect(text).toContain('received');
		expect(text).not.toContain('payment time');
	});

	it('adds the time the message states when it has one', () => {
		const text = describeCaptureMoment({
			...base,
			channel: 'notification',
			sender: 'Google Pay',
			txnAt: Date.UTC(2026, 9, 5, 13, 58)
		});
		expect(text).toContain('Google Pay notification');
		expect(text).toContain('payment time');
	});
});
