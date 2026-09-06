import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository,
	LiabilityRepository
} from '../../src/data/dexie/wealthRepository';
import {
	computeNetWorth,
	recordNetWorthSnapshot,
	netWorthHistory
} from '../../src/domain/wealth/wealthEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Wealth engine', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('1111', randomSaltBase64());
	});

	it('computes net worth as cash + investments - liabilities', async () => {
		await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const holding = await InvestmentHoldingRepository.create(key, {
			name: 'Index Fund',
			type: 'mutual fund',
			costBasis: 50000
		});
		await InvestmentValuationRepository.create(key, {
			holdingId: holding.id,
			date: '2026-03-01',
			value: 60000
		});
		await LiabilityRepository.create(key, {
			name: 'Car Loan',
			type: 'loan',
			outstandingBalance: 30000,
			emiAmount: null,
			emiDueDay: null
		});

		const breakdown = await computeNetWorth(key);
		expect(breakdown.cashBalance).toBe(100000);
		expect(breakdown.investmentValue).toBe(60000);
		expect(breakdown.totalAssets).toBe(160000);
		expect(breakdown.totalLiabilities).toBe(30000);
		expect(breakdown.netWorth).toBe(130000);
	});

	it('falls back to cost basis for a holding with no recorded valuation yet', async () => {
		await InvestmentHoldingRepository.create(key, {
			name: 'Gold',
			type: 'gold',
			costBasis: 20000
		});
		const breakdown = await computeNetWorth(key);
		expect(breakdown.investmentValue).toBe(20000);
	});

	it('records and lists net worth history sorted oldest to newest', async () => {
		await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 10000,
			creditLimit: null,
			billingCycleDay: null
		});
		await recordNetWorthSnapshot(key, '2026-02-01');
		await recordNetWorthSnapshot(key, '2026-01-01');

		const history = await netWorthHistory(key);
		expect(history.map((s) => s.date)).toEqual(['2026-01-01', '2026-02-01']);
		expect(history[0].netWorth).toBe(10000);
	});
});
