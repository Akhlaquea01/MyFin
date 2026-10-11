import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository
} from '../../src/data/dexie/wealthRepository';
import {
	computeNetWorth,
	recordPurchase,
	recordSale,
	recordValuation
} from '../../src/domain/wealth/wealthEngine';
import { todayLocalISO } from '../../src/domain/shared/dateMath';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// A recorded value is the whole holding's worth. Changing the units without moving it left it
// describing a holding that no longer existed.
describe('a holding’s recorded value follows its units', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8888', randomSaltBase64());
	});

	const holding = () =>
		InvestmentHoldingRepository.create(key, {
			name: 'BEL',
			type: 'stock',
			units: 10,
			avgPrice: 10_000, // 100.00 a unit
			costBasis: 100_000
		});
	const latest = async (id: string) =>
		(await InvestmentValuationRepository.listForHolding(key, id))[0];

	describe('selling', () => {
		it('shrinks the recorded value in proportion to the units that remain', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: todayLocalISO(), value: 150_000 });

			await recordSale(key, h.id, { units: 4 });
			expect((await latest(h.id)).value).toBe(90_000); // 6 of 10 units left

			await recordSale(key, h.id, { units: 3 });
			expect((await latest(h.id)).value).toBe(45_000); // 3 of the 6 that were left
		});

		it('takes the value to nothing, and out of net worth, when every unit is sold', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: todayLocalISO(), value: 150_000 });
			expect((await computeNetWorth(key)).investments.subtotal).toBe(150_000);

			await recordSale(key, h.id, { units: 10 });

			expect((await latest(h.id)).value).toBe(0);
			expect((await computeNetWorth(key)).investments.subtotal).toBe(0);
		});

		it('adjusts today’s value in place rather than adding another', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: todayLocalISO(), value: 150_000 });
			await recordSale(key, h.id, { units: 5 });
			expect(await InvestmentValuationRepository.listForHolding(key, h.id)).toHaveLength(1);
		});

		it('adds a dated point when the latest recorded value is older, keeping the history', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: '2026-01-01', value: 150_000 });
			await recordSale(key, h.id, { units: 5 });

			const history = await InvestmentValuationRepository.listForHolding(key, h.id);
			expect(history.map((v) => [v.date, v.value])).toEqual([
				[todayLocalISO(), 75_000],
				['2026-01-01', 150_000]
			]);
		});

		it('rounds to a whole minor unit', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: todayLocalISO(), value: 100_001 });
			await recordSale(key, h.id, { units: 3 });
			const value = (await latest(h.id)).value;
			expect(Number.isInteger(value)).toBe(true);
			expect(value).toBe(Math.round((100_001 * 7) / 10));
		});

		it('records nothing for a holding that has no recorded value — its cost basis follows the units', async () => {
			const h = await holding();
			const sold = await recordSale(key, h.id, { units: 4 });
			expect(await InvestmentValuationRepository.listForHolding(key, h.id)).toEqual([]);
			expect(await InvestmentValuationRepository.latestValue(key, sold)).toBe(60_000);
		});

		it('leaves everything alone when the sale is refused', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: todayLocalISO(), value: 150_000 });
			await expect(recordSale(key, h.id, { units: 11 })).rejects.toThrow(/more units/);
			expect((await latest(h.id)).value).toBe(150_000);
			expect((await InvestmentHoldingRepository.getById(key, h.id))?.units).toBe(10);
		});
	});

	describe('buying', () => {
		it('raises the recorded value by what the purchase cost, so it is not reported as a loss', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: todayLocalISO(), value: 150_000 });

			await recordPurchase(key, h.id, { units: 5, price: 12_000 }); // 600.00 spent

			expect((await latest(h.id)).value).toBe(210_000);
		});

		it('keeps the gain it had before the purchase', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: todayLocalISO(), value: 150_000 }); // +500.00 on 1,000.00
			const bought = await recordPurchase(key, h.id, { units: 5, price: 12_000 });

			const value = (await latest(h.id)).value;
			expect(value - bought.costBasis).toBeGreaterThanOrEqual(50_000 - 5); // still ~500.00 up
			expect(value - bought.costBasis).toBeLessThanOrEqual(50_000 + 5);
		});

		it('records nothing for a holding that has no recorded value', async () => {
			const h = await holding();
			await recordPurchase(key, h.id, { units: 5, price: 12_000 });
			expect(await InvestmentValuationRepository.listForHolding(key, h.id)).toEqual([]);
		});
	});

	it('does not change what the holding is worth when only its name is edited — values are untouched', async () => {
		const h = await holding();
		await recordValuation(key, h.id, { date: todayLocalISO(), value: 150_000 });
		await InvestmentHoldingRepository.update(key, h.id, { name: 'Bharat Electronics' });
		expect((await latest(h.id)).value).toBe(150_000);
	});
});
