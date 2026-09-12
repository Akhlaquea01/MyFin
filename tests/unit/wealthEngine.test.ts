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
import { PersonRepository, PersonLoanRepository } from '../../src/data/dexie/personLoanRepository';

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

	// Feature 010, FR-014/SC-006: open lending/borrowing balances count as a receivable/payable
	// so cash moving in/out for a loan doesn't distort net worth (quickstart.md Scenario 8).
	it('nets an open "lent" loan back in as a receivable, leaving net worth unchanged', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Cash',
			type: 'cash',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const before = await computeNetWorth(key);

		const person = await PersonRepository.create(key, { name: 'Asha' });
		await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 20000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});

		const after = await computeNetWorth(key);
		expect(after.cashBalance).toBe(before.cashBalance - 20000);
		expect(after.totalAssets).toBe(before.totalAssets);
		expect(after.netWorth).toBe(before.netWorth);
	});

	it('nets an open "borrowed" loan back out as a payable, leaving net worth unchanged', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Cash',
			type: 'cash',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const before = await computeNetWorth(key);

		const person = await PersonRepository.create(key, { name: 'Rohit' });
		await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'borrowed',
			principalAmount: 15000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});

		const after = await computeNetWorth(key);
		expect(after.cashBalance).toBe(before.cashBalance + 15000);
		expect(after.totalLiabilities).toBe(before.totalLiabilities + 15000);
		expect(after.netWorth).toBe(before.netWorth);
	});

	it('writing off a lent loan decreases net worth by the forgiven amount', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Cash',
			type: 'cash',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const person = await PersonRepository.create(key, { name: 'Meera' });
		const loan = await PersonLoanRepository.create(key, {
			personId: person.id,
			direction: 'lent',
			principalAmount: 5000,
			date: '2026-09-01',
			dueDate: null,
			notes: null,
			accountId: account.id
		});
		const beforeWriteOff = await computeNetWorth(key);

		await PersonLoanRepository.writeOff(key, loan.id);
		const afterWriteOff = await computeNetWorth(key);
		expect(afterWriteOff.netWorth).toBe(beforeWriteOff.netWorth - 5000);
	});
});
