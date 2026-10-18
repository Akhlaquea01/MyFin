import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository
} from '../../src/data/dexie/wealthRepository';
import {
	computeNetWorth,
	editHolding,
	recordPurchase,
	recordSale,
	recordValuation
} from '../../src/domain/wealth/wealthEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('correcting and removing investments', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8585', randomSaltBase64());
	});

	const newHolding = (overrides: Partial<{ name: string; units: number; avgPrice: number }> = {}) =>
		InvestmentHoldingRepository.create(key, {
			name: overrides.name ?? 'BEL',
			type: 'stock',
			units: overrides.units ?? 10,
			avgPrice: overrides.avgPrice ?? 10000,
			costBasis: Math.round((overrides.units ?? 10) * (overrides.avgPrice ?? 10000))
		});

	describe('editHolding', () => {
		it('corrects name, type, units and price, and the cost basis follows', async () => {
			const holding = await newHolding();
			const edited = await editHolding(key, holding.id, {
				name: '  Bharat Electronics ',
				type: 'etf',
				units: 12,
				avgPrice: 9550
			});
			expect(edited).toMatchObject({
				name: 'Bharat Electronics',
				type: 'etf',
				units: 12,
				avgPrice: 9550,
				costBasis: 114600
			});
			expect(await InvestmentHoldingRepository.getById(key, holding.id)).toMatchObject({
				name: 'Bharat Electronics',
				costBasis: 114600
			});
		});

		it('keeps the cost basis a whole number of minor units for fractional units', async () => {
			const holding = await newHolding();
			const edited = await editHolding(key, holding.id, {
				name: 'Fund',
				type: 'mutual_fund',
				units: 0.333,
				avgPrice: 10001
			});
			expect(Number.isInteger(edited.costBasis)).toBe(true);
			expect(edited.costBasis).toBe(Math.round(0.333 * 10001));
		});

		it('keeps an exact cost basis when only the name is changed', async () => {
			const exact = await InvestmentHoldingRepository.create(key, {
				name: 'Fund',
				type: 'mutual_fund',
				units: 10,
				avgPrice: 10_002, // 1,000.17 was paid in all, which 10 x 10,002 does not give
				costBasis: 100_017
			});

			const renamed = await editHolding(key, exact.id, {
				name: 'Fund (growth)',
				type: 'mutual_fund',
				units: 10,
				avgPrice: 10_002
			});

			expect(renamed.costBasis).toBe(100_017);
		});

		it('turns a legacy holding into one tracked in units, keeping its cost basis as entered', async () => {
			const legacy = await InvestmentHoldingRepository.create(key, {
				name: 'Old gold',
				type: 'other',
				costBasis: 50_000
			});
			const edited = await editHolding(key, legacy.id, {
				name: 'Old gold',
				type: 'other',
				costBasis: 50_000,
				units: 4
			});
			expect(edited).toMatchObject({ units: 4, avgPrice: 12_500, costBasis: 50_000 });
		});

		it('needs more than zero units to start tracking a legacy holding in units', async () => {
			const legacy = await InvestmentHoldingRepository.create(key, {
				name: 'Old gold',
				type: 'other',
				costBasis: 50_000
			});
			await expect(
				editHolding(key, legacy.id, {
					name: 'Old gold',
					type: 'other',
					costBasis: 50_000,
					units: 0
				})
			).rejects.toThrow(/units/i);
		});

		it('corrects a legacy holding that only has a cost basis', async () => {
			const legacy = await InvestmentHoldingRepository.create(key, {
				name: 'Old gold',
				type: 'other',
				costBasis: 50000
			});
			const edited = await editHolding(key, legacy.id, {
				name: 'Gold coins',
				type: 'other',
				costBasis: 65000
			});
			expect(edited.costBasis).toBe(65000);
			expect(edited.units).toBeUndefined();
			expect(edited.avgPrice).toBeUndefined();
		});

		it('refuses nonsense and leaves the holding as it was', async () => {
			const holding = await newHolding();
			const bad = [
				{ name: '   ', type: 'stock' as const, units: 1, avgPrice: 100 },
				{ name: 'X', type: 'stock' as const, units: -1, avgPrice: 100 },
				{ name: 'X', type: 'stock' as const, units: 1, avgPrice: -100 },
				{ name: 'X', type: 'stock' as const, units: Number.NaN, avgPrice: 100 }
			];
			for (const edit of bad) {
				await expect(editHolding(key, holding.id, edit)).rejects.toThrow();
			}
			await expect(
				editHolding(key, 'missing', { name: 'X', type: 'stock', units: 1, avgPrice: 1 })
			).rejects.toThrow(/not found/);
			expect(await InvestmentHoldingRepository.getById(key, holding.id)).toMatchObject({
				name: 'BEL',
				units: 10,
				avgPrice: 10000
			});
		});

		it('will not edit a holding that has been deleted', async () => {
			const holding = await newHolding();
			await InvestmentHoldingRepository.remove(holding.id);
			await expect(
				editHolding(key, holding.id, { name: 'X', type: 'stock', units: 1, avgPrice: 1 })
			).rejects.toThrow(/not found/);
		});
	});

	describe('cost basis after buying and selling fractional units', () => {
		it('stays a whole number of minor units', async () => {
			const holding = await newHolding({ units: 1.5, avgPrice: 3333 });
			const bought = await recordPurchase(key, holding.id, { units: 0.7, price: 3517 });
			expect(Number.isInteger(bought.costBasis)).toBe(true);
			const sold = await recordSale(key, holding.id, { units: 0.333 });
			expect(Number.isInteger(sold.costBasis)).toBe(true);
			expect(sold.costBasis).toBe(Math.round((sold.units ?? 0) * (sold.avgPrice ?? 0)));
		});
	});

	describe('recordValuation', () => {
		it('replaces the same day’s value instead of adding a second one', async () => {
			const holding = await newHolding();
			await recordValuation(key, holding.id, { date: '2026-03-01', value: 1_000_000 });
			// The typo is corrected by entering the value again.
			await recordValuation(key, holding.id, { date: '2026-03-01', value: 100_000 });

			const history = await InvestmentValuationRepository.listForHolding(key, holding.id);
			expect(history).toHaveLength(1);
			expect(history[0].value).toBe(100_000);
			expect(await InvestmentValuationRepository.latestValue(key, holding)).toBe(100_000);
		});

		it('keeps one value per day across days', async () => {
			const holding = await newHolding();
			await recordValuation(key, holding.id, { date: '2026-03-01', value: 100 });
			await recordValuation(key, holding.id, { date: '2026-03-02', value: 200 });
			const history = await InvestmentValuationRepository.listForHolding(key, holding.id);
			expect(history.map((v) => [v.date, v.value])).toEqual([
				['2026-03-02', 200],
				['2026-03-01', 100]
			]);
		});

		it('folds duplicate same-day values that older data may already hold', async () => {
			const holding = await newHolding();
			await InvestmentValuationRepository.create(key, {
				holdingId: holding.id,
				date: '2026-03-01',
				value: 111
			});
			await InvestmentValuationRepository.create(key, {
				holdingId: holding.id,
				date: '2026-03-01',
				value: 222
			});
			await recordValuation(key, holding.id, { date: '2026-03-01', value: 333 });
			const history = await InvestmentValuationRepository.listForHolding(key, holding.id);
			expect(history.map((v) => v.value)).toEqual([333]);
		});

		it('refuses a negative value, and a holding that is not there', async () => {
			const holding = await newHolding();
			await expect(
				recordValuation(key, holding.id, { date: '2026-03-01', value: -5 })
			).rejects.toThrow(/negative/);
			await expect(
				recordValuation(key, 'missing', { date: '2026-03-01', value: 5 })
			).rejects.toThrow(/not found/);
		});
	});

	describe('valuation order', () => {
		it('lets the value entered last win a tie on the same date', async () => {
			const holding = await newHolding();
			// Written straight to the repository, as older data would be.
			await InvestmentValuationRepository.create(key, {
				holdingId: holding.id,
				date: '2026-03-01',
				value: 111
			});
			await new Promise((resolve) => setTimeout(resolve, 5));
			await InvestmentValuationRepository.create(key, {
				holdingId: holding.id,
				date: '2026-03-01',
				value: 222
			});
			for (let i = 0; i < 5; i++) {
				expect(await InvestmentValuationRepository.latestValue(key, holding)).toBe(222);
			}
		});

		it('falls back to the previous value, then the cost basis, when the latest is deleted', async () => {
			const holding = await newHolding();
			await recordValuation(key, holding.id, { date: '2026-03-01', value: 120_000 });
			await recordValuation(key, holding.id, { date: '2026-03-02', value: 999_999 });

			const [latest] = await InvestmentValuationRepository.listForHolding(key, holding.id);
			await InvestmentValuationRepository.delete(latest.id);
			expect(await InvestmentValuationRepository.latestValue(key, holding)).toBe(120_000);

			const [only] = await InvestmentValuationRepository.listForHolding(key, holding.id);
			await InvestmentValuationRepository.delete(only.id);
			expect(await InvestmentValuationRepository.latestValue(key, holding)).toBe(holding.costBasis);
			expect(
				(await InvestmentValuationRepository.latestValueWithSource(key, holding)).isEstimate
			).toBe(true);
		});
	});

	describe('deleting a holding', () => {
		it('removes it from the list and from net worth, along with its recorded values', async () => {
			const holding = await newHolding();
			await recordValuation(key, holding.id, { date: '2026-03-01', value: 150_000 });
			expect((await computeNetWorth(key)).investments.subtotal).toBe(150_000);

			await InvestmentHoldingRepository.remove(holding.id);
			expect(await InvestmentHoldingRepository.list(key)).toEqual([]);
			expect((await computeNetWorth(key)).investments.subtotal).toBe(0);
			expect(await InvestmentValuationRepository.list(key)).toEqual([]);
		});
	});
});
