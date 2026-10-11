import { describe, it, expect } from 'vitest';
import { findPairedCapture, PAIRING_WINDOW_MS } from '../../src/domain/capture/capturePairing';
import { originalMessageOf } from '../../src/domain/capture/originalMessage';
import type { CaptureInfo, Transaction } from '../../src/domain/entities';

const T0 = 1_791_000_000_000;

function waiting(
	id: string,
	overrides: Partial<Transaction> = {},
	capture: Partial<CaptureInfo> = {}
) {
	return {
		id,
		accountId: 'a',
		date: '2026-10-05',
		amount: -25000,
		type: 'expense',
		transferPairId: null,
		merchantId: null,
		notes: null,
		source: 'sms_capture',
		reviewStatus: 'unreviewed',
		duplicateOfId: null,
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		capture: { channel: 'sms', sender: 'VM-HDFCBK', receivedAt: T0, text: 'x', ...capture },
		...overrides
	} as Transaction;
}

const incoming = { channel: 'notification' as const, receivedAt: T0 + 30_000 };

describe('findPairedCapture', () => {
	it('finds the other-channel entry for the same payment', () => {
		expect(findPairedCapture(incoming, -25000, [waiting('sms')])?.id).toBe('sms');
	});

	it('does not pair two messages on the same channel', () => {
		expect(
			findPairedCapture({ channel: 'sms', receivedAt: T0 + 30_000 }, -25000, [waiting('sms')])
		).toBeNull();
	});

	it('needs the same signed amount', () => {
		expect(findPairedCapture(incoming, -25100, [waiting('sms')])).toBeNull();
		expect(findPairedCapture(incoming, 25000, [waiting('sms')])).toBeNull();
	});

	it('needs the messages to be close in time', () => {
		expect(
			findPairedCapture({ ...incoming, receivedAt: T0 + PAIRING_WINDOW_MS + 1 }, -25000, [
				waiting('sms')
			])
		).toBeNull();
		expect(
			findPairedCapture({ ...incoming, receivedAt: T0 + PAIRING_WINDOW_MS }, -25000, [
				waiting('sms')
			])?.id
		).toBe('sms');
	});

	it('pairs one-to-one: an entry that already absorbed a sighting is never paired again', () => {
		const taken = waiting(
			'taken',
			{},
			{
				alsoSeenAs: [{ channel: 'notification', sender: 'Google Pay', receivedAt: T0 }]
			}
		);
		expect(findPairedCapture(incoming, -25000, [taken])).toBeNull();
	});

	it('picks the closest of several candidates', () => {
		const far = waiting('far', {}, { receivedAt: T0 - 5 * 60_000 });
		const near = waiting('near', {}, { receivedAt: T0 + 10_000 });
		expect(findPairedCapture(incoming, -25000, [far, near])?.id).toBe('near');
	});

	it('ignores entries that were already confirmed or were not captured', () => {
		const confirmed = waiting('done', { reviewStatus: 'confirmed' });
		const manual = waiting('manual', { capture: null });
		expect(findPairedCapture(incoming, -25000, [confirmed, manual])).toBeNull();
	});

	it('does not care which account each landed on', () => {
		expect(findPairedCapture(incoming, -25000, [waiting('sms', { accountId: 'other' })])?.id).toBe(
			'sms'
		);
	});
});

describe('originalMessageOf', () => {
	it('prefers notes, then the captured text, then nothing', () => {
		expect(originalMessageOf({ notes: 'typed', capture: { text: 'sms' } as CaptureInfo })).toBe(
			'typed'
		);
		expect(originalMessageOf({ notes: null, capture: { text: 'sms' } as CaptureInfo })).toBe('sms');
		expect(originalMessageOf({ notes: null, capture: null })).toBe('');
	});
});
