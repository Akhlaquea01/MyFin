import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository,
	LiabilityRepository,
	NetWorthSnapshotRepository
} from '../../src/data/dexie/wealthRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('WealthRepository (holdings, valuations, liabilities, snapshots) against Dexie', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('2323', randomSaltBase64());
	});

	it('creates and soft-deletes investment holdings', async () => {
		const holding = await InvestmentHoldingRepository.create(key, {
			name: 'Stocks',
			type: 'stock',
			costBasis: 1000
		});
		expect((await InvestmentHoldingRepository.list(key)).map((h) => h.id)).toContain(holding.id);

		await InvestmentHoldingRepository.softDelete(key, holding.id);
		expect((await InvestmentHoldingRepository.list(key)).map((h) => h.id)).not.toContain(
			holding.id
		);
	});

	it('lists valuations for a holding, newest first', async () => {
		const holding = await InvestmentHoldingRepository.create(key, {
			name: 'Stocks',
			type: 'stock',
			costBasis: 1000
		});
		await InvestmentValuationRepository.create(key, {
			holdingId: holding.id,
			date: '2026-01-01',
			value: 1100
		});
		await InvestmentValuationRepository.create(key, {
			holdingId: holding.id,
			date: '2026-02-01',
			value: 1200
		});

		const valuations = await InvestmentValuationRepository.listForHolding(key, holding.id);
		expect(valuations).toHaveLength(2);
		expect(valuations[0].date).toBe('2026-02-01');
	});

	it('creates, updates, and soft-deletes liabilities', async () => {
		const liability = await LiabilityRepository.create(key, {
			name: 'Credit Card',
			type: 'credit_card',
			outstandingBalance: 5000,
			emiAmount: null,
			emiDueDay: null
		});
		expect((await LiabilityRepository.list(key)).map((l) => l.id)).toContain(liability.id);

		const updated = await LiabilityRepository.update(key, liability.id, {
			outstandingBalance: 3000
		});
		expect(updated.outstandingBalance).toBe(3000);

		await LiabilityRepository.softDelete(key, liability.id);
		expect((await LiabilityRepository.list(key)).map((l) => l.id)).not.toContain(liability.id);
	});

	it('stores and lists net worth snapshots', async () => {
		await NetWorthSnapshotRepository.create(key, {
			date: '2026-01-01',
			totalAssets: 10000,
			totalLiabilities: 2000,
			netWorth: 8000
		});
		const history = await NetWorthSnapshotRepository.list(key);
		expect(history).toHaveLength(1);
		expect(history[0].netWorth).toBe(8000);
	});
});
