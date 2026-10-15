import { describe, it, expect } from 'vitest';
import {
	findPairedCapture,
	PAIRING_WINDOW_MS,
	REFERENCE_WINDOW_MS
} from '../../src/domain/capture/capturePairing';
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

describe('findPairedCapture with reference numbers and accounts', () => {
	const withRef = (refNo: string) => ({ ...incoming, refNo });

	it('pairs the same reference on the same channel, after the usual window, onto a confirmed entry', () => {
		const old = waiting('old', { reviewStatus: 'confirmed' }, { refNo: 'R1', receivedAt: T0 });
		const again = {
			channel: 'sms' as const,
			receivedAt: T0 + 2 * 24 * 60 * 60 * 1000,
			refNo: 'R1'
		};
		expect(findPairedCapture(again, -25000, [old])?.id).toBe('old');
	});

	it('pairs the same reference even when the entry already absorbed a sighting', () => {
		const taken = waiting(
			'taken',
			{},
			{
				refNo: 'R1',
				alsoSeenAs: [{ channel: 'notification', sender: 'Google Pay', receivedAt: T0 }]
			}
		);
		expect(findPairedCapture(withRef('R1'), -25000, [taken])?.id).toBe('taken');
	});

	it('never pairs two different references, however close they arrive', () => {
		expect(
			findPairedCapture(withRef('R2'), -25000, [waiting('sms', {}, { refNo: 'R1' })])
		).toBeNull();
	});

	it('still needs the same amount for a matching reference', () => {
		expect(
			findPairedCapture(withRef('R1'), -25100, [waiting('sms', {}, { refNo: 'R1' })])
		).toBeNull();
	});

	it('does not pair across the reference window', () => {
		const far = {
			...incoming,
			receivedAt: T0 + REFERENCE_WINDOW_MS + 1,
			refNo: 'R1'
		};
		expect(findPairedCapture(far, -25000, [waiting('sms', {}, { refNo: 'R1' })])).toBeNull();
	});

	it('refuses two entries whose own digits named different accounts', () => {
		const onA = waiting('sms', { accountId: 'a' }, { accountCheck: null });
		expect(findPairedCapture({ ...incoming, exactAccountId: 'b' }, -25000, [onA])).toBeNull();
		expect(findPairedCapture({ ...incoming, exactAccountId: 'a' }, -25000, [onA])?.id).toBe('sms');
	});

	it('does not let a guessed account veto a pairing', () => {
		const guessed = waiting('sms', { accountId: 'a' }, { accountCheck: 'default-account' });
		expect(findPairedCapture({ ...incoming, exactAccountId: 'b' }, -25000, [guessed])?.id).toBe(
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
