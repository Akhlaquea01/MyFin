import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { importDataTemplate } from '../../src/data/io/templateService';
import type { DataTemplate } from '../../src/data/io/templateTypes';
import {
	LiabilityRepository,
	InvestmentHoldingRepository
} from '../../src/data/dexie/wealthRepository';
import type { CaptureInfo } from '../../src/domain/entities';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

// A data template is how a ledger moves between devices. A captured entry must arrive still
// knowing when its message came in and what time it states, or the next copy of that message could
// not be told from a second payment.
describe('templateService - captured entries keep their message times', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		const encryptionSalt = randomSaltBase64();
		key = await deriveEncryptionKey('1234', encryptionSalt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin('1234', pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
	});

	it('imports the capture details of a transaction', async () => {
		const capture: CaptureInfo = {
			channel: 'sms',
			sender: 'VM-HDFCBK',
			receivedAt: Date.UTC(2026, 9, 5, 13, 59, 33),
			txnAt: Date.UTC(2026, 9, 5, 13, 58, 0),
			msgHash: 'capture:abc',
			text: 'Rs.250.00 debited from A/c XX1234 to SWIGGY',
			refNo: '628123456789'
		};
		const template = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {
				accounts: [
					{
						id: 'old-acc-1',
						name: 'HDFC',
						type: 'bank',
						openingBalance: 100000,
						currentBalance: 100000,
						creditLimit: null,
						billingCycleDay: null,
						isArchived: false,
						createdAt: 1000,
						updatedAt: 1000
					}
				],
				categories: [],
				merchants: [],
				merchantAliases: [],
				tags: [],
				investmentHoldings: [],
				investmentValuations: [],
				liabilities: [],
				netWorthSnapshots: [],
				savingsGoals: [],
				goalContributions: [],
				budgets: [],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				categorizationRules: [],
				merchantCategorySignals: [],
				notificationPreference: null,
				debtPlannerPreference: null,
				transactions: [
					{
						id: 'old-tx-1',
						accountId: 'old-acc-1',
						date: '2026-10-05',
						amount: -25000,
						type: 'expense',
						transferPairId: null,
						merchantId: null,
						notes: null,
						source: 'sms_capture',
						reviewStatus: 'unreviewed',
						duplicateOfId: null,
						capture,
						createdAt: 1000,
						updatedAt: 1000
					}
				],
				transactionSplits: [],
				transactionTags: [],
				attachments: []
			}
		} as unknown as DataTemplate;

		const result = await importDataTemplate(key, template);
		expect(result.perEntity.transactions?.created).toBe(1);

		const accounts = await AccountRepository.list(key);
		const [tx] = await TransactionRepository.search(key, { accountId: accounts[0].id });
		expect(tx.capture).toEqual(capture);
	});
});

describe('templateService - the purpose tag', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		const encryptionSalt = randomSaltBase64();
		key = await deriveEncryptionKey('1234', encryptionSalt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin('1234', pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
	});

	it('keeps the tag, drops a debt link that cannot be rebuilt, remaps an investment, and moves no balance', async () => {
		const template = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {
				accounts: [
					{
						id: 'old-acc-1',
						name: 'HDFC',
						type: 'bank',
						openingBalance: 100000,
						currentBalance: 100000,
						creditLimit: null,
						billingCycleDay: null,
						isArchived: false,
						createdAt: 1000,
						updatedAt: 1000
					}
				],
				categories: [],
				merchants: [],
				merchantAliases: [],
				tags: [],
				investmentHoldings: [
					{
						id: 'old-h1',
						name: 'Coal India',
						type: 'stock',
						costBasis: 100000,
						createdAt: 1,
						updatedAt: 1
					}
				],
				investmentValuations: [],
				liabilities: [
					{
						id: 'old-l1',
						name: 'Car loan',
						type: 'loan',
						outstandingBalance: 480000,
						emiAmount: 20000,
						emiDueDay: 5,
						interestRate: null,
						minimumPayment: null,
						linkedAccountId: null,
						duplicateWarningDismissed: false,
						createdAt: 1,
						updatedAt: 1
					}
				],
				netWorthSnapshots: [],
				savingsGoals: [],
				goalContributions: [],
				budgets: [],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				categorizationRules: [],
				merchantCategorySignals: [],
				notificationPreference: null,
				debtPlannerPreference: null,
				transactions: [
					{
						id: 'old-tx-1',
						accountId: 'old-acc-1',
						date: '2026-03-05',
						amount: -20000,
						type: 'expense',
						transferPairId: null,
						merchantId: null,
						notes: 'EMI',
						source: 'manual',
						reviewStatus: 'confirmed',
						duplicateOfId: null,
						purpose: { kind: 'debt', targetId: 'old-l1' },
						createdAt: 1000,
						updatedAt: 1000
					},
					{
						id: 'old-tx-2',
						accountId: 'old-acc-1',
						date: '2026-03-06',
						amount: -50000,
						type: 'expense',
						transferPairId: null,
						merchantId: null,
						notes: 'SIP',
						source: 'manual',
						reviewStatus: 'confirmed',
						duplicateOfId: null,
						purpose: { kind: 'investment', targetId: 'old-h1' },
						createdAt: 1000,
						updatedAt: 1000
					}
				],
				transactionSplits: [],
				transactionTags: [],
				attachments: []
			}
		} as unknown as DataTemplate;

		await importDataTemplate(key, template);

		const accounts = await AccountRepository.list(key);
		const imported = await TransactionRepository.search(key, { accountId: accounts[0].id });
		const emi = imported.find((t) => t.notes === 'EMI')!;
		const sip = imported.find((t) => t.notes === 'SIP')!;
		expect(emi.purpose).toEqual({ kind: 'debt', targetId: null });
		const [holding] = await InvestmentHoldingRepository.list(key);
		expect(sip.purpose).toEqual({ kind: 'investment', targetId: holding.id });

		// The imported entry is a tag, not a second payment: the balance owed is what the file said.
		const [liability] = await LiabilityRepository.list(key);
		expect(liability.outstandingBalance).toBe(480000);
		expect(liability.payments ?? []).toHaveLength(0);
	});
});
