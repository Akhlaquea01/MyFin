import { describe, it, expect } from 'vitest';
import { extractAccountTails, parseCapturedMessage } from '../../src/domain/capture/captureParser';
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
	it('reads an Axis Bank UPI P2M debit written on separate lines', () => {
		const parsed = parseCapturedMessage(
			sms(
				'INR 97.00 debited\nA/c no. XX0146\n12-10-26, 19:29:33\nUPI/P2M/548275113159/MDMAHFOOZ\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank'
			)
		);
		expect(parsed).toMatchObject({
			amount: 9700,
			type: 'expense',
			accountTail: '0146',
			merchantText: 'MDMAHFOOZ',
			txnDate: '2026-10-12',
			refNo: '548275113159'
		});
	});

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

describe('extractAccountTails', () => {
	it.each<[string, string | null, string | null]>([
		['Rs.500 debited from A/c XXXX XXXX 1234 to SWIGGY', '1234', null],
		['Rs.500 debited from a/c XXXXXXXX1234 to SWIGGY', '1234', null],
		['Rs.500 debited from A/c no. 123456789012', '9012', null],
		['Rs.500 debited from HDFC Bank XX1234 to SWIGGY', '1234', null],
		['Rs.500 debited from HDFC Bank **987 to SWIGGY', '987', null],
		['Spent Rs.500 on card XXXX-5678 at AMAZON', null, '5678'],
		['Spent Rs.500 on card XXXX XXXX XXXX 5678 at AMAZON', null, '5678'],
		['Spent Rs.500 on Amex card ending 51001 at AMAZON', null, '1001'],
		['Rs.500 from A/c XX1234 on card ending 5678', '1234', '5678']
	])('reads %s', (text, accountTail, cardTail) => {
		expect(extractAccountTails(text)).toEqual({ accountTail, cardTail });
	});

	it.each([
		'Paid Rs 1234.00 to SWIGGY',
		'Paid Rs 500 to xx123@okbank',
		'Order 1234 shipped, Rs 500 debited',
		'Debited Rs 100 on 12-10-2026'
	])('does not read an account out of "%s"', (text) => {
		expect(extractAccountTails(text)).toEqual({ accountTail: null, cardTail: null });
	});

	it('stays fast on a long run of mask characters', () => {
		const started = Date.now();
		extractAccountTails(`A/c ${'X '.repeat(3000)} and card ${'X '.repeat(3000)}`);
		expect(Date.now() - started).toBeLessThan(500);
	});
});

describe('parseCapturedMessage — credit-card alerts', () => {
	it.each<[string, string]>([
		[
			'Your HDFC Bank Credit Card ending 1234 has been used for a transaction of INR 1,299.00 at AMAZON on 05-Oct-26.',
			'AMAZON'
		],
		['Txn of INR 649.00 done on ICICI Bank Credit Card XX1234 at NETFLIX on 05-Oct-26.', 'NETFLIX'],
		['You have swiped your Amex Card XX1001 for INR 2,499.00 at ZOMATO on 05-Oct-26.', 'ZOMATO'],
		[
			'Thank you for using your HDFC Bank Credit Card ending 1234 for Rs.800.00 at BIGBASKET.',
			'BIGBASKET'
		]
	])('reads the charge as spending when no verb says so: %s', (body, merchant) => {
		const parsed = parseCapturedMessage(sms(body));
		expect(parsed).toMatchObject({ type: 'expense', merchantText: merchant });
		expect(parsed?.amount).toBeGreaterThan(0);
	});

	it('marks a direction that was only assumed from the card', () => {
		const assumed = parseCapturedMessage(
			sms('Thank you for using your HDFC Bank Credit Card ending 1234 for Rs.800.00 at BIGBASKET.')
		);
		expect(assumed).toMatchObject({ instrument: 'credit_card', directionGuessed: true });
		const stated = parseCapturedMessage(
			sms('Rs.1299.00 spent on your HDFC Bank Credit Card ending 5678 at AMAZON on 05-10-2026.')
		);
		expect(stated).toMatchObject({ instrument: 'credit_card', directionGuessed: false });
	});

	it('keeps "transaction of ... credited" as income: the weak wording never beats a real verb', () => {
		expect(
			parseCapturedMessage(sms('Transaction of Rs.500 credited to your A/c XX1234'))
		).toMatchObject({ type: 'income' });
	});

	it('does not file a credit-card bill payment on a guess', () => {
		expect(
			parseCapturedMessage(
				sms(
					'Thank you for your payment of Rs.5,000 towards your HDFC Bank Credit Card ending 1234.'
				)
			)
		).toBeNull();
	});

	it('does not turn a card limit notice into spending', () => {
		expect(
			parseCapturedMessage(sms('Your HDFC Bank Credit Card limit is Rs.50,000.00'))
		).toBeNull();
		expect(
			parseCapturedMessage(
				sms('Your credit limit on Credit Card ending 1234 is increased to Rs.1,00,000.00')
			)
		).toBeNull();
	});

	it('reads the abbreviation "CC" for the card and its digits', () => {
		const parsed = parseCapturedMessage(sms('Rs.450.00 spent on HDFC CC 1234 at SWIGGY'));
		expect(parsed).toMatchObject({
			instrument: 'credit_card',
			cardTail: '1234',
			type: 'expense',
			merchantText: 'SWIGGY'
		});
	});

	it('does not read a foreign-currency amount as rupees', () => {
		expect(
			parseCapturedMessage(sms('USD 12.00 spent on HDFC Bank Credit Card ending 1234 at OPENAI'))
		).toBeNull();
		expect(
			parseCapturedMessage(
				sms('Rs.1,000.00 (USD 12.00) spent on Credit Card ending 1234 at OPENAI')
			)
		).toMatchObject({ amount: 100000, type: 'expense' });
	});

	it('tells the instrument apart', () => {
		const instrument = (body: string) => parseCapturedMessage(sms(body))?.instrument;
		expect(instrument('Rs.500 spent on your Debit Card ending 4321 at SHOP')).toBe('debit_card');
		expect(instrument('Rs.500 debited from A/c XX1234 to SWIGGY via UPI')).toBe('upi');
		expect(instrument('Rs.500 debited from A/c XX1234 to RENT')).toBe('account');
		expect(instrument('Rs.500 spent at SHOP using Card XX5678')).toBeNull();
	});
});

describe('parseCapturedMessage — merchant names on card alerts', () => {
	it('reads the shop after "on" or "Info:", not the date or the bank', () => {
		expect(
			parseCapturedMessage(
				sms('Spent using ICICI Bank Card XX1234 on 12-Oct-26 on NETFLIX.COM. Avl Lmt INR 50,000.00')
			)?.merchantText
		).toBe('NETFLIX');
		expect(
			parseCapturedMessage(sms('Rs.399.00 debited from A/c XX1234 on 05-10-26. Info: SPOTIFY.'))
				?.merchantText
		).toBe('SPOTIFY');
		expect(
			parseCapturedMessage(sms('Rs.299.00 debited from A/c XX1234 towards AMAZON PRIME'))
				?.merchantText
		).toBe('AMAZON PRIME');
	});

	it('does not take a link or a time of day for a merchant', () => {
		expect(
			parseCapturedMessage(
				sms(
					'Rs.1,299.00 spent on SBI Card ending 1234 at AMAZON on 05-10-26. Report at https://sbicard.com/dispute'
				)
			)?.merchantText
		).toBe('AMAZON');
		expect(
			parseCapturedMessage(sms('Rs.800.00 spent on Amex Card XX1001 on 05-10-26 at 12:34 PM IST'))
				?.merchantText
		).toBeNull();
	});

	it('keeps a merchant that merely starts like a weekday or month', () => {
		expect(
			parseCapturedMessage(sms('Rs.300.00 spent on Credit Card XX1234 at Sun Pharma'))?.merchantText
		).toBe('Sun Pharma');
	});
});
