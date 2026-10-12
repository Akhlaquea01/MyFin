import { describe, it, expect } from 'vitest';
import { allocatedMinor, analyzeSplits } from '../../src/domain/transactions/splitInput';

describe('analyzeSplits', () => {
	it('is no split when nothing was entered', () => {
		expect(analyzeSplits([{ categoryId: '', amountInput: '' }], 100_00)).toEqual({
			ok: true,
			splits: []
		});
	});

	it('gives the whole total to a lone category with no amount (the category is not dropped)', () => {
		expect(analyzeSplits([{ categoryId: 'food', amountInput: '' }], 250_50)).toEqual({
			ok: true,
			splits: [{ categoryId: 'food', amount: 250_50 }]
		});
	});

	it('accepts amounts that add up to the total', () => {
		const result = analyzeSplits(
			[
				{ categoryId: 'food', amountInput: '60' },
				{ categoryId: 'fuel', amountInput: '40.00' }
			],
			100_00
		);
		expect(result).toEqual({
			ok: true,
			splits: [
				{ categoryId: 'food', amount: 60_00 },
				{ categoryId: 'fuel', amount: 40_00 }
			]
		});
	});

	it('says how much is left when the categories fall short — in rupees, not paise', () => {
		const result = analyzeSplits(
			[
				{ categoryId: 'food', amountInput: '400' },
				{ categoryId: 'fuel', amountInput: '100' }
			],
			1000_00
		);
		expect(result).toEqual({
			ok: false,
			message:
				'The categories add up to ₹500.00 but the total is ₹1,000.00 — ₹500.00 still to allocate.'
		});
	});

	it('says how much is too much when the categories exceed the total', () => {
		const result = analyzeSplits(
			[
				{ categoryId: 'food', amountInput: '700' },
				{ categoryId: 'fuel', amountInput: '400' }
			],
			1000_00
		);
		expect(result).toMatchObject({ ok: false });
		expect((result as { message: string }).message).toContain('₹100.00 too much');
	});

	it('rejects an amount with no category', () => {
		expect(
			analyzeSplits(
				[
					{ categoryId: 'food', amountInput: '50' },
					{ categoryId: '', amountInput: '50' }
				],
				100_00
			)
		).toMatchObject({ ok: false });
	});

	it('rejects a category with no amount when there is more than one row', () => {
		expect(
			analyzeSplits(
				[
					{ categoryId: 'food', amountInput: '' },
					{ categoryId: 'fuel', amountInput: '100' }
				],
				100_00
			)
		).toMatchObject({ ok: false });
	});

	it('rejects a lone amount with no category', () => {
		expect(analyzeSplits([{ categoryId: '', amountInput: '100' }], 100_00)).toMatchObject({
			ok: false
		});
	});
});

describe('allocatedMinor', () => {
	it('sums only well-formed positive amounts', () => {
		expect(
			allocatedMinor([
				{ categoryId: 'a', amountInput: '10.50' },
				{ categoryId: 'b', amountInput: 'abc' },
				{ categoryId: 'c', amountInput: '' },
				{ categoryId: 'd', amountInput: '4' }
			])
		).toBe(14_50);
	});
});
