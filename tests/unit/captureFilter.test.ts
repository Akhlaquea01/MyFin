import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { classifyMessage, isForeignCurrencyOnly } from '../../src/domain/capture/captureFilter';
import type { CapturePayload } from '../../src/domain/capture/captureTypes';

/** The cases both this filter and the Android pre-filter must accept (see the file's header). */
function sharedAcceptCases(): { sender: string; body: string }[] {
	const raw = readFileSync(new URL('../fixtures/captureAcceptCases.txt', import.meta.url), 'utf-8');
	return raw
		.replace(/\r\n/g, '\n')
		.split(/^----$/m)
		.slice(1)
		.map((section) => section.trim())
		.filter((section) => section !== '')
		.map((section) => {
			const [first, ...rest] = section.split('\n');
			return { sender: first.replace(/^sender:\s*/, '').trim(), body: rest.join('\n') };
		});
}

const sms = (body: string, sender = 'VM-HDFCBK'): CapturePayload => ({
	channel: 'sms',
	sender,
	body,
	receivedAt: Date.UTC(2026, 9, 5, 9, 30)
});
const note = (title: string, body: string): CapturePayload => ({
	channel: 'notification',
	sender: 'Google Pay',
	title,
	body,
	receivedAt: Date.UTC(2026, 9, 5, 9, 30)
});

describe('classifyMessage — accepts completed money movements', () => {
	it.each([
		'Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 05/10/26 Ref 628123456789',
		'Rs.500.00 debited from A/c XX1234 to AMAZON on 05-Oct-26. Avl Bal Rs.9,000.00',
		'Acct XX123 is credited with Rs 5,000.00 on 05-Oct-26 from JOHN DOE. UPI:628123456789',
		'Spent Card no. XX5678 INR 1,299.00 05-10-26 14:22:10 AMAZON PAY Avl Lmt INR 98,701.00',
		'INR 52,000.00 credited to your A/c XX1234 on 01-Oct-26 by NEFT-ACME CORP-SALARY',
		'Rs.2,000.00 withdrawn from A/c XX1234 at ATM'
	])('accepts: %s', (body) => {
		expect(classifyMessage(sms(body))).toEqual({ ok: true });
	});

	it('accepts a payment-app notification built from title and body', () => {
		expect(classifyMessage(note('Paid ₹250', 'Paid ₹250.00 to Swiggy'))).toEqual({ ok: true });
	});

	// The same alert reaches the phone from the bank, forwarded from a contact, or over RCS (which
	// only shows up as a messaging app's notification).
	const axisUpiDebit =
		'INR 97.00 debited\nA/c no. XX0146\n12-10-26, 19:29:33\nUPI/P2M/548275113159/MDMAHFOOZ\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank';

	it.each([
		['from the bank', 'AX-AXISBK-S'],
		['from a phone number', '+919876543210'],
		['from a phone number without a country code', '09876543210']
	])('accepts an Axis Bank UPI debit SMS %s', (_label, sender) => {
		expect(classifyMessage(sms(axisUpiDebit, sender))).toEqual({ ok: true });
	});

	it('accepts an Axis Bank UPI debit seen as a messaging-app notification', () => {
		expect(
			classifyMessage({
				channel: 'notification',
				sender: 'Google Messages',
				title: 'Ashfaque bro',
				body: axisUpiDebit,
				receivedAt: Date.UTC(2026, 9, 12, 14, 47)
			})
		).toEqual({ ok: true });
	});
});

describe('classifyMessage — credit-card charges that used to be dropped', () => {
	it.each(sharedAcceptCases().map((c) => [c.body.split('\n')[0], c] as const))(
		'accepts the shared case: %s',
		(_label, c) => {
			expect(classifyMessage(sms(c.body, c.sender))).toEqual({ ok: true });
		}
	);

	it('reads the shared fixture file (guards against an empty parity set)', () => {
		expect(sharedAcceptCases().length).toBeGreaterThanOrEqual(10);
	});

	it('keeps a processed e-mandate charge but not one that is only scheduled', () => {
		expect(
			classifyMessage(
				sms(
					'Your E-Mandate for NETFLIX of Rs 649.00 was successfully processed on your Credit Card ending 1234.'
				)
			)
		).toEqual({ ok: true });
		expect(
			classifyMessage(
				sms(
					'E-Mandate for NETFLIX of Rs 649.00 on your Credit Card ending 1234 will be processed on 05-Nov-26.'
				)
			)
		).toEqual({ ok: false, reason: 'future-or-request' });
		expect(
			classifyMessage(
				sms('Auto-debit mandate of Rs 649.00 is scheduled on your Credit Card XX1234')
			)
		).toEqual({ ok: false, reason: 'future-or-request' });
	});

	it('keeps a purchase alert that ends with "see statement for details"', () => {
		expect(
			classifyMessage(
				sms(
					'Rs.1,299.00 spent on your HDFC Bank Credit Card ending 5678 at AMAZON. See statement for details.'
				)
			)
		).toEqual({ ok: true });
	});

	it('still rejects a statement-ready notice', () => {
		expect(
			classifyMessage(
				sms('Your statement for Credit Card ending 5678 is generated. Total due Rs.12,000.00')
			)
		).toEqual({ ok: false, reason: 'future-or-request' });
	});

	it('keeps a debit alert whose footer warns against sharing an OTP', () => {
		expect(
			classifyMessage(
				sms(
					'Rs.500.00 debited from A/c XX1234 to AMAZON on 05-Oct-26. Never share OTP, CVV or PIN.'
				)
			)
		).toEqual({ ok: true });
	});

	it('still rejects a code message even when its own sentence says not to share it', () => {
		expect(
			classifyMessage(sms('Your OTP 123456 for payment of Rs.500.00 to SWIGGY; do not share it.'))
		).toEqual({ ok: false, reason: 'otp' });
		expect(
			classifyMessage(sms('123456 is your OTP for payment of Rs.500.00 to SWIGGY. Do not share.'))
		).toEqual({ ok: false, reason: 'otp' });
	});

	it('lets a foreign-currency charge through to the unreadable list instead of dropping it', () => {
		const body = 'USD 12.00 spent on HDFC Bank Credit Card ending 1234 at OPENAI on 05-Oct-26.';
		expect(isForeignCurrencyOnly(body)).toBe(true);
		expect(classifyMessage(sms(body))).toEqual({ ok: true });
		expect(isForeignCurrencyOnly('Rs.1,000 (USD 12.00) spent on Credit Card ending 1234')).toBe(
			false
		);
	});
});

describe('classifyMessage — rejects things that are not a completed transaction', () => {
	it.each([
		[
			'an OTP that quotes the amount',
			'123456 is your OTP for txn of Rs.500 at AMAZON. Do not share with anyone.',
			'otp'
		],
		[
			'a loan promotion',
			'Get pre-approved loan up to Rs.5,00,000! Apply now http://bit.ly/x',
			'promo'
		],
		['a balance enquiry', 'Avl Bal in A/c XX1234 is Rs.9,000.00 as on 05-Oct-26', 'balance-only'],
		[
			'a failed payment',
			'Your UPI txn of Rs.500 to SWIGGY has failed. Amount debited will be reversed',
			'failed'
		],
		[
			'a future debit',
			'Rs.500 will be debited from your A/c XX1234 on 10-Oct-26 for your mandate',
			'future-or-request'
		],
		[
			'a bill reminder',
			'Your credit card statement of Rs.12,000 is due on 15-Oct. Min due Rs.600',
			'future-or-request'
		],
		['a collect request', 'Rahul has requested money Rs.500 from you on UPI', 'future-or-request'],
		['a message with no movement', 'Welcome to our new branch, visit us', 'not-transactional']
	])('rejects %s', (_label, body, reason) => {
		expect(classifyMessage(sms(body))).toEqual({ ok: false, reason });
	});

	it('rejects a message from a phone number, which is a person', () => {
		expect(classifyMessage(sms('I paid Rs 500 to you yesterday', '+919876543210'))).toEqual({
			ok: false,
			reason: 'personal-sender'
		});
		expect(
			classifyMessage(sms('Sent 500 rupees via UPI, ref 548275113159', '09876543210'))
		).toEqual({ ok: false, reason: 'personal-sender' });
	});

	it('rejects a message over 1000 characters', () => {
		expect(classifyMessage(sms('Rs.500 debited ' + 'x'.repeat(1100)))).toEqual({
			ok: false,
			reason: 'too-long'
		});
	});

	it('rejects a transaction word with no amount', () => {
		expect(classifyMessage(sms('Your debit card has been blocked'))).toEqual({
			ok: false,
			reason: 'no-amount'
		});
	});

	it('does not treat "present" or "unpaid" as a transaction', () => {
		expect(classifyMessage(sms('Please present your ID. Unpaid dues Rs.500'))).toMatchObject({
			ok: false
		});
	});
});
