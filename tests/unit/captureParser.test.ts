import { describe, it, expect } from 'vitest';
import { parseCapturedMessage } from '../../src/domain/capture/captureParser';
import type { CapturePayload } from '../../src/domain/capture/captureTypes';

const sms = (body: string): CapturePayload => ({
	channel: 'sms',
	sender: 'VM-HDFCBK',
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

describe('parseCapturedMessage', () => {
	it('reads a UPI debit: amount, tail, merchant, date and reference', () => {
		const parsed = parseCapturedMessage(
			sms('Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 05/10/26 Ref 628123456789')
		);
		expect(parsed).toMatchObject({
			amount: 25000,
			type: 'expense',
			accountTail: '1234',
			merchantText: 'SWIGGY',
			txnDate: '2026-10-05',
			refNo: '628123456789'
		});
	});

	it('reads a keyword amount and a compact date', () => {
		const parsed = parseCapturedMessage(
			sms(
				'Dear UPI user A/C X1234 debited by 250.0 on date 05Oct26 trf to SWIGGY Refno 628123456789'
			)
		);
		expect(parsed).toMatchObject({
			amount: 25000,
			type: 'expense',
			accountTail: '1234',
			merchantText: 'SWIGGY',
			txnDate: '2026-10-05',
			refNo: '628123456789'
		});
	});

	it('reads a credit with a 3-digit account tail and the payer', () => {
		const parsed = parseCapturedMessage(
			sms('Acct XX123 is credited with Rs 5,000.00 on 05-Oct-26 from JOHN DOE. UPI:628123456789')
		);
		expect(parsed).toMatchObject({
			amount: 500000,
			type: 'income',
			accountTail: '123',
			merchantText: 'JOHN DOE',
			txnDate: '2026-10-05',
			refNo: '628123456789'
		});
	});

	it('takes the transaction amount, not the card limit, and reads a card tail and merchant after the time', () => {
		const parsed = parseCapturedMessage(
			sms('Spent Card no. XX5678 INR 1,299.00 05-10-26 14:22:10 AMAZON PAY Avl Lmt INR 98,701.00')
		);
		expect(parsed).toMatchObject({
			amount: 129900,
			type: 'expense',
			cardTail: '5678',
			merchantText: 'AMAZON PAY',
			txnDate: '2026-10-05'
		});
	});

	it('reads a credit card purchase', () => {
		const parsed = parseCapturedMessage(
			sms('Rs.1299.00 spent on your HDFC Bank Credit Card ending 5678 at AMAZON on 05-10-2026.')
		);
		expect(parsed).toMatchObject({
			amount: 129900,
			type: 'expense',
			cardTail: '5678',
			merchantText: 'AMAZON',
			txnDate: '2026-10-05'
		});
	});

	it('treats a refund as income', () => {
		const parsed = parseCapturedMessage(
			sms('Refund of Rs.500.00 for your order credited to your A/c XX1234')
		);
		expect(parsed).toMatchObject({ amount: 50000, type: 'income', accountTail: '1234' });
	});

	it('reads a NEFT salary credit and names the payer, not the rail', () => {
		const parsed = parseCapturedMessage(
			sms('INR 52,000.00 credited to your A/c XX1234 on 01-Oct-26 by NEFT-ACME CORP-SALARY')
		);
		expect(parsed).toMatchObject({
			amount: 5200000,
			type: 'income',
			accountTail: '1234',
			merchantText: 'ACME CORP',
			txnDate: '2026-10-01'
		});
	});

	it('reads an ATM withdrawal', () => {
		const parsed = parseCapturedMessage(sms('Rs.2,000.00 withdrawn from A/c XX1234 at ATM'));
		expect(parsed).toMatchObject({ amount: 200000, type: 'expense', accountTail: '1234' });
	});

	it('handles Indian digit grouping and keeps the last four digits of a long unmasked account number', () => {
		const parsed = parseCapturedMessage(
			sms('Rs.1,23,456.78 debited from A/c 123456789012 to RENT')
		);
		expect(parsed).toMatchObject({ amount: 12345678, accountTail: '9012', merchantText: 'RENT' });
	});

	it('reads direction from the earliest verb, so "credited ... debit card" is income', () => {
		const parsed = parseCapturedMessage(
			sms('Rs.500 credited to your A/c XX1234 from RAHUL. Debit card XX9999 unaffected')
		);
		expect(parsed?.type).toBe('income');
	});

	it('does not mistake "present" or "unpaid" for a direction', () => {
		expect(parseCapturedMessage(sms('Rs.500 unpaid, please present the slip'))).toBeNull();
	});

	it('reads "received from" as income', () => {
		const parsed = parseCapturedMessage(sms('You have received Rs 500 from John via UPI'));
		expect(parsed).toMatchObject({ amount: 50000, type: 'income', merchantText: 'John' });
	});

	it('reads payment-app notifications from title and body', () => {
		expect(parseCapturedMessage(note('Paid ₹250', 'Paid ₹250.00 to Swiggy'))).toMatchObject({
			amount: 25000,
			type: 'expense',
			merchantText: 'Swiggy'
		});
		expect(
			parseCapturedMessage(note('Swiggy paid you ₹500', 'Received in your bank account'))
		).toMatchObject({
			amount: 50000,
			type: 'income'
		});
	});

	it('never reads an amount as an account number', () => {
		const parsed = parseCapturedMessage(sms('Paid Rs 1234.00 to SWIGGY'));
		expect(parsed).toMatchObject({ amount: 123400, accountTail: null, cardTail: null });
	});

	it('flags a credit card bill payment', () => {
		expect(
			parseCapturedMessage(sms('Rs.5,000 debited from A/c XX1234 towards your credit card XX5678'))
				?.isCardPayment
		).toBe(true);
	});

	it('ignores a date that is not a real calendar date', () => {
		expect(
			parseCapturedMessage(sms('Rs.100 debited from A/c XX1234 to SHOP on 31-02-26'))?.txnDate
		).toBeNull();
	});

	it('reads a UPI message that names a VPA and carries a support line', () => {
		const parsed = parseCapturedMessage(
			sms(
				'Rs.1500.00 debited from a/c **1234 on 05-10-26 to VPA swiggy@icici(UPI Ref No 628123456789). Not you? Call 18002586161'
			)
		);
		expect(parsed).toMatchObject({
			amount: 150000,
			type: 'expense',
			accountTail: '1234',
			merchantText: 'swiggy',
			txnDate: '2026-10-05',
			refNo: '628123456789'
		});
	});

	it('reads a long masked account number and a bracketed reference', () => {
		const parsed = parseCapturedMessage(
			sms(
				'Dear Customer, Your a/c no. XXXXXXXX1234 is debited by Rs.250.0 on 05Oct26 (Ref No 628123456789)'
			)
		);
		expect(parsed).toMatchObject({
			amount: 25000,
			type: 'expense',
			accountTail: '1234',
			txnDate: '2026-10-05',
			refNo: '628123456789'
		});
	});

	it('does not read the available balance as the amount', () => {
		const parsed = parseCapturedMessage(
			sms('Rs.99.00 debited from A/c XX1234 at NETFLIX. Avl Bal Rs.9,000.00')
		);
		expect(parsed).toMatchObject({ amount: 9900, merchantText: 'NETFLIX' });
	});

	it('returns null when the amount is clear but the direction is not', () => {
		expect(parseCapturedMessage(sms('Rs.500 alert on your account XX1234'))).toBeNull();
	});

	it('returns null when there is no amount', () => {
		expect(parseCapturedMessage(sms('Your account was debited'))).toBeNull();
	});
});
