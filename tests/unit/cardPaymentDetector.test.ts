import { describe, it, expect } from 'vitest';
import {
	detectCardPayment,
	looksLikeCardPayment
} from '../../src/domain/parser/cardPaymentDetector';

describe('detectCardPayment', () => {
	it.each([
		'Rs.5000 debited from A/c XX9999 towards credit card XX1234',
		'CREDIT CARD PAYMENT HDFC 4111',
		'NEFT/CC PAYMENT/ICICI',
		'BILLPAY ICICI CREDIT CARD 4321',
		'Paid card bill Rs 12,300',
		'Payment to your credit card ending 1234 was successful'
	])('recognises money leaving to pay a card: %s', (text) => {
		expect(detectCardPayment(text)).toBe('outgoing');
	});

	it.each([
		'Payment of Rs.5,000.00 received on your HDFC Bank Credit Card ending 1234',
		'PAYMENT RECEIVED - THANK YOU',
		'Thank you for your payment of Rs 2,000',
		'PAYMENT - THANK YOU'
	])('recognises a payment arriving on the card side: %s', (text) => {
		expect(detectCardPayment(text)).toBe('incoming');
	});

	it.each([
		// Ordinary purchases that merely mention a card or the word "payment".
		'Rs.500.00 debited from card ending 1234 to AMAZON',
		'Spent Rs.250 on your HDFC card ending 1234 at SWIGGY',
		'Payment of Rs.500 at AMAZON using card ending 1234',
		'UPI payment to Ramesh Rs 300',
		'Refund of Rs 120 credited to your card ending 1234',
		'Salary credited Rs 50,000'
	])('does not flag an ordinary transaction: %s', (text) => {
		expect(detectCardPayment(text)).toBeNull();
		expect(looksLikeCardPayment(text)).toBe(false);
	});

	it('treats empty input as not a card payment', () => {
		expect(detectCardPayment('')).toBeNull();
		expect(detectCardPayment(null)).toBeNull();
		expect(detectCardPayment(undefined)).toBeNull();
	});
});
