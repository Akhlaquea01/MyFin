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
});
