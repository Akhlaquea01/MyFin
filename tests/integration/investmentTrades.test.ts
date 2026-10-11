import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository
} from '../../src/data/dexie/wealthRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import {
	computeNetWorth,
	editHolding,
	recordPurchase,
	recordSale,
	recordValuation,
	undoLatestTrade
} from '../../src/domain/wealth/wealthEngine';
import { todayLocalISO } from '../../src/domain/shared/dateMath';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// A trade can post its money to an account in the same step, tied to the holding so the two cannot
// drift apart, and the latest one can be undone.
describe('investment trades that move money', () => {
	let key: CryptoKey;
	let checkingId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8989', randomSaltBase64());
		checkingId = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 1_000_000, // 10,000.00
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
	});
	afterEach(() => vi.restoreAllMocks());

	const balance = async (id = checkingId) =>
		(await AccountRepository.getById(key, id))!.currentBalance;
	const holding = () =>
		InvestmentHoldingRepository.create(key, {
			name: 'BEL',
			type: 'stock',
			units: 10,
			avgPrice: 10_000, // 100.00
			costBasis: 100_000
		});
	const fresh = async (id: string) => (await InvestmentHoldingRepository.getById(key, id))!;

	describe('buying', () => {
		it('takes the cost out of the account and puts the units on the holding, in one step', async () => {
			const h = await holding();
			const bought = await recordPurchase(key, h.id, {
				units: 5,
				price: 12_000,
				date: '2026-03-04',
				accountId: checkingId
			});

			expect(bought.units).toBe(15);
			expect(await balance()).toBe(1_000_000 - 60_000);

			const [trade] = bought.trades!;
			expect(trade).toMatchObject({
				kind: 'buy',
				units: 5,
				price: 12_000,
				amount: 60_000,
				date: '2026-03-04',
				accountId: checkingId
			});
			const entry = await TransactionRepository.getById(key, trade.transactionId!);
			expect(entry).toMatchObject({
				accountId: checkingId,
				amount: -60_000,
				type: 'transfer', // money between the account and something owned: not spending
				transferPairId: null,
				date: '2026-03-04',
				notes: 'Bought 5 units of BEL',
				reviewStatus: 'confirmed'
			});
		});

		it('leaves net worth where it was - cash down, holding up', async () => {
			const h = await holding();
			const before = (await computeNetWorth(key)).netWorth;
			const bought = await recordPurchase(key, h.id, {
				units: 5,
				price: 12_000,
				accountId: checkingId
			});
			// The holding's cost basis is units × its average price, and the average is kept to whole
			// paise, so it can differ from the money actually spent by up to half a paisa per unit.
			const drift = Math.abs((await computeNetWorth(key)).netWorth - before);
			expect(drift).toBeLessThanOrEqual(Math.ceil(bought.units! / 2));
		});

		it('records the trade on the holding alone when no account is given', async () => {
			const h = await holding();
			const bought = await recordPurchase(key, h.id, { units: 5, price: 12_000 });
			expect(bought.trades).toHaveLength(1);
			expect(bought.trades![0]).toMatchObject({ accountId: null, transactionId: null });
			expect(await balance()).toBe(1_000_000);
			expect(await TransactionRepository.search(key, { accountId: checkingId })).toEqual([]);
		});

		it('refuses a credit card or an unknown account, changing nothing', async () => {
			const h = await holding();
			const card = await AccountRepository.create(key, {
				name: 'Card',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: 500_000,
				billingCycleDay: 5
			});
			await expect(
				recordPurchase(key, h.id, { units: 5, price: 12_000, accountId: card.id })
			).rejects.toThrow(/credit card/);
			await expect(
				recordPurchase(key, h.id, { units: 5, price: 12_000, accountId: 'missing' })
			).rejects.toThrow(/Account not found/);
			expect((await fresh(h.id)).units).toBe(10);
			expect(await balance(card.id)).toBe(0);
		});

		it('puts everything back if the holding cannot be updated after the money has moved', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: todayLocalISO(), value: 150_000 });
			vi.spyOn(InvestmentHoldingRepository, 'update').mockRejectedValueOnce(new Error('disk full'));

			await expect(
				recordPurchase(key, h.id, { units: 5, price: 12_000, accountId: checkingId })
			).rejects.toThrow('disk full');

			expect(await balance()).toBe(1_000_000); // the account entry was withdrawn
			expect((await InvestmentValuationRepository.listForHolding(key, h.id))[0].value).toBe(
				150_000
			);
			expect((await fresh(h.id)).units).toBe(10);
		});
	});

	describe('selling', () => {
		it('adds the proceeds to the account', async () => {
			const h = await holding();
			const sold = await recordSale(key, h.id, {
				units: 4,
				price: 15_000,
				date: '2026-03-05',
				accountId: checkingId
			});
			expect(sold.units).toBe(6);
			expect(await balance()).toBe(1_000_000 + 60_000);
			const entry = await TransactionRepository.getById(key, sold.trades![0].transactionId!);
			expect(entry).toMatchObject({
				amount: 60_000,
				type: 'transfer',
				notes: 'Sold 4 units of BEL'
			});
		});

		it('needs a price to know how much arrives, and changes nothing without one', async () => {
			const h = await holding();
			await expect(recordSale(key, h.id, { units: 4, accountId: checkingId })).rejects.toThrow(
				/sale price/
			);
			await expect(
				recordSale(key, h.id, { units: 4, price: 0, accountId: checkingId })
			).rejects.toThrow(/sale price/);
			expect((await fresh(h.id)).units).toBe(10);
			expect(await balance()).toBe(1_000_000);
		});

		it('records a sale on the holding alone, with or without a price', async () => {
			const h = await holding();
			const first = await recordSale(key, h.id, { units: 2 });
			expect(first.trades![0]).toMatchObject({ price: null, amount: null, transactionId: null });
			const second = await recordSale(key, h.id, { units: 1, price: 15_000 });
			expect(second.trades![1]).toMatchObject({
				price: 15_000,
				amount: 15_000,
				transactionId: null
			});
			expect(await balance()).toBe(1_000_000);
		});
	});

	describe('the entry it posts', () => {
		it('is tied to the holding, so it cannot be edited or deleted on its own', async () => {
			const h = await holding();
			const bought = await recordPurchase(key, h.id, {
				units: 5,
				price: 12_000,
				accountId: checkingId
			});
			const txId = bought.trades![0].transactionId!;

			expect(await TransactionRepository.getLoanLink(key, txId)).toEqual({
				kind: 'investment-trade',
				holdingId: h.id
			});
			// And so it cannot be permanently deleted from Trash either.
			await TransactionEngine.deleteTransaction(key, txId);
			await expect(TransactionRepository.purge(key, txId)).rejects.toThrow(
				/investment purchase or sale/
			);
		});

		it('is an ordinary entry again once the trade list is cleared by editing the numbers', async () => {
			const h = await holding();
			const bought = await recordPurchase(key, h.id, {
				units: 5,
				price: 12_000,
				accountId: checkingId
			});
			const txId = bought.trades![0].transactionId!;

			await editHolding(key, h.id, { name: 'BEL', type: 'stock', units: 14, avgPrice: 10_500 });

			expect((await fresh(h.id)).trades).toEqual([]);
			expect(await TransactionRepository.getLoanLink(key, txId)).toBeNull();
		});

		it('keeps the trade list when only the name or type is edited', async () => {
			const h = await holding();
			const bought = await recordPurchase(key, h.id, { units: 5, price: 12_000 });
			await editHolding(key, h.id, {
				name: 'Bharat Electronics',
				type: 'etf',
				units: bought.units!,
				avgPrice: bought.avgPrice!
			});
			expect((await fresh(h.id)).trades).toHaveLength(1);
		});
	});

	describe('undoLatestTrade', () => {
		it('reverses a purchase: units, price, cost basis, the account and the recorded value', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: todayLocalISO(), value: 150_000 });
			const before = await fresh(h.id);
			const bought = await recordPurchase(key, h.id, {
				units: 5,
				price: 12_000,
				accountId: checkingId
			});
			expect((await InvestmentValuationRepository.listForHolding(key, h.id))[0].value).toBe(
				210_000
			);

			const undone = await undoLatestTrade(key, h.id, bought.trades![0].id);

			expect(undone).toMatchObject({
				units: before.units,
				avgPrice: before.avgPrice,
				costBasis: before.costBasis,
				trades: []
			});
			expect(await balance()).toBe(1_000_000);
			expect((await InvestmentValuationRepository.listForHolding(key, h.id))[0].value).toBe(
				150_000
			);
		});

		it('reverses a sale that took the value to nothing', async () => {
			const h = await holding();
			await recordValuation(key, h.id, { date: '2026-01-01', value: 150_000 });
			const sold = await recordSale(key, h.id, {
				units: 10,
				price: 15_000,
				accountId: checkingId
			});
			expect(await balance()).toBe(1_000_000 + 150_000);
			// The sale added a dated point (the latest value was older), at zero.
			expect((await InvestmentValuationRepository.listForHolding(key, h.id))[0].value).toBe(0);

			const undone = await undoLatestTrade(key, h.id, sold.trades![0].id);

			expect(undone.units).toBe(10);
			expect(await balance()).toBe(1_000_000);
			// The point it added is gone again; the value the user recorded is back in charge.
			const history = await InvestmentValuationRepository.listForHolding(key, h.id);
			expect(history.map((v) => [v.date, v.value])).toEqual([['2026-01-01', 150_000]]);
		});

		it('puts a legacy holding back to having no unit data at all', async () => {
			const legacy = await InvestmentHoldingRepository.create(key, {
				name: 'Old gold',
				type: 'other',
				costBasis: 50_000
			});
			const bought = await recordPurchase(key, legacy.id, { units: 1, price: 20_000 });
			expect(bought.units).toBe(1);

			const undone = await undoLatestTrade(key, legacy.id, bought.trades![0].id);
			expect(undone.units).toBeUndefined();
			expect(undone.avgPrice).toBeUndefined();
			expect(undone.costBasis).toBe(50_000);
		});

		it('works for a trade recorded on the holding alone', async () => {
			const h = await holding();
			const sold = await recordSale(key, h.id, { units: 3 });
			const undone = await undoLatestTrade(key, h.id, sold.trades![0].id);
			expect(undone.units).toBe(10);
		});

		it('only reverses the latest trade, and says so', async () => {
			const h = await holding();
			const first = await recordPurchase(key, h.id, { units: 1, price: 11_000 });
			await recordPurchase(key, h.id, { units: 1, price: 12_000 });

			await expect(undoLatestTrade(key, h.id, first.trades![0].id)).rejects.toThrow(
				/most recent trade/
			);
			await expect(undoLatestTrade(key, h.id, 'missing')).rejects.toThrow(/Trade not found/);
			expect((await fresh(h.id)).trades).toHaveLength(2);
		});

		it('can then undo the one before it', async () => {
			const h = await holding();
			const first = await recordPurchase(key, h.id, { units: 1, price: 11_000 });
			const second = await recordPurchase(key, h.id, { units: 1, price: 12_000 });
			await undoLatestTrade(key, h.id, second.trades![1].id);
			const undone = await undoLatestTrade(key, h.id, first.trades![0].id);
			expect(undone).toMatchObject({ units: 10, avgPrice: 10_000, trades: [] });
		});

		it('puts the account entry back if the holding cannot be restored', async () => {
			const h = await holding();
			const bought = await recordPurchase(key, h.id, {
				units: 5,
				price: 12_000,
				accountId: checkingId
			});
			vi.spyOn(InvestmentHoldingRepository, 'update').mockRejectedValueOnce(new Error('disk full'));

			await expect(undoLatestTrade(key, h.id, bought.trades![0].id)).rejects.toThrow('disk full');

			expect(await balance()).toBe(1_000_000 - 60_000); // the money is still out, as the holding says
			expect((await fresh(h.id)).trades).toHaveLength(1);
		});
	});
});
