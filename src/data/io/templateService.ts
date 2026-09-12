import type {
	DataTemplate,
	ParseTemplateResult,
	TemplateImportResult,
	EntityImportStats,
	SkippedReason
} from './templateTypes';
import { AccountRepository } from '../dexie/accountRepository';
import { CategoryRepository } from '../dexie/categoryRepository';
import { MerchantRepository, MerchantAliasRepository } from '../dexie/merchantRepository';
import { TagRepository, TransactionTagRepository } from '../dexie/tagRepository';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository,
	LiabilityRepository,
	NetWorthSnapshotRepository
} from '../dexie/wealthRepository';
import {
	SavingsGoalRepository,
	GoalContributionRepository
} from '../dexie/savingsGoalRepository';
import { BudgetRepository, BudgetItemRepository } from '../dexie/budgetRepository';
import { RecurringRepository, ExpectedEventRepository } from '../dexie/recurringRepository';
import { CategorizationRuleRepository } from '../dexie/categorizationRuleRepository';
import { MerchantCategorySignalRepository } from '../dexie/merchantCategorySignalRepository';
import { NotificationPreferenceRepository } from '../dexie/notificationRepository';
import { DebtPlannerPreferenceRepository } from '../dexie/debtPlannerPreferenceRepository';
import {
	TransactionRepository,
	TransactionSplitRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../dexie/transactionRepository';
import { AttachmentRepository } from '../dexie/attachmentRepository';
import {
	PersonRepository,
	PersonLoanRepository,
	LoanRepaymentRepository
} from '../dexie/personLoanRepository';
import { SavedFilterViewRepository } from '../dexie/savedFilterViewRepository';
import { TransactionEngine } from '../../domain/transactions/transactionEngine';
import { duplicateKey, findDuplicateId } from './importService';

export const CURRENT_TEMPLATE_VERSION = 1;

/**
 * Parses raw JSON string into a validated DataTemplate object.
 * Returns an error object with a human-readable message if the file is invalid (FR-009).
 * Unknown extra fields are ignored for forward-compatibility.
 */
export function parseDataTemplate(raw: string): ParseTemplateResult {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { ok: false, message: 'Invalid JSON file: file could not be parsed.' };
	}

	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		return { ok: false, message: 'Invalid template format: root must be a JSON object.' };
	}

	const record = data as Record<string, unknown>;

	if (record.container !== 'myfin-data-template') {
		return {
			ok: false,
			message: 'Invalid template file: missing or incorrect "myfin-data-template" container header.'
		};
	}

	if (typeof record.templateVersion !== 'number' || record.templateVersion < 1) {
		return {
			ok: false,
			message: 'Unsupported template version: "templateVersion" must be a positive integer.'
		};
	}

	if (!record.entities || typeof record.entities !== 'object' || Array.isArray(record.entities)) {
		return {
			ok: false,
			message: 'Invalid template format: missing "entities" collection.'
		};
	}

	return {
		ok: true,
		template: data as DataTemplate
	};
}

/**
 * Builds an unencrypted, complete DataTemplate from current database records.
 * NEVER includes user security credentials (UserProfile, PIN, salts, biometric enrollments).
 * Excludes soft-deleted records (research.md §4).
 */
export async function buildDataTemplate(key: CryptoKey): Promise<DataTemplate> {
	const [
		accounts,
		categories,
		merchants,
		merchantAliases,
		tags,
		investmentHoldings,
		investmentValuations,
		liabilities,
		netWorthSnapshots,
		savingsGoals,
		goalContributions,
		budgets,
		budgetItems,
		recurringRules,
		expectedEvents,
		categorizationRulesWithStatus,
		merchantCategorySignals,
		notificationPreference,
		debtPlannerPreference,
		transactions,
		transactionSplits,
		transactionTags,
		attachments,
		people,
		personLoans,
		loanRepayments,
		savedFilterViews
	] = await Promise.all([
		AccountRepository.list(key),
		CategoryRepository.list(key),
		MerchantRepository.list(key),
		MerchantAliasRepository.list(key),
		TagRepository.list(key),
		InvestmentHoldingRepository.list(key),
		InvestmentValuationRepository.list(key),
		LiabilityRepository.list(key),
		NetWorthSnapshotRepository.list(key),
		SavingsGoalRepository.list(key),
		GoalContributionRepository.list(key),
		BudgetRepository.list(key),
		BudgetItemRepository.list(key),
		RecurringRepository.list(key),
		ExpectedEventRepository.listAll(key),
		CategorizationRuleRepository.list(key),
		MerchantCategorySignalRepository.listAll(key),
		NotificationPreferenceRepository.get(key),
		DebtPlannerPreferenceRepository.get(key),
		TransactionRepository.search(key, { includeDeleted: false }),
		TransactionSplitRepository.listAll(key),
		TransactionTagRepository.list(),
		AttachmentRepository.list(key),
		PersonRepository.list(key),
		PersonLoanRepository.listAllOpen(key),
		LoanRepaymentRepository.listAll(key),
		SavedFilterViewRepository.list(key)
	]);

	const categorizationRules = categorizationRulesWithStatus.map((rule) => {
		const { isInvalid, ...cleanRule } = rule;
		return cleanRule;
	});

	return {
		container: 'myfin-data-template',
		templateVersion: CURRENT_TEMPLATE_VERSION,
		exportedAt: new Date().toISOString(),
		entities: {
			accounts,
			categories,
			merchants,
			merchantAliases,
			tags,
			investmentHoldings,
			investmentValuations,
			liabilities,
			netWorthSnapshots,
			savingsGoals,
			goalContributions,
			budgets,
			budgetItems,
			recurringRules,
			expectedEvents,
			categorizationRules,
			merchantCategorySignals,
			notificationPreference,
			debtPlannerPreference,
			transactions,
			transactionSplits,
			transactionTags,
			attachments,
			people,
			personLoans,
			loanRepayments,
			savedFilterViews
		}
	};
}

/**
 * Serializes a DataTemplate into an application/json Blob with formatted indentation.
 */
export function exportDataTemplateToJsonBlob(template: DataTemplate): Blob {
	const json = JSON.stringify(template, null, 2);
	return new Blob([json], { type: 'application/json' });
}

/**
 * Imports a DataTemplate into the database in dependency order, additively and non-destructively.
 * - Structural records matching existing items are skipped (skip-if-exists, FR-007).
 * - Matching transactions are created and flagged with reviewStatus: 'unreviewed' and duplicateOfId (FR-008).
 * - Foreign keys across all entities are remapped to new or existing UUIDs.
 * - Unresolved references are skipped gracefully with reasons reported (FR-010).
 * - Balances are recalculated in a single batch pass per touched account (FR-014).
 */
export async function importDataTemplate(
	key: CryptoKey,
	template: DataTemplate
): Promise<TemplateImportResult> {
	const perEntity: Record<string, EntityImportStats> = {};
	const skippedReasons: SkippedReason[] = [];

	function initStats(entity: string) {
		if (!perEntity[entity]) {
			perEntity[entity] = { created: 0, skipped: 0 };
		}
	}

	function recordCreated(entity: string) {
		initStats(entity);
		perEntity[entity].created++;
	}

	function recordSkipped(
		entity: string,
		reason: 'already-exists' | 'unresolved-relationship',
		identifier?: string
	) {
		initStats(entity);
		perEntity[entity].skipped++;
		skippedReasons.push({ entity, reason, identifier });
	}

	function recordFlagged(entity: string) {
		initStats(entity);
		perEntity[entity].flaggedDuplicate = (perEntity[entity].flaggedDuplicate ?? 0) + 1;
	}

	const accountRemap = new Map<string, string>();
	const categoryRemap = new Map<string, string>();
	const merchantRemap = new Map<string, string>();
	const merchantAliasRemap = new Map<string, string>();
	const tagRemap = new Map<string, string>();
	const holdingRemap = new Map<string, string>();
	const liabilityRemap = new Map<string, string>();
	const savingsGoalRemap = new Map<string, string>();
	const budgetRemap = new Map<string, string>();
	const recurringRuleRemap = new Map<string, string>();
	const transactionRemap = new Map<string, string>();
	const personRemap = new Map<string, string>();
	const transactionIsDuplicateOfExisting = new Set<string>();

	const entities = template.entities ?? ({} as Partial<typeof template.entities>);

	// 1. Accounts
	const existingAccounts = await AccountRepository.list(key);
	for (const acc of entities.accounts ?? []) {
		const match = existingAccounts.find(
			(a) => a.name.trim().toLowerCase() === acc.name.trim().toLowerCase()
		);
		if (match) {
			accountRemap.set(acc.id, match.id);
			recordSkipped('accounts', 'already-exists', acc.name);
		} else {
			const created = await AccountRepository.create(key, {
				name: acc.name,
				type: acc.type,
				openingBalance: acc.openingBalance,
				creditLimit: acc.creditLimit,
				billingCycleDay: acc.billingCycleDay
			});
			accountRemap.set(acc.id, created.id);
			existingAccounts.push(created);
			recordCreated('accounts');
		}
	}

	// 2. Categories (Order parents before children)
	const existingCategories = await CategoryRepository.list(key);
	const rawCategories = [...(entities.categories ?? [])];
	let pendingCategories = rawCategories;
	let progress = true;

	while (pendingCategories.length > 0 && progress) {
		progress = false;
		const nextPending = [];

		for (const cat of pendingCategories) {
			let resolvedParentId: string | null = null;
			if (cat.parentId) {
				if (categoryRemap.has(cat.parentId)) {
					resolvedParentId = categoryRemap.get(cat.parentId)!;
				} else if (existingCategories.some((c) => c.id === cat.parentId)) {
					resolvedParentId = cat.parentId;
				} else if (rawCategories.some((c) => c.id === cat.parentId)) {
					// Parent is in the file but not created yet; defer to next pass
					nextPending.push(cat);
					continue;
				} else {
					// Parent exists nowhere: create as top-level category with fallback
					resolvedParentId = null;
				}
			}

			const match = existingCategories.find(
				(c) =>
					c.name.trim().toLowerCase() === cat.name.trim().toLowerCase() &&
					(c.parentId ?? null) === (resolvedParentId ?? null)
			);

			if (match) {
				categoryRemap.set(cat.id, match.id);
				recordSkipped('categories', 'already-exists', cat.name);
			} else {
				const created = await CategoryRepository.create(key, {
					name: cat.name,
					parentId: resolvedParentId,
					icon: cat.icon
				});
				categoryRemap.set(cat.id, created.id);
				existingCategories.push(created);
				recordCreated('categories');
			}
			progress = true;
		}

		pendingCategories = nextPending;
	}

	// Any remaining cyclic/unresolved categories fallback to top-level
	for (const cat of pendingCategories) {
		const match = existingCategories.find(
			(c) => c.name.trim().toLowerCase() === cat.name.trim().toLowerCase()
		);
		if (match) {
			categoryRemap.set(cat.id, match.id);
			recordSkipped('categories', 'already-exists', cat.name);
		} else {
			const created = await CategoryRepository.create(key, {
				name: cat.name,
				parentId: null,
				icon: cat.icon
			});
			categoryRemap.set(cat.id, created.id);
			existingCategories.push(created);
			recordCreated('categories');
		}
	}

	// 3. Merchants
	const existingMerchants = await MerchantRepository.list(key);
	for (const m of entities.merchants ?? []) {
		const match = existingMerchants.find(
			(em) => em.name.trim().toLowerCase() === m.name.trim().toLowerCase()
		);
		if (match) {
			merchantRemap.set(m.id, match.id);
			recordSkipped('merchants', 'already-exists', m.name);
		} else {
			const created = await MerchantRepository.create(key, m.name);
			merchantRemap.set(m.id, created.id);
			existingMerchants.push(created);
			recordCreated('merchants');
		}
	}

	// 4. Merchant Aliases
	const existingAliases = await MerchantAliasRepository.list(key);
	for (const a of entities.merchantAliases ?? []) {
		const resolvedMerchantId = merchantRemap.get(a.merchantId);
		if (!resolvedMerchantId) {
			recordSkipped('merchantAliases', 'unresolved-relationship', a.aliasText);
			continue;
		}
		const match = existingAliases.find(
			(ea) =>
				ea.merchantId === resolvedMerchantId &&
				ea.aliasText.trim().toLowerCase() === a.aliasText.trim().toLowerCase()
		);
		if (match) {
			merchantAliasRemap.set(a.id, match.id);
			recordSkipped('merchantAliases', 'already-exists', a.aliasText);
		} else {
			const created = await MerchantAliasRepository.create(key, resolvedMerchantId, a.aliasText);
			merchantAliasRemap.set(a.id, created.id);
			existingAliases.push(created);
			recordCreated('merchantAliases');
		}
	}

	// 5. Tags
	const existingTags = await TagRepository.list(key);
	for (const t of entities.tags ?? []) {
		const match = existingTags.find(
			(et) => et.name.trim().toLowerCase() === t.name.trim().toLowerCase()
		);
		if (match) {
			tagRemap.set(t.id, match.id);
			recordSkipped('tags', 'already-exists', t.name);
		} else {
			const created = await TagRepository.getOrCreate(key, t.name);
			tagRemap.set(t.id, created.id);
			existingTags.push(created);
			recordCreated('tags');
		}
	}

	// 6. Investment Holdings
	const existingHoldings = await InvestmentHoldingRepository.list(key);
	for (const h of entities.investmentHoldings ?? []) {
		const match = existingHoldings.find(
			(eh) => eh.name.trim().toLowerCase() === h.name.trim().toLowerCase()
		);
		if (match) {
			holdingRemap.set(h.id, match.id);
			recordSkipped('investmentHoldings', 'already-exists', h.name);
		} else {
			const created = await InvestmentHoldingRepository.create(key, {
				name: h.name,
				type: h.type,
				costBasis: h.costBasis
			});
			holdingRemap.set(h.id, created.id);
			existingHoldings.push(created);
			recordCreated('investmentHoldings');
		}
	}

	// 7. Investment Valuations
	const existingValuations = await InvestmentValuationRepository.list(key);
	for (const v of entities.investmentValuations ?? []) {
		const resolvedHoldingId = holdingRemap.get(v.holdingId);
		if (!resolvedHoldingId) {
			recordSkipped('investmentValuations', 'unresolved-relationship');
			continue;
		}
		const match = existingValuations.find(
			(ev) => ev.holdingId === resolvedHoldingId && ev.date === v.date
		);
		if (match) {
			recordSkipped('investmentValuations', 'already-exists');
		} else {
			await InvestmentValuationRepository.create(key, {
				holdingId: resolvedHoldingId,
				date: v.date,
				value: v.value
			});
			recordCreated('investmentValuations');
		}
	}

	// 8. Liabilities
	const existingLiabilities = await LiabilityRepository.list(key);
	for (const l of entities.liabilities ?? []) {
		const match = existingLiabilities.find(
			(el) => el.name.trim().toLowerCase() === l.name.trim().toLowerCase()
		);
		if (match) {
			liabilityRemap.set(l.id, match.id);
			recordSkipped('liabilities', 'already-exists', l.name);
		} else {
			const created = await LiabilityRepository.create(key, {
				name: l.name,
				type: l.type,
				outstandingBalance: l.outstandingBalance,
				emiAmount: l.emiAmount,
				emiDueDay: l.emiDueDay,
				interestRate: l.interestRate,
				minimumPayment: l.minimumPayment
			});
			liabilityRemap.set(l.id, created.id);
			existingLiabilities.push(created);
			recordCreated('liabilities');
		}
	}

	// 9. Net Worth Snapshots
	const existingSnapshots = await NetWorthSnapshotRepository.list(key);
	for (const s of entities.netWorthSnapshots ?? []) {
		const match = existingSnapshots.find((es) => es.date === s.date);
		if (match) {
			recordSkipped('netWorthSnapshots', 'already-exists', s.date);
		} else {
			await NetWorthSnapshotRepository.create(key, {
				date: s.date,
				totalAssets: s.totalAssets,
				totalLiabilities: s.totalLiabilities,
				netWorth: s.netWorth
			});
			recordCreated('netWorthSnapshots');
		}
	}

	// 10. Savings Goals
	const existingGoals = await SavingsGoalRepository.list(key);
	for (const g of entities.savingsGoals ?? []) {
		const match = existingGoals.find(
			(eg) => eg.name.trim().toLowerCase() === g.name.trim().toLowerCase()
		);
		if (match) {
			savingsGoalRemap.set(g.id, match.id);
			recordSkipped('savingsGoals', 'already-exists', g.name);
		} else {
			const created = await SavingsGoalRepository.create(key, {
				name: g.name,
				targetAmount: g.targetAmount,
				targetDate: g.targetDate
			});
			savingsGoalRemap.set(g.id, created.id);
			existingGoals.push(created);
			recordCreated('savingsGoals');
		}
	}

	// 11. Goal Contributions
	const existingContribs = await GoalContributionRepository.list(key);
	for (const gc of entities.goalContributions ?? []) {
		const resolvedGoalId = savingsGoalRemap.get(gc.goalId);
		if (!resolvedGoalId) {
			recordSkipped('goalContributions', 'unresolved-relationship');
			continue;
		}
		const match = existingContribs.find(
			(ec) => ec.goalId === resolvedGoalId && ec.date === gc.date && ec.amount === gc.amount
		);
		if (match) {
			recordSkipped('goalContributions', 'already-exists');
		} else {
			await GoalContributionRepository.create(key, {
				goalId: resolvedGoalId,
				amount: gc.amount,
				date: gc.date
			});
			recordCreated('goalContributions');
		}
	}

	// 12. Budgets
	const existingBudgets = await BudgetRepository.list(key);
	for (const b of entities.budgets ?? []) {
		const resolvedCatId = categoryRemap.get(b.categoryId);
		if (!resolvedCatId) {
			recordSkipped('budgets', 'unresolved-relationship');
			continue;
		}
		const match = existingBudgets.find(
			(eb) => eb.categoryId === resolvedCatId && eb.periodType === b.periodType
		);
		if (match) {
			budgetRemap.set(b.id, match.id);
			recordSkipped('budgets', 'already-exists');
		} else {
			const created = await BudgetRepository.create(key, {
				categoryId: resolvedCatId,
				periodType: b.periodType,
				amount: b.amount,
				rolloverEnabled: b.rolloverEnabled,
				isSinkingFund: b.isSinkingFund
			});
			budgetRemap.set(b.id, created.id);
			existingBudgets.push(created);
			recordCreated('budgets');
		}
	}

	// 13. Budget Items
	const existingBudgetItems = await BudgetItemRepository.list(key);
	for (const bi of entities.budgetItems ?? []) {
		const resolvedBudgetId = budgetRemap.get(bi.budgetId);
		if (!resolvedBudgetId) {
			recordSkipped('budgetItems', 'unresolved-relationship');
			continue;
		}
		const match = existingBudgetItems.find(
			(ebi) => ebi.budgetId === resolvedBudgetId && ebi.periodStart === bi.periodStart
		);
		if (match) {
			recordSkipped('budgetItems', 'already-exists');
		} else {
			await BudgetItemRepository.create(key, {
				budgetId: resolvedBudgetId,
				periodStart: bi.periodStart,
				periodEnd: bi.periodEnd,
				plannedAmount: bi.plannedAmount,
				actualAmount: bi.actualAmount,
				rolloverInAmount: bi.rolloverInAmount
			});
			recordCreated('budgetItems');
		}
	}

	// 14. Recurring Rules
	const existingRules = await RecurringRepository.list(key);
	for (const rr of entities.recurringRules ?? []) {
		const resolvedAccountId = accountRemap.get(rr.accountId);
		const resolvedCatId = categoryRemap.get(rr.categoryId);
		if (!resolvedAccountId || !resolvedCatId) {
			recordSkipped('recurringRules', 'unresolved-relationship');
			continue;
		}
		const match = existingRules.find(
			(er) =>
				er.accountId === resolvedAccountId &&
				er.categoryId === resolvedCatId &&
				er.amount === rr.amount &&
				er.frequency === rr.frequency &&
				er.dayOfPeriod === rr.dayOfPeriod
		);
		if (match) {
			recurringRuleRemap.set(rr.id, match.id);
			recordSkipped('recurringRules', 'already-exists');
		} else {
			const created = await RecurringRepository.create(key, {
				accountId: resolvedAccountId,
				categoryId: resolvedCatId,
				amount: rr.amount,
				frequency: rr.frequency,
				dayOfPeriod: rr.dayOfPeriod
			});
			recurringRuleRemap.set(rr.id, created.id);
			existingRules.push(created);
			recordCreated('recurringRules');
		}
	}

	// 15. Expected Events
	const existingEvents = await ExpectedEventRepository.listAll(key);
	for (const ee of entities.expectedEvents ?? []) {
		const resolvedRuleId = recurringRuleRemap.get(ee.recurringRuleId);
		if (!resolvedRuleId) {
			recordSkipped('expectedEvents', 'unresolved-relationship');
			continue;
		}
		const match = existingEvents.find(
			(ev) => ev.recurringRuleId === resolvedRuleId && ev.expectedDate === ee.expectedDate
		);
		if (match) {
			recordSkipped('expectedEvents', 'already-exists');
		} else {
			await ExpectedEventRepository.create(key, {
				recurringRuleId: resolvedRuleId,
				expectedDate: ee.expectedDate,
				status: ee.status,
				matchedTransactionId: null
			});
			recordCreated('expectedEvents');
		}
	}

	// 16. Categorization Rules
	const existingCatRules = await CategorizationRuleRepository.list(key);
	for (const cr of entities.categorizationRules ?? []) {
		const resolvedMerchantId = merchantRemap.get(cr.merchantId);
		const resolvedCatId = categoryRemap.get(cr.categoryId);
		if (!resolvedMerchantId || !resolvedCatId) {
			recordSkipped('categorizationRules', 'unresolved-relationship');
			continue;
		}
		const resolvedAliasId = cr.merchantAliasId
			? (merchantAliasRemap.get(cr.merchantAliasId) ?? null)
			: null;
		const resolvedTagIds = (cr.tagIds ?? [])
			.map((tid) => tagRemap.get(tid))
			.filter((t): t is string => Boolean(t));

		const match = existingCatRules.find(
			(er) =>
				er.merchantId === resolvedMerchantId &&
				(er.merchantAliasId ?? null) === (resolvedAliasId ?? null) &&
				er.categoryId === resolvedCatId
		);
		if (match) {
			recordSkipped('categorizationRules', 'already-exists');
		} else {
			await CategorizationRuleRepository.create(key, {
				merchantId: resolvedMerchantId,
				merchantAliasId: resolvedAliasId,
				categoryId: resolvedCatId,
				tagIds: resolvedTagIds
			});
			recordCreated('categorizationRules');
		}
	}

	// 17. Merchant Category Signals (Merged rolling window)
	for (const mcs of entities.merchantCategorySignals ?? []) {
		const resolvedMerchantId = merchantRemap.get(mcs.id);
		if (!resolvedMerchantId) continue;
		const resolvedCategories = (mcs.recentCategoryIds ?? [])
			.map((cid) => categoryRemap.get(cid))
			.filter((c): c is string => Boolean(c));

		const existing = await MerchantCategorySignalRepository.get(key, resolvedMerchantId);
		if (existing) {
			const merged = [...existing.recentCategoryIds, ...resolvedCategories].slice(-3);
			await MerchantCategorySignalRepository.set(key, resolvedMerchantId, merged);
			recordCreated('merchantCategorySignals');
		} else {
			await MerchantCategorySignalRepository.set(
				key,
				resolvedMerchantId,
				resolvedCategories.slice(-3)
			);
			recordCreated('merchantCategorySignals');
		}
	}

	// 18. Singleton Preferences (skip-if-exists)
	if (entities.notificationPreference) {
		recordSkipped('notificationPreference', 'already-exists');
	}
	if (entities.debtPlannerPreference) {
		recordSkipped('debtPlannerPreference', 'already-exists');
	}

	// 19. People & Loans
	const existingPeople = await PersonRepository.list(key);
	for (const p of entities.people ?? []) {
		const match = existingPeople.find(
			(ep) => ep.name.trim().toLowerCase() === p.name.trim().toLowerCase()
		);
		if (match) {
			personRemap.set(p.id, match.id);
			recordSkipped('people', 'already-exists', p.name);
		} else {
			const created = await PersonRepository.create(key, {
				name: p.name,
				notes: p.notes
			});
			personRemap.set(p.id, created.id);
			existingPeople.push(created);
			recordCreated('people');
		}
	}

	// 20. Saved Filter Views
	const existingViews = await SavedFilterViewRepository.list(key);
	for (const v of entities.savedFilterViews ?? []) {
		const match = existingViews.find(
			(ev) => ev.name.trim().toLowerCase() === v.name.trim().toLowerCase()
		);
		if (match) {
			recordSkipped('savedFilterViews', 'already-exists', v.name);
		} else {
			const accId = v.accountId ? (accountRemap.get(v.accountId) ?? null) : null;
			const tagIds = (v.tagIds ?? []).map((t) => tagRemap.get(t)).filter((t): t is string => Boolean(t));
			await SavedFilterViewRepository.create(key, {
				name: v.name,
				accountId: accId,
				dateFrom: v.dateFrom,
				dateTo: v.dateTo,
				freeText: v.freeText,
				tagIds
			});
			recordCreated('savedFilterViews');
		}
	}

	// 21. Transactions (Flag-not-skip duplicate rule, deferBalance: true)
	const touchedAccountIds = new Set<string>();
	const txIndexByAccount = new Map<string, Map<string, string>>();

	// Pre-index existing transactions in all touched destination accounts
	for (const acc of entities.accounts ?? []) {
		const resolvedAccId = accountRemap.get(acc.id);
		if (resolvedAccId && !txIndexByAccount.has(resolvedAccId)) {
			const existingTxs = await TransactionRepository.search(key, {
				accountId: resolvedAccId,
				includeDeleted: false
			});
			const accIndex = new Map<string, string>();
			for (const tx of existingTxs) {
				accIndex.set(duplicateKey(tx.date, tx.amount), tx.id);
			}
			txIndexByAccount.set(resolvedAccId, accIndex);
		}
	}

	const rawTransactions = entities.transactions ?? [];
	for (let i = 0; i < rawTransactions.length; i++) {
		// Yield to event loop periodically (FR-014 / SC-005)
		if (i > 0 && i % 100 === 0) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		const tx = rawTransactions[i];
		const resolvedAccountId = accountRemap.get(tx.accountId);
		if (!resolvedAccountId) {
			recordSkipped('transactions', 'unresolved-relationship');
			continue;
		}

		let accIndex = txIndexByAccount.get(resolvedAccountId);
		if (!accIndex) {
			accIndex = new Map<string, string>();
			txIndexByAccount.set(resolvedAccountId, accIndex);
		}

		const resolvedMerchantId = tx.merchantId ? (merchantRemap.get(tx.merchantId) ?? null) : null;
		const duplicateId = findDuplicateId(accIndex, tx.date, tx.amount);
		const isDuplicate = duplicateId !== null;

		// Resolve splits
		const fileSplits = (entities.transactionSplits ?? []).filter((s) => s.transactionId === tx.id);
		const resolvedSplits = fileSplits.map((s) => ({
			categoryId: categoryRemap.get(s.categoryId) ?? UNCATEGORIZED_CATEGORY_ID,
			amount: s.amount,
			categorizationSource: s.categorizationSource
		}));

		if (resolvedSplits.length === 0) {
			resolvedSplits.push({
				categoryId: UNCATEGORIZED_CATEGORY_ID,
				amount: tx.amount,
				categorizationSource: undefined
			});
		}

		const createdTx = await TransactionEngine.recordTransaction(
			key,
			{
				accountId: resolvedAccountId,
				date: tx.date,
				amount: tx.amount,
				type: tx.type,
				merchantId: resolvedMerchantId,
				notes: tx.notes,
				source: tx.source ?? 'manual',
				reviewStatus: isDuplicate ? 'unreviewed' : (tx.reviewStatus ?? 'confirmed'),
				duplicateOfId: duplicateId
			},
			resolvedSplits,
			{ deferBalance: true }
		);

		transactionRemap.set(tx.id, createdTx.id);
		recordCreated('transactions');
		if (isDuplicate) {
			recordFlagged('transactions');
			transactionIsDuplicateOfExisting.add(tx.id);
		} else {
			accIndex.set(duplicateKey(tx.date, tx.amount), createdTx.id);
		}

		touchedAccountIds.add(resolvedAccountId);
	}

	// 22. Transaction Tags
	const tagsByTx = new Map<string, string[]>();
	for (const tt of entities.transactionTags ?? []) {
		const newTxId = transactionRemap.get(tt.transactionId);
		const newTagId = tagRemap.get(tt.tagId);
		if (newTxId && newTagId) {
			const existing = tagsByTx.get(newTxId) ?? [];
			existing.push(newTagId);
			tagsByTx.set(newTxId, existing);
		}
	}
	for (const [txId, tagIds] of tagsByTx.entries()) {
		await TransactionTagRepository.setTags(txId, tagIds);
	}

	// 23. Attachments (Skip if parent transaction resolved to a pre-existing duplicate)
	for (const att of entities.attachments ?? []) {
		const newTxId = transactionRemap.get(att.transactionId);
		if (!newTxId) {
			recordSkipped('attachments', 'unresolved-relationship');
			continue;
		}

		if (transactionIsDuplicateOfExisting.has(att.transactionId)) {
			// Do not steal/attach to duplicate transaction
			recordSkipped('attachments', 'already-exists');
			continue;
		}

		await AttachmentRepository.create(key, {
			transactionId: newTxId,
			mimeType: att.mimeType,
			data: att.data,
			sizeBytes: att.sizeBytes
		});
		recordCreated('attachments');
	}

	// 24. Batch Balance Recalculation (One call per touched account, FR-014)
	for (const accountId of touchedAccountIds) {
		await TransactionEngine.recalculateAccountBalance(key, accountId);
	}

	return {
		perEntity,
		skippedReasons
	};
}
