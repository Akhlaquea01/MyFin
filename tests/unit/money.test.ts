import { describe, it, expect } from 'vitest';
import {
	parseMoneyToMinorUnits,
	parseMoneyOrZero,
	isValidMoney,
	isPositiveMoney,
	isNonNegativeMoney,
	isNonZeroMoney,
	formatMinorUnits
} from '../../src/domain/shared/money';

// Constitution Principle VI: money is always an integer in the smallest currency unit.
// These tests pin the three failure modes of the `Math.round(parseFloat(v) * 100)` idiom
// this module replaces — see money.ts's header for why each one mattered.
describe('parseMoneyToMinorUnits', () => {
	it('parses plain decimal amounts exactly', () => {
		expect(parseMoneyToMinorUnits('0')).toBe(0);
		expect(parseMoneyToMinorUnits('1')).toBe(100);
		expect(parseMoneyToMinorUnits('1.5')).toBe(150);
		expect(parseMoneyToMinorUnits('1.50')).toBe(150);
		expect(parseMoneyToMinorUnits('0.07')).toBe(7);
		expect(parseMoneyToMinorUnits('1234.56')).toBe(123456);
	});

	it('keeps thousands separators instead of truncating at them (regression)', () => {
		// parseFloat('1,234.56') === 1, which silently stored ₹1,234.56 as ₹1.00.
		expect(parseMoneyToMinorUnits('1,234.56')).toBe(123456);
		expect(parseMoneyToMinorUnits('12,34,567.89')).toBe(123456789); // Indian grouping
		expect(parseMoneyToMinorUnits('1 234.56')).toBe(123456);
		expect(parseMoneyToMinorUnits('1_234.56')).toBe(123456);
	});

	it('is exact at half-subunit boundaries where float scaling loses a unit (regression)', () => {
		// Math.round(1.005 * 100) === 100 and Math.round(8.165 * 100) === 816.
		expect(parseMoneyToMinorUnits('1.005')).toBeNull(); // 3dp is not a valid paise amount
		expect(parseMoneyToMinorUnits('8.16')).toBe(816);
		expect(parseMoneyToMinorUnits('8.17')).toBe(817);
		// The classic float-error cases, entered at the precision the app actually accepts:
		for (const [input, expected] of [
			['0.29', 29],
			['1.15', 115],
			['2.675', null],
			['70.55', 7055],
			['1.145', null]
		] as const) {
			expect(parseMoneyToMinorUnits(input)).toBe(expected);
		}
	});

	it('rejects trailing and leading garbage instead of coercing it (regression)', () => {
		// parseFloat('50abc') === 50.
		expect(parseMoneyToMinorUnits('50abc')).toBeNull();
		expect(parseMoneyToMinorUnits('abc')).toBeNull();
		expect(parseMoneyToMinorUnits('₹50')).toBeNull();
		expect(parseMoneyToMinorUnits('$50')).toBeNull();
		expect(parseMoneyToMinorUnits('(500)')).toBeNull();
		expect(parseMoneyToMinorUnits('1.2.3')).toBeNull();
		expect(parseMoneyToMinorUnits('1e3')).toBeNull();
		expect(parseMoneyToMinorUnits('NaN')).toBeNull();
		expect(parseMoneyToMinorUnits('Infinity')).toBeNull();
	});

	it('rejects more precision than the currency has', () => {
		expect(parseMoneyToMinorUnits('1.234')).toBeNull();
		expect(parseMoneyToMinorUnits('0.001')).toBeNull();
	});

	it('handles signs and bare-edge forms', () => {
		expect(parseMoneyToMinorUnits('-5')).toBe(-500);
		expect(parseMoneyToMinorUnits('-0.01')).toBe(-1);
		expect(parseMoneyToMinorUnits('+5')).toBe(500);
		expect(parseMoneyToMinorUnits('.5')).toBe(50);
		expect(parseMoneyToMinorUnits('5.')).toBe(500);
		expect(parseMoneyToMinorUnits('-')).toBeNull();
		expect(parseMoneyToMinorUnits('.')).toBeNull();
		expect(parseMoneyToMinorUnits('')).toBeNull();
		expect(parseMoneyToMinorUnits('   ')).toBeNull();
	});

	it('handles null/undefined and non-finite numbers', () => {
		expect(parseMoneyToMinorUnits(null)).toBeNull();
		expect(parseMoneyToMinorUnits(undefined)).toBeNull();
		expect(parseMoneyToMinorUnits(Number.NaN)).toBeNull();
		expect(parseMoneyToMinorUnits(Number.POSITIVE_INFINITY)).toBeNull();
		expect(parseMoneyToMinorUnits(12.34)).toBe(1234);
		expect(parseMoneyToMinorUnits(0)).toBe(0);
	});

	it('rejects magnitudes beyond exact integer range', () => {
		expect(parseMoneyToMinorUnits('999999999999999999999')).toBeNull();
	});

	it('always returns a safe integer when it returns anything', () => {
		for (const input of ['0', '1', '1.5', '1,234.56', '-0.01', '.5', '99999.99']) {
			const result = parseMoneyToMinorUnits(input);
			expect(result).not.toBeNull();
			expect(Number.isSafeInteger(result)).toBe(true);
		}
	});
});

describe('money predicates', () => {
	it('isValidMoney accepts well-formed amounts only', () => {
		expect(isValidMoney('0')).toBe(true);
		expect(isValidMoney('1,234.56')).toBe(true);
		expect(isValidMoney('abc')).toBe(false);
		expect(isValidMoney('')).toBe(false);
	});

	it('isPositiveMoney rejects zero, negatives, and malformed input', () => {
		expect(isPositiveMoney('0.01')).toBe(true);
		expect(isPositiveMoney('0')).toBe(false);
		expect(isPositiveMoney('-1')).toBe(false);
		// The old `parseFloat(v) > 0` guard passed '1,234.56' by evaluating 1 > 0, letting
		// the corrupted value straight through validation.
		expect(isPositiveMoney('1,234.56')).toBe(true);
		expect(isPositiveMoney('abc')).toBe(false);
	});

	it('isNonNegativeMoney allows zero but not negatives', () => {
		expect(isNonNegativeMoney('0')).toBe(true);
		expect(isNonNegativeMoney('-0.01')).toBe(false);
		expect(isNonNegativeMoney('abc')).toBe(false);
	});

	it('isNonZeroMoney allows negatives but not zero', () => {
		expect(isNonZeroMoney('-5')).toBe(true);
		expect(isNonZeroMoney('5')).toBe(true);
		expect(isNonZeroMoney('0')).toBe(false);
		expect(isNonZeroMoney('0.00')).toBe(false);
		expect(isNonZeroMoney('abc')).toBe(false);
	});

	it('parseMoneyOrZero collapses invalid input to zero', () => {
		expect(parseMoneyOrZero('12.34')).toBe(1234);
		expect(parseMoneyOrZero('abc')).toBe(0);
		expect(parseMoneyOrZero(null)).toBe(0);
	});
});

describe('formatMinorUnits', () => {
	it('renders minor units as an exact decimal string', () => {
		expect(formatMinorUnits(0)).toBe('0.00');
		expect(formatMinorUnits(7)).toBe('0.07');
		expect(formatMinorUnits(100)).toBe('1.00');
		expect(formatMinorUnits(123456)).toBe('1234.56');
		expect(formatMinorUnits(-1)).toBe('-0.01');
		expect(formatMinorUnits(-123456)).toBe('-1234.56');
	});

	it('round-trips with parseMoneyToMinorUnits', () => {
		for (const minor of [0, 1, 7, 100, 150, 123456, -1, -99999]) {
			expect(parseMoneyToMinorUnits(formatMinorUnits(minor))).toBe(minor);
		}
	});
});
