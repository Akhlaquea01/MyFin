import { describe, it, expect } from 'vitest';
import {
	parseQuickAddText,
	isConfident,
	CONFIDENCE_THRESHOLD
} from '../../src/domain/parser/quickAddParser';

describe('QuickAddParser', () => {
	it('extracts amount, merchant, and expense direction from a debit notification', () => {
		const result = parseQuickAddText(
			'Rs.500.00 debited from A/c XX1234 on 05-Jan-26 to AMAZON Ref No 123456'
		);
		expect(result.amount).toBe(50000);
		expect(result.type).toBe('expense');
		expect(result.merchantText).toBe('AMAZON');
		expect(isConfident(result)).toBe(true);
	});

	it('extracts amount and income direction from a credit notification', () => {
		const result = parseQuickAddText('Credited: Rs 5000 to your account XXXX1234 from John Doe');
		expect(result.amount).toBe(500000);
		expect(result.type).toBe('income');
		expect(result.merchantText).toBe('John Doe');
	});

	it('handles amount written after the currency-less number with INR suffix', () => {
		const result = parseQuickAddText('You have spent 1234.56 INR at Swiggy on your card');
		expect(result.amount).toBe(123456);
		expect(result.type).toBe('expense');
		expect(result.merchantText).toBe('Swiggy');
	});

	it('returns low confidence when no amount is found', () => {
		const result = parseQuickAddText('Thank you for shopping with us!');
		expect(result.amount).toBeNull();
		expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
		expect(isConfident(result)).toBe(false);
	});

	it('returns low confidence for amount-only text with no direction/merchant', () => {
		const result = parseQuickAddText('Rs.100');
		expect(result.amount).toBe(10000);
		expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
		expect(isConfident(result)).toBe(false);
	});

	it('is confident when amount and direction are both present, even without a merchant', () => {
		const result = parseQuickAddText('Rs.750 debited from your account');
		expect(result.amount).toBe(75000);
		expect(result.type).toBe('expense');
		expect(isConfident(result)).toBe(true);
	});

	describe('amount formats', () => {
		const amountOf = (text: string) => parseQuickAddText(text).amount;

		it.each([
			['₹500.00 debited from A/c XX1234 to AMAZON', 50000],
			['Spent ₹ 1,234.50 at SWIGGY', 123450],
			['₹1,23,456.78 credited to your account', 12345678],
			['Paid 750₹ to ZOMATO', 75000],
			['INR500 debited from your account', 50000],
			['Rs. 1,234 debited', 123400]
		])('reads the rupee sign and Rs/INR forms: %s', (text, expected) => {
			expect(amountOf(text)).toBe(expected);
		});

		it.each([
			['Your a/c is debited by 500.00 on 01-03-26 trf to ZOMATO', 50000],
			['A/c credited with 1,200 on 02-03-26 from JOHN', 120000],
			['Amount: 750 debited from account', 75000],
			['Txn of 99.50 on card ending 1234 at SPOTIFY. Amt spent 99.50', 9950]
		])('reads an amount that names no currency: %s', (text, expected) => {
			expect(amountOf(text)).toBe(expected);
		});

		it('does not mistake digits glued to an account tag for the amount', () => {
			// These used to be read as 1234.00 — a silently wrong amount.
			expect(amountOf('A/c XX1234 Rs.500.00 debited to AMAZON')).toBe(50000);
			expect(amountOf('Card 1234 Rs 500 spent at ZOMATO')).toBe(50000);
			expect(amountOf('Acct 98765 INR 1,200.00 credited')).toBe(120000);
		});

		it('does not mistake an account number or reference for an amount', () => {
			expect(amountOf('Debited from A/c 123456789012 on 01-03-26')).toBeNull();
			expect(amountOf('Ref No 123456 debited')).toBeNull();
			expect(amountOf('Your OTP is 482913')).toBeNull();
		});

		it('does not find "rs" inside a longer word', () => {
			expect(amountOf('Hours 500 worked today')).toBeNull();
			expect(amountOf('Transfers 100 pending')).toBeNull();
			// …but a real amount in the same message still wins.
			expect(amountOf('Hours worked 8, Rs.500 debited')).toBe(50000);
		});

		it('takes the transaction amount, not the balance that follows it', () => {
			expect(amountOf('Rs.500 debited. Avl Bal Rs.9,000.00')).toBe(50000);
			expect(amountOf('₹250 spent at SWIGGY. Avl bal ₹9,999.00')).toBe(25000);
			// A currency-less amount still comes before a later marked balance.
			expect(amountOf('Debited by 500.00 on 01-03. Avl Bal Rs.9,000.00')).toBe(50000);
		});

		it('keeps exact paise (no float scaling)', () => {
			expect(amountOf('₹8.165 debited')).toBeNull(); // three decimals is not a valid amount
			expect(amountOf('₹8.16 debited')).toBe(816);
			expect(amountOf('₹0.50 debited')).toBe(50);
		});

		it('still returns the direction and merchant alongside a rupee-sign amount', () => {
			const result = parseQuickAddText('₹500.00 debited from A/c XX1234 to AMAZON');
			expect(result.type).toBe('expense');
			expect(result.merchantText).toBe('AMAZON');
			expect(isConfident(result)).toBe(true);
		});
	});
});

describe('parseQuickAddText — date', () => {
	it('reads a day-first numeric date', () => {
		expect(parseQuickAddText('Rs.500 debited from A/c XX1234 on 12/10/2026 to AMAZON').date).toBe(
			'2026-10-12'
		);
	});

	it('reads a named-month date', () => {
		expect(parseQuickAddText('INR 250 spent at SWIGGY on 03-Oct-26').date).toBe('2026-10-03');
	});

	it('reads an ISO date', () => {
		expect(parseQuickAddText('Rs 99 paid to NETFLIX 2026-09-30').date).toBe('2026-09-30');
	});

	it('is null when the message states no date, or one that does not exist', () => {
		expect(parseQuickAddText('Rs.500 debited from A/c XX1234 to AMAZON').date).toBeNull();
		expect(parseQuickAddText('Rs.500 debited on 31/02/2026 to AMAZON').date).toBeNull();
	});

	it('does not change how confident the parse is', () => {
		const withDate = parseQuickAddText('Rs.500 debited to AMAZON on 12/10/2026');
		const without = parseQuickAddText('Rs.500 debited to AMAZON');
		expect(withDate.confidence).toBe(without.confidence);
	});
});
