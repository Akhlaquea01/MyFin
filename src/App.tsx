import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { SessionProvider, useSession } from './context/SessionContext';
import { acquireSingleInstanceLock, type InstanceRole } from './lib/singleInstance';
import { UserProfileRepository } from './data/dexie/userProfileRepository';
import { runNotificationCheck } from './domain/notifications/runNotificationCheck';
import { isStoragePersisted } from './data/storage/persistence';
import { OnboardingScreen } from './components/OnboardingScreen';
import { LockScreen } from './components/LockScreen';
import { BlockedScreen } from './components/BlockedScreen';
import { StorageWarningBanner } from './components/StorageWarningBanner';
import { BiometricEnrollmentPrompt } from './components/BiometricEnrollmentPrompt';
import { NotificationPermissionPrompt } from './components/NotificationPermissionPrompt';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { AccountsPage } from './pages/AccountsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { NewTransactionPage } from './pages/NewTransactionPage';
import { TransferPage } from './pages/TransferPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { TrashPage } from './pages/TrashPage';
import { QuickAddPage } from './pages/QuickAddPage';
import { ReviewPage } from './pages/ReviewPage';
import { BulkTextImportPage } from './pages/BulkTextImportPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { RecurringPage } from './pages/RecurringPage';
import { RecurringUpcomingPage } from './pages/RecurringUpcomingPage';
import { InvestmentsPage } from './pages/InvestmentsPage';
import { LiabilitiesPage } from './pages/LiabilitiesPage';
import { DebtPayoffPlannerPage } from './pages/DebtPayoffPlannerPage';
import { SavingsGoalsPage } from './pages/SavingsGoalsPage';
import { NotificationSettingsPage } from './pages/NotificationSettingsPage';
import { NetWorthPage } from './pages/NetWorthPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ImportPage } from './pages/ImportPage';
import { ExportPage } from './pages/ExportPage';
import { BackupSettingsPage } from './pages/BackupSettingsPage';
import { CategorizationRulesPage } from './pages/CategorizationRulesPage';

// Root security/availability gate (Constitution Principles I & II, FR-001–006, FR-044,
// FR-045). Every route renders only after this gate clears: not blocked by another tab,
// then onboarded, then unlocked. Nothing below this gate can run before those resolve.
function Gate() {
	const session = useSession();
	const [role, setRole] = useState<InstanceRole>('secondary');
	const [checkingProfile, setCheckingProfile] = useState(true);
	const [profileExists, setProfileExists] = useState(false);
	const [biometricAlreadyEnrolled, setBiometricAlreadyEnrolled] = useState(false);
	const [showStorageWarning, setShowStorageWarning] = useState(false);
	const [transientPin, setTransientPin] = useState<string | null>(null);

	function refreshProfileFlags() {
		void UserProfileRepository.get().then((p) => {
			setProfileExists(!!p);
			setBiometricAlreadyEnrolled(!!p?.webauthn);
			setCheckingProfile(false);
			session.setOnboarded(!!p);
		});
	}

	useEffect(() => {
		const stopLock = acquireSingleInstanceLock(setRole);
		refreshProfileFlags();
		void isStoragePersisted().then((persisted) => setShowStorageWarning(!persisted));

		const activityEvents = ['click', 'keydown', 'pointerdown'] as const;
		const onActivity = () => session.recordActivity();
		for (const evt of activityEvents) window.addEventListener(evt, onActivity);

		return () => {
			stopLock();
			for (const evt of activityEvents) window.removeEventListener(evt, onActivity);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- gate wiring runs once on mount
	}, []);

	function handleUnlock(pin: string) {
		setTransientPin(pin);
		refreshProfileFlags();
		// research.md §3 (spec 004): "app opened" is treated as "just unlocked," the same
		// hook point BiometricEnrollmentPrompt already uses.
		void runNotificationCheck(session.getEncryptionKey());
	}

	if (role === 'secondary') return <BlockedScreen />;
	if (checkingProfile) return <div className="min-h-dvh bg-background" />;
	if (!profileExists) return <OnboardingScreen onunlock={handleUnlock} />;
	if (session.isLocked) return <LockScreen onunlock={handleUnlock} />;

	return (
		<BrowserRouter>
			{showStorageWarning && <StorageWarningBanner />}
			{transientPin && !biometricAlreadyEnrolled && (
				<BiometricEnrollmentPrompt
					pin={transientPin}
					alreadyEnrolled={biometricAlreadyEnrolled}
					onDone={() => setTransientPin(null)}
				/>
			)}
			<NotificationPermissionPrompt />
			<Routes>
				<Route element={<AppShell />}>
					<Route index element={<DashboardPage />} />
					<Route path="accounts" element={<AccountsPage />} />
					<Route path="transactions" element={<TransactionsPage />} />
					<Route path="transactions/new" element={<NewTransactionPage />} />
					<Route path="transactions/transfer" element={<TransferPage />} />
					<Route path="categories" element={<CategoriesPage />} />
					<Route path="trash" element={<TrashPage />} />
					<Route path="quick-add" element={<QuickAddPage />} />
					<Route path="review" element={<ReviewPage />} />
					<Route path="import/bulk-text" element={<BulkTextImportPage />} />
					<Route path="budgets" element={<BudgetsPage />} />
					<Route path="savings-goals" element={<SavingsGoalsPage />} />
					<Route path="recurring" element={<RecurringPage />} />
					<Route path="recurring/upcoming" element={<RecurringUpcomingPage />} />
					<Route path="investments" element={<InvestmentsPage />} />
					<Route path="liabilities" element={<LiabilitiesPage />} />
					<Route path="liabilities/payoff-planner" element={<DebtPayoffPlannerPage />} />
					<Route path="net-worth" element={<NetWorthPage />} />
					<Route path="analytics" element={<AnalyticsPage />} />
					<Route path="import" element={<ImportPage />} />
					<Route path="export" element={<ExportPage />} />
					<Route path="backup" element={<BackupSettingsPage />} />
					<Route path="notification-settings" element={<NotificationSettingsPage />} />
					<Route path="categorization-rules" element={<CategorizationRulesPage />} />
				</Route>
			</Routes>
		</BrowserRouter>
	);
}

export default function App() {
	return (
		<SessionProvider>
			<TooltipProvider>
				<Gate />
				<Toaster />
			</TooltipProvider>
		</SessionProvider>
	);
}
