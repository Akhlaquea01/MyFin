import { describe, it, expect } from 'vitest';
import { parseDateFromText, parseTimeFromText } from '../../src/domain/parser/dateText';

describe('parseTimeFromText', () => {
	it.each<[string, string | null]>([
		['INR 97.00 debited A/c XX0146 12-10-26, 19:29:33 UPI/P2M/548275113159/SHOP', '19:29'],
		['Spent Card no. XX5678 INR 1,299.00 05-10-26 14:22:10 AMAZON PAY', '14:22'],
		['Rs.800.00 spent at 12:34 PM IST', '12:34'],
		['Paid on 05-10-26 at 7:05pm', '19:05'],
		['Paid at 12:05 AM', '00:05'],
		['Paid at 12:05 PM', '12:05'],
		['Debited at 14:22 hrs', '14:22'],
		['Rs.12.30 debited', null],
		['ratio 1:1 of the amount', null],
		['clock 24:10', null],
		['Rs.500 debited from A/c XX1234', null]
	])('reads %s', (text, expected) => {
		expect(parseTimeFromText(text)).toBe(expected);
	});

	it('does not take the start of a merchant name for AM or PM', () => {
		expect(parseTimeFromText('Rs.1,299 14:22:10 AMAZON PAY')).toBe('14:22');
		expect(parseTimeFromText('Rs.99 at 9:15 PMC STORES')).toBe('09:15');
	});

	it('leaves the date reader alone', () => {
		expect(parseDateFromText('12-10-26, 19:29:33')).toBe('2026-10-12');
	});
});
