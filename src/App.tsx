import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { SessionProvider, useSession } from './context/SessionContext';
import { acquireSingleInstanceLock, type InstanceRole } from './lib/singleInstance';
import { UserProfileRepository } from './data/dexie/userProfileRepository';
import { runNotificationCheck } from './domain/notifications/runNotificationCheck';
import { runBlindIndexMaintenance } from './data/dexie/blindIndexMaintenance';
import { isStoragePersisted } from './data/storage/persistence';
import { OnboardingScreen } from './components/OnboardingScreen';
import { LockScreen } from './components/LockScreen';
import { BlockedScreen } from './components/BlockedScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StorageWarningBanner } from './components/StorageWarningBanner';
import { UpdateAvailableBanner } from './components/UpdateAvailableBanner';
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
import { ShareTargetLandingPage } from './pages/ShareTargetLandingPage';
import { ReviewPage } from './pages/ReviewPage';
import { BulkTextImportPage } from './pages/BulkTextImportPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { RecurringPage } from './pages/RecurringPage';
import { RecurringUpcomingPage } from './pages/RecurringUpcomingPage';
import { InvestmentsPage } from './pages/InvestmentsPage';
import { LiabilitiesPage } from './pages/LiabilitiesPage';
import { DebtPayoffPlannerPage } from './pages/DebtPayoffPlannerPage';
import { SavingsGoalsPage } from './pages/SavingsGoalsPage';
import { PeoplePage } from './pages/PeoplePage';
import { NotificationSettingsPage } from './pages/NotificationSettingsPage';
import { NetWorthPage } from './pages/NetWorthPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { FinancialHealthPage } from './pages/FinancialHealthPage';
import { ImportPage } from './pages/ImportPage';
import { ExportPage } from './pages/ExportPage';
import { BackupSettingsPage } from './pages/BackupSettingsPage';
import { CategorizationRulesPage } from './pages/CategorizationRulesPage';
import { AboutPage } from './pages/AboutPage';
import { QuickTourProvider } from './components/ui/quick-tour/QuickTourProvider';
import { QuickTourOverlay } from './components/ui/quick-tour/QuickTourOverlay';
import { QUICK_TOUR_STEPS } from './components/ui/quick-tour/tour-steps';

/**
 * Work that needs an encryption key and should happen once per unlock, whether that unlock was
 * manual or a silently resumed session. Deliberately fire-and-forget, but with its own error
 * handling: none of it is worth blocking the UI on, and none of it should become an unhandled
 * promise rejection either.
 */
async function afterUnlock(key: CryptoKey): Promise<void> {
	// Finishes the schema v8 index migration for rows written before it — a Dexie upgrade has
	// no encryption key, so the digests can only be computed here. Idempotent; a no-op once
	// complete (see blindIndexMaintenance.ts).
	try {
		await runBlindIndexMaintenance(key);
	} catch (err) {
		console.warn('[afterUnlock] blind index maintenance failed', err);
	}
	// research.md §3 (spec 004): "app opened" is treated as "just unlocked".
	try {
		await runNotificationCheck(key);
	} catch (err) {
		console.warn('[afterUnlock] notification check failed', err);
	}
}

// Root security/availability gate (Constitution Principles I & II, FR-001–006, FR-044,
// FR-045). Every route renders only after this gate clears: not blocked by another tab,
// then onboarded, then unlocked. Nothing below this gate can run before those resolve.
function Gate() {
	const session = useSession();
	const { recordActivity, restoreSession, setOnboarded, getEncryptionKey, lock } = session;
	// 'checking' is distinct from 'secondary': initialising to 'secondary' rendered
	// BlockedScreen for a frame on every cold start, before the async lock request resolved.
	const [role, setRole] = useState<InstanceRole | 'checking'>('checking');
	const [checkingProfile, setCheckingProfile] = useState(true);
	const [profileExists, setProfileExists] = useState(false);
	const [showStorageWarning, setShowStorageWarning] = useState(false);
	// The PIN is held in a ref, never in state: state is serialized into the React DevTools
	// tree, profiler recordings, and the props snapshot of any error reporter, and the PIN is
	// strictly more sensitive than the derived key (it also opens every backup ever exported).
	// Constitution Principle II. A boolean drives the prompt's visibility instead.
	const transientPinRef = useRef<string | null>(null);
	const [showEnrollPrompt, setShowEnrollPrompt] = useState(false);

	useEffect(() => {
		const stopLock = acquireSingleInstanceLock(setRole);
		void isStoragePersisted().then((persisted) => setShowStorageWarning(!persisted));

		// Spec 008: registered independently of (and at a narrower scope than) the
		// vite-plugin-pwa-managed root service worker, so it never affects offline asset
		// caching — see public/sw-share-target.js and research.md §2. Registration itself
		// needs no encryption key/unlock state, so it happens unconditionally here.
		if ('serviceWorker' in navigator) {
			void navigator.serviceWorker.register('/sw-share-target.js', { scope: '/share-target' });
		}

		const activityEvents = ['click', 'keydown', 'pointerdown'] as const;
		const onActivity = recordActivity;
		for (const evt of activityEvents) window.addEventListener(evt, onActivity);

		// Before ever falling back to LockScreen, try to silently resume a session persisted
		// before this reload (spec 009) — otherwise every refresh forces PIN/biometric entry
		// even seconds after the user last unlocked, regardless of their auto-lock timeout.
		void (async () => {
			const p = await UserProfileRepository.get();
			setProfileExists(!!p);
			setOnboarded(!!p);
			if (p) {
				const restored = await restoreSession(p.autoLockTimeoutMs);
				if (restored) void afterUnlock(getEncryptionKey());
			}
			setCheckingProfile(false);
		})();

		return () => {
			stopLock();
			for (const evt of activityEvents) window.removeEventListener(evt, onActivity);
		};
	}, [recordActivity, restoreSession, setOnboarded, getEncryptionKey]);

	function handleUnlock(pin: string) {
		transientPinRef.current = pin;
		// Decide the enrollment prompt from freshly-read data, not from state a parallel
		// refresh may not have written yet — reading stale state here flashed the prompt at
		// users who had already enrolled.
		void UserProfileRepository.get().then((p) => {
			setProfileExists(!!p);
			setOnboarded(!!p);
			setShowEnrollPrompt(!p?.webauthn);
			setCheckingProfile(false);
		});
		// research.md §3 (spec 004): "app opened" is treated as "just unlocked," the same
		// hook point BiometricEnrollmentPrompt already uses.
		void afterUnlock(getEncryptionKey());
	}

	if (role === 'checking') return <div className="min-h-dvh bg-background" />;
	if (role === 'secondary') return <BlockedScreen />;
	if (checkingProfile) return <div className="min-h-dvh bg-background" />;
	if (!profileExists) return <OnboardingScreen onunlock={handleUnlock} />;
	if (session.isLocked) return <LockScreen onunlock={handleUnlock} />;

	return (
		<QuickTourProvider totalSteps={QUICK_TOUR_STEPS.length}>
			<BrowserRouter>
				<ErrorBoundary onReset={lock}>
					<UpdateAvailableBanner />
					{showStorageWarning && <StorageWarningBanner />}
					{showEnrollPrompt && (
						<BiometricEnrollmentPrompt
							getPin={() => transientPinRef.current}
							onDone={() => {
								transientPinRef.current = null;
								setShowEnrollPrompt(false);
							}}
						/>
					)}
					<NotificationPermissionPrompt />
					<QuickTourOverlay />
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
							<Route path="people" element={<PeoplePage />} />
							<Route path="recurring" element={<RecurringPage />} />
							<Route path="recurring/upcoming" element={<RecurringUpcomingPage />} />
							<Route path="investments" element={<InvestmentsPage />} />
							<Route path="liabilities" element={<LiabilitiesPage />} />
							<Route path="liabilities/payoff-planner" element={<DebtPayoffPlannerPage />} />
							<Route path="net-worth" element={<NetWorthPage />} />
							<Route path="financial-health" element={<FinancialHealthPage />} />
							<Route path="analytics" element={<AnalyticsPage />} />
							<Route path="import" element={<ImportPage />} />
							<Route path="export" element={<ExportPage />} />
							<Route path="backup" element={<BackupSettingsPage />} />
							<Route path="notification-settings" element={<NotificationSettingsPage />} />
							<Route path="categorization-rules" element={<CategorizationRulesPage />} />
							<Route path="about" element={<AboutPage />} />
						</Route>
						{/* Spec 008: a pure redirect, deliberately outside AppShell — no nav shell needed
						    for what's only ever a brief loading state before navigating onward. */}
						<Route path="share-target-landing" element={<ShareTargetLandingPage />} />
					</Routes>
				</ErrorBoundary>
			</BrowserRouter>
		</QuickTourProvider>
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
