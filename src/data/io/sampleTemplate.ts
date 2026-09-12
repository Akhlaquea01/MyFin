import type { DataTemplate } from './templateTypes';

export const SAMPLE_DATA_TEMPLATE: DataTemplate = {
	container: 'myfin-data-template',
	templateVersion: 1,
	exportedAt: '2026-09-12T16:05:35.376Z',
	entities: {
		accounts: [
			{
				id: '3d71c774-55e6-4c08-86fc-81d0881faffd',
				name: 'Ac',
				type: 'bank',
				openingBalance: 101000,
				currentBalance: 101000,
				creditLimit: null,
				billingCycleDay: null,
				isArchived: false,
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			},
			{
				id: 'e489f6cd-6245-474c-87c2-3a3cfc44b1a8',
				name: 'Akhlaque',
				type: 'bank',
				openingBalance: 88888888888800,
				currentBalance: 88888888888800,
				creditLimit: null,
				billingCycleDay: null,
				isArchived: false,
				createdAt: 1788699457781,
				updatedAt: 1788699457781,
				deletedAt: null
			}
		],
		categories: [
			{
				id: 'c1111111-1111-4111-8111-111111111111',
				name: 'Food & Dining',
				parentId: null,
				icon: 'utensils',
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			},
			{
				id: 'c2222222-2222-4222-8222-222222222222',
				name: 'Groceries',
				parentId: 'c1111111-1111-4111-8111-111111111111',
				icon: 'shopping-cart',
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			},
			{
				id: 'c3333333-3333-4333-8333-333333333333',
				name: 'Salary',
				parentId: null,
				icon: 'briefcase',
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			}
		],
		merchants: [
			{
				id: 'm1111111-1111-4111-8111-111111111111',
				name: 'Supermarket Fresh',
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			}
		],
		merchantAliases: [
			{
				id: 'ma111111-1111-4111-8111-111111111111',
				merchantId: 'm1111111-1111-4111-8111-111111111111',
				aliasText: 'SUPERMKT #402',
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		tags: [
			{
				id: 't1111111-1111-4111-8111-111111111111',
				name: 'Essentials',
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		investmentHoldings: [
			{
				id: '92622f54-ab10-433d-a04e-3d433bce775b',
				name: 'Coal India',
				type: 'Stock',
				costBasis: 1000,
				createdAt: 1788682788686,
				updatedAt: 1788682788686,
				deletedAt: null
			}
		],
		investmentValuations: [
			{
				id: 'iv111111-1111-4111-8111-111111111111',
				holdingId: '92622f54-ab10-433d-a04e-3d433bce775b',
				date: '2026-09-12',
				value: 1250,
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		liabilities: [
			{
				id: 'l1111111-1111-4111-8111-111111111111',
				name: 'Car Loan',
				type: 'loan',
				outstandingBalance: 45000000,
				emiAmount: 1500000,
				emiDueDay: 5,
				interestRate: 850,
				minimumPayment: 1500000,
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			}
		],
		netWorthSnapshots: [
			{
				id: 'nw111111-1111-4111-8111-111111111111',
				date: '2026-09-01',
				totalAssets: 88888889989800,
				totalLiabilities: 45000000,
				netWorth: 88888844989800,
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		savingsGoals: [
			{
				id: 'sg111111-1111-4111-8111-111111111111',
				name: 'Emergency Fund',
				targetAmount: 50000000,
				targetDate: '2026-12-31',
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			}
		],
		goalContributions: [
			{
				id: 'gc111111-1111-4111-8111-111111111111',
				goalId: 'sg111111-1111-4111-8111-111111111111',
				amount: 1000000,
				date: '2026-09-10',
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		budgets: [
			{
				id: 'b1111111-1111-4111-8111-111111111111',
				categoryId: 'c2222222-2222-4222-8222-222222222222',
				periodType: 'monthly',
				amount: 2000000,
				rolloverEnabled: true,
				isSinkingFund: false,
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		budgetItems: [
			{
				id: 'bi111111-1111-4111-8111-111111111111',
				budgetId: 'b1111111-1111-4111-8111-111111111111',
				periodStart: '2026-09-01',
				periodEnd: '2026-09-30',
				plannedAmount: 2000000,
				actualAmount: 350000,
				rolloverInAmount: 0,
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		recurringRules: [
			{
				id: 'rr111111-1111-4111-8111-111111111111',
				accountId: '3d71c774-55e6-4c08-86fc-81d0881faffd',
				categoryId: 'c2222222-2222-4222-8222-222222222222',
				amount: -350000,
				frequency: 'monthly',
				dayOfPeriod: 10,
				isActive: true,
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		expectedEvents: [
			{
				id: 'ee111111-1111-4111-8111-111111111111',
				recurringRuleId: 'rr111111-1111-4111-8111-111111111111',
				expectedDate: '2026-10-10',
				status: 'pending',
				matchedTransactionId: null,
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		categorizationRules: [
			{
				id: 'cr111111-1111-4111-8111-111111111111',
				merchantId: 'm1111111-1111-4111-8111-111111111111',
				merchantAliasId: 'ma111111-1111-4111-8111-111111111111',
				categoryId: 'c2222222-2222-4222-8222-222222222222',
				tagIds: ['t1111111-1111-4111-8111-111111111111'],
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			}
		],
		merchantCategorySignals: [
			{
				id: 'm1111111-1111-4111-8111-111111111111',
				recentCategoryIds: ['c2222222-2222-4222-8222-222222222222'],
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		notificationPreference: {
			id: 'local-user',
			enabled: true,
			reminderLeadDays: 1,
			budgetThresholdPercent: 80,
			permissionPromptDismissed: true,
			createdAt: 1789229100499,
			updatedAt: 1789229100499
		},
		debtPlannerPreference: {
			id: 'local-user',
			strategy: 'avalanche',
			extraMonthlyPayment: 0,
			createdAt: 1789229135375,
			updatedAt: 1789229135375
		},
		transactions: [
			{
				id: 'tx111111-1111-4111-8111-111111111111',
				accountId: '3d71c774-55e6-4c08-86fc-81d0881faffd',
				date: '2026-09-10',
				amount: -350000,
				type: 'expense',
				transferPairId: null,
				merchantId: 'm1111111-1111-4111-8111-111111111111',
				notes: 'Monthly grocery restock',
				source: 'manual',
				reviewStatus: 'confirmed',
				duplicateOfId: null,
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			},
			{
				id: 'tx222222-2222-4222-8222-222222222222',
				accountId: '3d71c774-55e6-4c08-86fc-81d0881faffd',
				date: '2026-09-05',
				amount: -500000,
				type: 'transfer',
				transferPairId: null,
				merchantId: null,
				notes: 'Loan to Rahul',
				source: 'manual',
				reviewStatus: 'confirmed',
				duplicateOfId: null,
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			},
			{
				id: 'tx333333-3333-4333-8333-333333333333',
				accountId: '3d71c774-55e6-4c08-86fc-81d0881faffd',
				date: '2026-09-12',
				amount: 100000,
				type: 'transfer',
				transferPairId: null,
				merchantId: null,
				notes: 'Rahul repayment part 1',
				source: 'manual',
				reviewStatus: 'confirmed',
				duplicateOfId: null,
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			}
		],
		transactionSplits: [
			{
				id: 'ts111111-1111-4111-8111-111111111111',
				transactionId: 'tx111111-1111-4111-8111-111111111111',
				categoryId: 'c2222222-2222-4222-8222-222222222222',
				amount: -350000
			},
			{
				id: 'ts222222-2222-4222-8222-222222222222',
				transactionId: 'tx222222-2222-4222-8222-222222222222',
				categoryId: '__uncategorized__',
				amount: -500000
			},
			{
				id: 'ts333333-3333-4333-8333-333333333333',
				transactionId: 'tx333333-3333-4333-8333-333333333333',
				categoryId: '__uncategorized__',
				amount: 100000
			}
		],
		transactionTags: [
			{
				transactionId: 'tx111111-1111-4111-8111-111111111111',
				tagId: 't1111111-1111-4111-8111-111111111111'
			}
		],
		attachments: [
			{
				id: 'att11111-1111-4111-8111-111111111111',
				transactionId: 'tx111111-1111-4111-8111-111111111111',
				mimeType: 'image/jpeg',
				data: '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...',
				sizeBytes: 1024,
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		],
		people: [
			{
				id: 'p1111111-1111-4111-8111-111111111111',
				name: 'Rahul Sharma',
				notes: 'Colleague',
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			}
		],
		personLoans: [
			{
				id: 'pl111111-1111-4111-8111-111111111111',
				personId: 'p1111111-1111-4111-8111-111111111111',
				direction: 'lent',
				principalAmount: 500000,
				date: '2026-09-05',
				dueDate: '2026-10-05',
				notes: 'Emergency loan',
				accountId: '3d71c774-55e6-4c08-86fc-81d0881faffd',
				transactionId: 'tx222222-2222-4222-8222-222222222222',
				writeOffAmount: 0,
				writeOffAt: null,
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			}
		],
		loanRepayments: [
			{
				id: 'lr111111-1111-4111-8111-111111111111',
				loanId: 'pl111111-1111-4111-8111-111111111111',
				amount: 100000,
				date: '2026-09-12',
				accountId: '3d71c774-55e6-4c08-86fc-81d0881faffd',
				transactionId: 'tx333333-3333-4333-8333-333333333333',
				createdAt: 1788699245267,
				updatedAt: 1788699245267,
				deletedAt: null
			}
		],
		savedFilterViews: [
			{
				id: 'sfv11111-1111-4111-8111-111111111111',
				name: 'Recent Groceries',
				accountId: '3d71c774-55e6-4c08-86fc-81d0881faffd',
				dateFrom: '2026-09-01',
				dateTo: '2026-09-30',
				freeText: 'groceries',
				tagIds: ['t1111111-1111-4111-8111-111111111111'],
				createdAt: 1788699245267,
				updatedAt: 1788699245267
			}
		]
	}
};
