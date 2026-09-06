import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { DebtPlannerPreferenceRepository } from '../../src/data/dexie/debtPlannerPreferenceRepository';
import {
	SavingsGoalRepository,
	GoalContributionRepository
} from '../../src/data/dexie/savingsGoalRepository';
import {
	NotificationPreferenceRepository,
	NotifiedItemRepository
} from '../../src/data/dexie/notificationRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { AttachmentRepository } from '../../src/data/dexie/attachmentRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { CategorizationRuleRepository } from '../../src/data/dexie/categorizationRuleRepository';
import { MerchantCategorySignalRepository } from '../../src/data/dexie/merchantCategorySignalRepository';
import { recordConfirmation } from '../../src/domain/categorization/resolveCategorization';
import {
	createBackup,
	validateAndDecryptBackup,
	restoreBackup,
	BackupValidationError,
	CURRENT_SCHEMA_VERSION,
	type BackupFile
} from '../../src/data/io/backupService';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64,
	encrypt,
	sha256Hex
} from '../../src/data/crypto/cryptoService';

describe('Backup service', () => {
	const pin = '2468';
	let key: CryptoKey;
	let encryptionSalt: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		encryptionSalt = randomSaltBase64();
		key = await deriveEncryptionKey(pin, encryptionSalt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 10000,
			creditLimit: null,
			billingCycleDay: null
		});
		const transaction = await TransactionRepository.create(
			key,
			{ accountId: account.id, date: '2026-01-01', amount: -500, type: 'expense' },
			[]
		);
		await AttachmentRepository.create(key, {
			transactionId: transaction.id,
			mimeType: 'image/jpeg',
			data: 'ZmFrZS1yZWNlaXB0',
			sizeBytes: 12
		});
		await DebtPlannerPreferenceRepository.save(key, {
			strategy: 'snowball',
			extraMonthlyPayment: 150
		});
		const goal = await SavingsGoalRepository.create(key, {
			name: 'Emergency fund',
			targetAmount: 5000,
			targetDate: null
		});
		await GoalContributionRepository.create(key, {
			goalId: goal.id,
			amount: 200,
			date: '2026-01-01'
		});
		await NotificationPreferenceRepository.save(key, { enabled: false, reminderLeadDays: 3 });
		await NotifiedItemRepository.create(key, { key: 'budget:groceries:2026-01' });
		const merchant = await MerchantRepository.create(key, 'Starbucks');
		const category = await CategoryRepository.create(key, { name: 'Dining' });
		await CategorizationRuleRepository.create(key, {
			merchantId: merchant.id,
			categoryId: category.id,
			tagIds: []
		});
		await recordConfirmation(key, merchant.id, category.id);
	});

	it('encodes a checksummed, versioned backup carrying the current schema version', async () => {
		const backup = await createBackup(key, encryptionSalt);
		expect(backup.container).toBe('personal-finance-manager-backup');
		expect(backup.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(backup.checksum).toMatch(/^[0-9a-f]{64}$/);
		expect(backup.kdf.salt).toBe(encryptionSalt);
	});

	it('decodes a backup with the correct PIN and recovers the exported entities', async () => {
		const backup = await createBackup(key, encryptionSalt);
		const { payload } = await validateAndDecryptBackup(backup, pin);
		expect(payload.exportedEntities.accounts).toHaveLength(1);
		expect(payload.exportedEntities.accounts[0].name).toBe('Checking');
		expect(payload.exportedEntities.userProfile?.encryptionSalt).toBe(encryptionSalt);
		expect(payload.exportedEntities.debtPlannerPreference?.strategy).toBe('snowball');
		expect(payload.exportedEntities.savingsGoals).toHaveLength(1);
		expect(payload.exportedEntities.savingsGoals[0].name).toBe('Emergency fund');
		expect(payload.exportedEntities.goalContributions).toHaveLength(1);
		expect(payload.exportedEntities.goalContributions[0].amount).toBe(200);
		expect(payload.exportedEntities.notificationPreference?.enabled).toBe(false);
		expect(payload.exportedEntities.notifiedItems).toHaveLength(1);
		expect(payload.exportedEntities.notifiedItems[0].key).toBe('budget:groceries:2026-01');
		expect(payload.exportedEntities.transactions).toHaveLength(1);
		expect(payload.exportedEntities.attachments).toHaveLength(1);
		expect(payload.exportedEntities.attachments[0].mimeType).toBe('image/jpeg');
		expect(payload.exportedEntities.attachments[0].data).toBe('ZmFrZS1yZWNlaXB0');
		expect(payload.exportedEntities.categorizationRules).toHaveLength(1);
		expect(payload.exportedEntities.merchantCategorySignals).toHaveLength(1);
		expect(payload.exportedEntities.merchantCategorySignals[0].recentCategoryIds).toHaveLength(1);
	});

	it('rejects a backup opened with the wrong PIN', async () => {
		const backup = await createBackup(key, encryptionSalt);
		await expect(validateAndDecryptBackup(backup, '0000')).rejects.toThrow(BackupValidationError);
	});

	it('rejects a corrupted backup via checksum verification, without touching existing data', async () => {
		const backup = await createBackup(key, encryptionSalt);
		const corrupted: BackupFile = { ...backup, checksum: '0'.repeat(64) };
		await expect(validateAndDecryptBackup(corrupted, pin)).rejects.toThrow(BackupValidationError);
	});

	it('rejects a backup from an unrecognized container', async () => {
		const backup = await createBackup(key, encryptionSalt);
		const bogus: BackupFile = { ...backup, container: 'not-myfin' };
		await expect(validateAndDecryptBackup(bogus, pin)).rejects.toThrow(BackupValidationError);
	});

	it('rejects a backup whose decrypted payload carries an unsupported schema version', async () => {
		const futurePayload = {
			schemaVersion: '99.0.0',
			exportedEntities: {
				accounts: [],
				categories: [],
				merchants: [],
				merchantAliases: [],
				tags: [],
				transactions: [],
				transactionSplits: [],
				transactionTags: [],
				budgets: [],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				investmentHoldings: [],
				investmentValuations: [],
				liabilities: [],
				netWorthSnapshots: [],
				userProfile: null
			}
		};
		const checksum = await sha256Hex(JSON.stringify(futurePayload));
		const { iv, ciphertext } = await encrypt(key, futurePayload);
		const fromFuture: BackupFile = {
			container: 'personal-finance-manager-backup',
			containerVersion: 1,
			schemaVersion: '99.0.0',
			createdAt: new Date().toISOString(),
			checksum,
			kdf: { algorithm: 'PBKDF2-SHA256', iterations: 210_000, salt: encryptionSalt },
			cipher: { algorithm: 'AES-GCM', iv },
			ciphertext
		};
		await expect(validateAndDecryptBackup(fromFuture, pin)).rejects.toThrow(BackupValidationError);
	});

	it('migrates a pre-002/003/004 (v1.0.0) backup forward, defaulting the newer tables to empty', async () => {
		// Simulates a backup made before debtPlannerPreferences/savingsGoals/goalContributions/
		// notificationPreferences/notifiedItems existed: those keys are simply absent.
		const legacyPayload = {
			schemaVersion: '1.0.0',
			exportedEntities: {
				accounts: [],
				categories: [],
				merchants: [],
				merchantAliases: [],
				tags: [],
				transactions: [],
				transactionSplits: [],
				transactionTags: [],
				budgets: [],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				investmentHoldings: [],
				investmentValuations: [],
				liabilities: [],
				netWorthSnapshots: [],
				userProfile: null
			}
		};
		const checksum = await sha256Hex(JSON.stringify(legacyPayload));
		const { iv, ciphertext } = await encrypt(key, legacyPayload);
		const legacyBackup: BackupFile = {
			container: 'personal-finance-manager-backup',
			containerVersion: 1,
			schemaVersion: '1.0.0',
			createdAt: new Date().toISOString(),
			checksum,
			kdf: { algorithm: 'PBKDF2-SHA256', iterations: 210_000, salt: encryptionSalt },
			cipher: { algorithm: 'AES-GCM', iv },
			ciphertext
		};

		const { payload, key: restoreKey } = await validateAndDecryptBackup(legacyBackup, pin);
		expect(payload.exportedEntities.debtPlannerPreference).toBeNull();
		expect(payload.exportedEntities.savingsGoals).toEqual([]);
		expect(payload.exportedEntities.goalContributions).toEqual([]);
		expect(payload.exportedEntities.notificationPreference).toBeNull();
		expect(payload.exportedEntities.notifiedItems).toEqual([]);
		expect(payload.exportedEntities.attachments).toEqual([]);
		expect(payload.exportedEntities.categorizationRules).toEqual([]);
		expect(payload.exportedEntities.merchantCategorySignals).toEqual([]);

		await db.delete();
		await db.open();
		await expect(restoreBackup(restoreKey, payload)).resolves.not.toThrow();

		const pref = await DebtPlannerPreferenceRepository.get(restoreKey);
		expect(pref.strategy).toBe('avalanche');
		expect(await SavingsGoalRepository.list(restoreKey)).toHaveLength(0);
		const notificationPref = await NotificationPreferenceRepository.get(restoreKey);
		expect(notificationPref.enabled).toBe(true);
	});

	it('round-trips a full backup and restore, ending with an exact match', async () => {
		const backup = await createBackup(key, encryptionSalt);
		const { payload, key: restoreKey } = await validateAndDecryptBackup(backup, pin);

		await db.delete();
		await db.open();
		await restoreBackup(restoreKey, payload);

		const accounts = await AccountRepository.list(restoreKey);
		expect(accounts).toHaveLength(1);
		expect(accounts[0].name).toBe('Checking');
		expect(accounts[0].openingBalance).toBe(10000);
		const profile = await UserProfileRepository.get();
		expect(profile?.encryptionSalt).toBe(encryptionSalt);

		const pref = await DebtPlannerPreferenceRepository.get(restoreKey);
		expect(pref.strategy).toBe('snowball');
		expect(pref.extraMonthlyPayment).toBe(150);

		const goals = await SavingsGoalRepository.list(restoreKey);
		expect(goals).toHaveLength(1);
		expect(goals[0].name).toBe('Emergency fund');
		const contributions = await GoalContributionRepository.listForGoal(restoreKey, goals[0].id);
		expect(contributions).toHaveLength(1);
		expect(contributions[0].amount).toBe(200);

		const notificationPref = await NotificationPreferenceRepository.get(restoreKey);
		expect(notificationPref.enabled).toBe(false);
		expect(notificationPref.reminderLeadDays).toBe(3);
		expect(await NotifiedItemRepository.exists(restoreKey, 'budget:groceries:2026-01')).toBe(true);

		const restoredTransactions = await TransactionRepository.search(restoreKey);
		expect(restoredTransactions).toHaveLength(1);
		const restoredAttachments = await AttachmentRepository.listForTransaction(
			restoreKey,
			restoredTransactions[0].id
		);
		expect(restoredAttachments).toHaveLength(1);
		expect(restoredAttachments[0].mimeType).toBe('image/jpeg');
		expect(restoredAttachments[0].data).toBe('ZmFrZS1yZWNlaXB0');
		expect(restoredAttachments[0].sizeBytes).toBe(12);

		const restoredRules = await CategorizationRuleRepository.list(restoreKey);
		expect(restoredRules).toHaveLength(1);
		const restoredSignal = await MerchantCategorySignalRepository.get(
			restoreKey,
			restoredRules[0].merchantId
		);
		expect(restoredSignal?.recentCategoryIds).toEqual([restoredRules[0].categoryId]);
	});
});
