import { describe, it, expect } from 'vitest';
import { parseDateWithFormat } from '../../src/data/io/importService';
import { normalizeMerchantText } from '../../src/domain/parser/merchantResolver';

describe('parseDateWithFormat', () => {
	it('parses well-formed dates in the given format', () => {
		expect(parseDateWithFormat('06/09/2026', 'DD/MM/YYYY')).toBe('2026-09-06');
		expect(parseDateWithFormat('2026-09-06', 'YYYY-MM-DD')).toBe('2026-09-06');
		expect(parseDateWithFormat('09/06/2026', 'MM/DD/YYYY')).toBe('2026-09-06');
		expect(parseDateWithFormat('6/9/2026', 'DD/MM/YYYY')).toBe('2026-09-06');
	});

	/**
	 * Regression: validation was `new Date(iso)` plus a NaN check, but JS rolls impossible days
	 * forward rather than failing — `new Date('2026-02-31')` is 3 March. The bogus string was
	 * then stored verbatim in the indexed `date` column, so it sorted as the 31st while every
	 * downstream `new Date()` silently moved it into the next month, landing the transaction in
	 * the wrong budget period and the wrong analytics bucket.
	 */
	it('rejects calendar dates that do not exist', () => {
		expect(parseDateWithFormat('31/02/2026', 'DD/MM/YYYY')).toBeNull();
		expect(parseDateWithFormat('30/02/2026', 'DD/MM/YYYY')).toBeNull();
		expect(parseDateWithFormat('31/04/2026', 'DD/MM/YYYY')).toBeNull();
		expect(parseDateWithFormat('31/06/2026', 'DD/MM/YYYY')).toBeNull();
		expect(parseDateWithFormat('32/01/2026', 'DD/MM/YYYY')).toBeNull();
		expect(parseDateWithFormat('01/13/2026', 'DD/MM/YYYY')).toBeNull();
	});

	it('handles leap years correctly in both directions', () => {
		expect(parseDateWithFormat('29/02/2028', 'DD/MM/YYYY')).toBe('2028-02-29'); // leap
		expect(parseDateWithFormat('29/02/2026', 'DD/MM/YYYY')).toBeNull(); // not leap
	});

	it('rejects structurally wrong input', () => {
		expect(parseDateWithFormat('', 'DD/MM/YYYY')).toBeNull();
		expect(parseDateWithFormat('06/09', 'DD/MM/YYYY')).toBeNull();
		expect(parseDateWithFormat('ab/cd/efgh', 'DD/MM/YYYY')).toBeNull();
		expect(parseDateWithFormat('06/09/26', 'DD/MM/YYYY')).toBeNull(); // 2-digit year
	});
});

describe('normalizeMerchantText', () => {
	/**
	 * Regression: file import passed the raw description straight to `resolveMerchant`. Bank
	 * descriptions carry a per-transaction reference number, so every row was unique — a
	 * 2,000-row statement minted ~2,000 Merchants and ~2,000 MerchantAliases, which defeated the
	 * alias model entirely and made the per-merchant learning signal unable to ever reach a
	 * streak.
	 */
	it('collapses reference numbers so repeat visits converge on one merchant', () => {
		const first = normalizeMerchantText('UPI/DR/402913744/SWIGGY/HDFC');
		const second = normalizeMerchantText('UPI/DR/518220991/SWIGGY/HDFC');
		// Convergence is the property that matters — the two rows must resolve to the same
		// Merchant. This does not attempt to strip the counterparty bank, which would need a
		// bank-name list and would risk removing a real merchant that shares the name.
		expect(first).toBe(second);
		expect(first).toContain('SWIGGY');
		expect(first).not.toMatch(/\d/);
	});

	it('strips rails, dates, and punctuation', () => {
		expect(normalizeMerchantText('POS 12/08/2026 BIG BAZAAR')).toBe('BIG BAZAAR');
		expect(normalizeMerchantText('NEFT-AMAZON RETAIL')).toBe('AMAZON RETAIL');
		expect(normalizeMerchantText('  swiggy  ')).toBe('SWIGGY');
	});

	it('is case-insensitive in its output so aliases match', () => {
		expect(normalizeMerchantText('Swiggy')).toBe(normalizeMerchantText('SWIGGY'));
	});

	it('returns null rather than inventing a merchant from noise', () => {
		expect(normalizeMerchantText('402913744')).toBeNull();
		expect(normalizeMerchantText('UPI/DR/402913744')).toBeNull();
		expect(normalizeMerchantText('---')).toBeNull();
		expect(normalizeMerchantText('')).toBeNull();
		expect(normalizeMerchantText('ab')).toBeNull();
	});
});
