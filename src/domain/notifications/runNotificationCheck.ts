import { CategoryRepository } from '../../data/dexie/categoryRepository';
import { RecurringRepository, ExpectedEventRepository } from '../../data/dexie/recurringRepository';
import { BudgetRepository } from '../../data/dexie/budgetRepository';
import {
	NotificationPreferenceRepository,
	NotifiedItemRepository
} from '../../data/dexie/notificationRepository';
import { NotificationInboxRepository } from '../../data/dexie/notificationInboxRepository';
import { announceAlertsChanged } from '../../lib/alertsEvent';
import { generateExpectedEvents, markMissedPastDue } from '../recurring/recurringEngine';
import { ensureCurrentBudgetItem } from '../budgets/budgetEngine';
import { findDueRecurringEvents, findCrossedBudgetThresholds } from './notificationEngine';
import {
	PersonRepository,
	PersonLoanRepository,
	LoanRepaymentRepository
} from '../../data/dexie/personLoanRepository';
import { computePendingBalance, findOverduePersonLoans } from '../personLoans/loanProgress';
import type { NotificationCandidate } from './types';
import { buildCategoryLabels } from '../categories/categoryHierarchy';
import { getNotifyPermission, showNotification } from '../../lib/notify';

/** Matches RecurringUpcomingPage's own lookahead horizon, so this check sees the same
 *  expected events that page would generate on its own next load. */
const RECURRING_LOOKAHEAD_DAYS = 60;

/**
 * Shows a real notification — a browser Notification, or an Android one inside the APK (see
 * lib/notify.ts) — and, only on success, logs it as notified (research.md §2). A candidate
 * suppressed by missing/denied permission stays eligible on the next check rather than being
 * silently marked "handled."
 */
/** Where tapping a notification of each kind should land in the app. */
const ROUTE_BY_KIND: Record<NotificationCandidate['kind'], string> = {
	recurring: '/recurring/upcoming',
	budget: '/budgets',
	personLoan: '/people'
};

async function dispatchAndLog(key: CryptoKey, candidate: NotificationCandidate): Promise<boolean> {
	if ((await getNotifyPermission()) !== 'granted') return false;
	if (
		!(await showNotification(
			candidate.title,
			candidate.body,
			candidate.key,
			ROUTE_BY_KIND[candidate.kind]
		))
	) {
		return false;
	}
	await NotifiedItemRepository.create(key, { key: candidate.key });
	return true;
}

/**
 * Orchestrator — per contracts/notification-engine.md. Impure (reads repositories, calls
 * the Notification API); the actual candidate-selection logic lives in the pure functions
 * in `notificationEngine.ts`. Called once per unlock from App.tsx's Gate (research.md §3).
 */
export async function runNotificationCheck(
	key: CryptoKey,
	asOfDate: Date = new Date()
): Promise<{ dispatched: NotificationCandidate[] }> {
	const preference = await NotificationPreferenceRepository.get(key);
	if (!preference.enabled) return { dispatched: [] };

	const dispatched: NotificationCandidate[] = [];
	const categories = await CategoryRepository.list(key);
	const categoryNameById = buildCategoryLabels(categories);

	const activeRules = await RecurringRepository.listActive(key);
	const throughDate = new Date(asOfDate);
	throughDate.setUTCDate(throughDate.getUTCDate() + RECURRING_LOOKAHEAD_DAYS);
	for (const rule of activeRules) {
		await generateExpectedEvents(key, rule, throughDate, asOfDate);
	}
	await markMissedPastDue(key, asOfDate);

	const ruleCategoryById = new Map(activeRules.map((r) => [r.id, r.categoryId]));
	const pendingEvents = await ExpectedEventRepository.listPending(key);
	const dueEventInputs = pendingEvents.map((e) => ({
		id: e.id,
		expectedDate: e.expectedDate,
		status: e.status,
		categoryName: categoryNameById.get(ruleCategoryById.get(e.recurringRuleId) ?? '') ?? 'Recurring'
	}));
	const recurringCandidates = findDueRecurringEvents(
		dueEventInputs,
		preference.reminderLeadDays,
		asOfDate
	);

	const budgets = await BudgetRepository.list(key);
	const budgetItems = await Promise.all(
		budgets.map((b) => ensureCurrentBudgetItem(key, b, asOfDate))
	);
	const budgetThresholdInputs = budgets.map((budget, index) => ({
		budgetId: budget.id,
		periodStart: budgetItems[index].periodStart,
		plannedAmount: budgetItems[index].plannedAmount,
		actualAmount: budgetItems[index].actualAmount,
		categoryName: categoryNameById.get(budget.categoryId) ?? 'Budget'
	}));
	const budgetCandidates = findCrossedBudgetThresholds(
		budgetThresholdInputs,
		preference.budgetThresholdPercent
	);

	// Feature 010, User Story 4 (FR-013): overdue personal loans, reusing the same
	// pure-candidate + NotifiedItemRepository dedupe pattern as the two sources above.
	const openLoans = await PersonLoanRepository.listAllOpen(key);
	const people = await PersonRepository.list(key);
	const personNameById = new Map(people.map((p) => [p.id, p.name]));
	const overdueLoanInputs = await Promise.all(
		openLoans.map(async (loan) => {
			const repayments = await LoanRepaymentRepository.listForLoan(key, loan.id);
			return {
				id: loan.id,
				personName: personNameById.get(loan.personId) ?? 'Someone',
				direction: loan.direction,
				dueDate: loan.dueDate,
				pendingBalance: computePendingBalance({
					principalAmount: loan.principalAmount,
					writeOffAmount: loan.writeOffAmount,
					repayments
				})
			};
		})
	);
	const personLoanCandidates = findOverduePersonLoans(overdueLoanInputs, asOfDate);

	let listed = 0;
	for (const candidate of [...recurringCandidates, ...budgetCandidates, ...personLoanCandidates]) {
		// Listed in the in-app Alerts first, whatever the OS permission is: a reminder the system
		// notification could not show (permission denied, app closed at the time) is still there to
		// be seen. One entry per occurrence, by the same dedupe key.
		const entry = await NotificationInboxRepository.addIfMissing(key, {
			dedupeKey: candidate.key,
			kind: candidate.kind,
			title: candidate.title,
			body: candidate.body,
			route: ROUTE_BY_KIND[candidate.kind]
		});
		if (entry) listed += 1;

		if (await NotifiedItemRepository.exists(key, candidate.key)) continue;
		if (await dispatchAndLog(key, candidate)) dispatched.push(candidate);
	}
	if (listed > 0) announceAlertsChanged();

	return { dispatched };
}
