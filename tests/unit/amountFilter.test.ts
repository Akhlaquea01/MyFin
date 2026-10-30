import { describe, expect, it } from 'vitest';
import { parseAmountRange, withinAmountRange } from '../../src/domain/transactions/amountFilter';

describe('parseAmountRange', () => {
	it('leaves a blank side open', () => {
		expect(parseAmountRange('', '')).toEqual({ ok: true, min: undefined, max: undefined });
		expect(parseAmountRange('500', '')).toEqual({ ok: true, min: 50000, max: undefined });
		expect(parseAmountRange('  ', '1,250.50')).toEqual({ ok: true, min: undefined, max: 125050 });
	});

	it('reads both sides in minor units', () => {
		expect(parseAmountRange('100', '200.5')).toEqual({ ok: true, min: 10000, max: 20050 });
		expect(parseAmountRange('0', '0')).toEqual({ ok: true, min: 0, max: 0 });
	});

	it('rejects text and says which box is wrong', () => {
		expect(parseAmountRange('abc', '')).toMatchObject({ ok: false, message: /minimum/ });
		expect(parseAmountRange('', '12.345')).toMatchObject({ ok: false, message: /maximum/ });
	});

	it('rejects a negative bound, since direction is not part of the filter', () => {
		expect(parseAmountRange('-50', '')).toMatchObject({ ok: false });
	});

	it('rejects a minimum above the maximum', () => {
		expect(parseAmountRange('500', '100')).toMatchObject({
			ok: false,
			message: 'The minimum amount is higher than the maximum.'
		});
	});
});

describe('withinAmountRange', () => {
	it('treats money in and money out alike and includes both bounds', () => {
		const range = { min: 10000, max: 20000 };
		expect(withinAmountRange(-15000, range)).toBe(true);
		expect(withinAmountRange(15000, range)).toBe(true);
		expect(withinAmountRange(-10000, range)).toBe(true);
		expect(withinAmountRange(20000, range)).toBe(true);
		expect(withinAmountRange(-9999, range)).toBe(false);
		expect(withinAmountRange(20001, range)).toBe(false);
	});

	it('is open on a side that has no bound', () => {
		expect(withinAmountRange(-1, {})).toBe(true);
		expect(withinAmountRange(5, { min: 6 })).toBe(false);
		expect(withinAmountRange(7, { max: 6 })).toBe(false);
	});
});
