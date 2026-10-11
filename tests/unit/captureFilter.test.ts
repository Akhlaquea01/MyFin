import { describe, it, expect } from 'vitest';
import { classifyMessage } from '../../src/domain/capture/captureFilter';
import type { CapturePayload } from '../../src/domain/capture/captureTypes';

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
