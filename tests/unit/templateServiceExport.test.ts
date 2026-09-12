import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	buildDataTemplate,
	exportDataTemplateToJsonBlob
} from '../../src/data/io/templateService';
import type { DataTemplate } from '../../src/data/io/templateTypes';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { MerchantRepository, MerchantAliasRepository } from '../../src/data/dexie/merchantRepository';
import { TagRepository, TransactionTagRepository } from '../../src/data/dexie/tagRepository';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository,
	LiabilityRepository,
	NetWorthSnapshotRepository
} from '../../src/data/dexie/wealthRepository';
import {
	SavingsGoalRepository,
	GoalContributionRepository
} from '../../src/data/dexie/savingsGoalRepository';
import { BudgetRepository, BudgetItemRepository } from '../../src/data/dexie/budgetRepository';
import { RecurringRepository, ExpectedEventRepository } from '../../src/data/dexie/recurringRepository';
import { CategorizationRuleRepository } from '../../src/data/dexie/categorizationRuleRepository';
import { MerchantCategorySignalRepository } from '../../src/data/dexie/merchantCategorySignalRepository';
import { NotificationPreferenceRepository } from '../../src/data/dexie/notificationRepository';
import { DebtPlannerPreferenceRepository } from '../../src/data/dexie/debtPlannerPreferenceRepository';
import {
	TransactionRepository,
	TransactionSplitRepository
} from '../../src/data/dexie/transactionRepository';
import { AttachmentRepository } from '../../src/data/dexie/attachmentRepository';
import {
	PersonRepository,
	PersonLoanRepository,
	LoanRepaymentRepository
} from '../../src/data/dexie/personLoanRepository';
import { SavedFilterViewRepository } from '../../src/data/dexie/savedFilterViewRepository';

describe('templateService - buildDataTemplate and exportDataTemplateToJsonBlob', () => {
	const mockKey = {} as CryptoKey;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('buildDataTemplate produces a valid container when the database is empty', async () => {
		vi.spyOn(AccountRepository, 'list').mockResolvedValue([]);
		vi.spyOn(CategoryRepository, 'list').mockResolvedValue([]);
		vi.spyOn(MerchantRepository, 'list').mockResolvedValue([]);
		vi.spyOn(MerchantAliasRepository, 'list').mockResolvedValue([]);
		vi.spyOn(TagRepository, 'list').mockResolvedValue([]);
		vi.spyOn(InvestmentHoldingRepository, 'list').mockResolvedValue([]);
		vi.spyOn(InvestmentValuationRepository, 'list').mockResolvedValue([]);
		vi.spyOn(LiabilityRepository, 'list').mockResolvedValue([]);
		vi.spyOn(NetWorthSnapshotRepository, 'list').mockResolvedValue([]);
		vi.spyOn(SavingsGoalRepository, 'list').mockResolvedValue([]);
		vi.spyOn(GoalContributionRepository, 'list').mockResolvedValue([]);
		vi.spyOn(BudgetRepository, 'list').mockResolvedValue([]);
		vi.spyOn(BudgetItemRepository, 'list').mockResolvedValue([]);
		vi.spyOn(RecurringRepository, 'list').mockResolvedValue([]);
		vi.spyOn(ExpectedEventRepository, 'listAll').mockResolvedValue([]);
		vi.spyOn(CategorizationRuleRepository, 'list').mockResolvedValue([]);
		vi.spyOn(MerchantCategorySignalRepository, 'listAll').mockResolvedValue([]);
		vi.spyOn(NotificationPreferenceRepository, 'get').mockResolvedValue(null as any);
		vi.spyOn(DebtPlannerPreferenceRepository, 'get').mockResolvedValue(null as any);
		vi.spyOn(TransactionRepository, 'search').mockResolvedValue([]);
		vi.spyOn(TransactionSplitRepository, 'listAll').mockResolvedValue([]);
		vi.spyOn(TransactionTagRepository, 'list').mockResolvedValue([]);
		vi.spyOn(AttachmentRepository, 'list').mockResolvedValue([]);
		vi.spyOn(PersonRepository, 'list').mockResolvedValue([]);
		vi.spyOn(PersonLoanRepository, 'listAllOpen').mockResolvedValue([]);
		vi.spyOn(LoanRepaymentRepository, 'listAll').mockResolvedValue([]);
		vi.spyOn(SavedFilterViewRepository, 'list').mockResolvedValue([]);

		const template = await buildDataTemplate(mockKey);

		expect(template.container).toBe('myfin-data-template');
		expect(template.templateVersion).toBe(1);
		expect(typeof template.exportedAt).toBe('string');
		expect(template.entities.accounts).toEqual([]);
		expect(template.entities.categories).toEqual([]);
		expect(template.entities.transactions).toEqual([]);
		expect(template.entities.notificationPreference).toBeNull();
		expect(template.entities.debtPlannerPreference).toBeNull();
	});

	it('buildDataTemplate never exports credentials, salts, or session keys', async () => {
		vi.spyOn(AccountRepository, 'list').mockResolvedValue([
			{
				id: 'acc-1',
				name: 'Checking',
				type: 'bank',
				openingBalance: 10000,
				currentBalance: 10000,
				creditLimit: null,
				billingCycleDay: null,
				isArchived: false,
				createdAt: 1000,
				updatedAt: 1000,
				deletedAt: null
			}
		]);
		vi.spyOn(CategoryRepository, 'list').mockResolvedValue([]);
		vi.spyOn(MerchantRepository, 'list').mockResolvedValue([]);
		vi.spyOn(MerchantAliasRepository, 'list').mockResolvedValue([]);
		vi.spyOn(TagRepository, 'list').mockResolvedValue([]);
		vi.spyOn(InvestmentHoldingRepository, 'list').mockResolvedValue([]);
		vi.spyOn(InvestmentValuationRepository, 'list').mockResolvedValue([]);
		vi.spyOn(LiabilityRepository, 'list').mockResolvedValue([]);
		vi.spyOn(NetWorthSnapshotRepository, 'list').mockResolvedValue([]);
		vi.spyOn(SavingsGoalRepository, 'list').mockResolvedValue([]);
		vi.spyOn(GoalContributionRepository, 'list').mockResolvedValue([]);
		vi.spyOn(BudgetRepository, 'list').mockResolvedValue([]);
		vi.spyOn(BudgetItemRepository, 'list').mockResolvedValue([]);
		vi.spyOn(RecurringRepository, 'list').mockResolvedValue([]);
		vi.spyOn(ExpectedEventRepository, 'listAll').mockResolvedValue([]);
		vi.spyOn(CategorizationRuleRepository, 'list').mockResolvedValue([]);
		vi.spyOn(MerchantCategorySignalRepository, 'listAll').mockResolvedValue([]);
		vi.spyOn(NotificationPreferenceRepository, 'get').mockResolvedValue(null as any);
		vi.spyOn(DebtPlannerPreferenceRepository, 'get').mockResolvedValue(null as any);
		vi.spyOn(TransactionRepository, 'search').mockResolvedValue([]);
		vi.spyOn(TransactionSplitRepository, 'listAll').mockResolvedValue([]);
		vi.spyOn(TransactionTagRepository, 'list').mockResolvedValue([]);
		vi.spyOn(AttachmentRepository, 'list').mockResolvedValue([]);
		vi.spyOn(PersonRepository, 'list').mockResolvedValue([]);
		vi.spyOn(PersonLoanRepository, 'listAllOpen').mockResolvedValue([]);
		vi.spyOn(LoanRepaymentRepository, 'listAll').mockResolvedValue([]);
		vi.spyOn(SavedFilterViewRepository, 'list').mockResolvedValue([]);

		const template = await buildDataTemplate(mockKey);
		const jsonString = JSON.stringify(template);

		expect(jsonString).not.toMatch(/pinVerifier/i);
		expect(jsonString).not.toMatch(/pinSalt/i);
		expect(jsonString).not.toMatch(/encryptionSalt/i);
		expect(jsonString).not.toMatch(/webauthn/i);
		expect(jsonString).not.toMatch(/sessionKey/i);
	});

	it('exportDataTemplateToJsonBlob returns a Blob with application/json MIME type and formatted JSON', async () => {
		const mockTemplate: DataTemplate = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: '2026-09-12T12:00:00.000Z',
			entities: {
				accounts: [],
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
				transactions: [],
				transactionSplits: [],
				transactionTags: [],
				attachments: []
			}
		};

		const blob = exportDataTemplateToJsonBlob(mockTemplate);
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe('application/json');

		const text = await blob.text();
		const parsed = JSON.parse(text);
		expect(parsed.container).toBe('myfin-data-template');
		expect(parsed.exportedAt).toBe(mockTemplate.exportedAt);
	});
});
