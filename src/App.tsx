import { lazy, useEffect, useRef, useState, type ComponentType } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { SessionProvider, useSession } from './context/SessionContext';
import { acquireSingleInstanceLock, type InstanceRole } from './lib/singleInstance';
import { subscribeAppActive } from './lib/native/appState';
import { isNativeApp } from './lib/native/platform';
import { isBiometricEnrolled } from './lib/biometric';
import { shouldReloadForStaleChunk } from './lib/staleChunk';
import { isBiometricPromptSnoozed } from './lib/biometricPromptSnooze';
import { useQuickTour } from './hooks/useQuickTour';
import { syncCapturedTransactions, useCaptureSync } from './hooks/useCaptureSync';
import { UserProfileRepository } from './data/dexie/userProfileRepository';
import { runNotificationCheck } from './domain/notifications/runNotificationCheck';
import { ensureDailyNetWorthSnapshot } from './domain/wealth/wealthEngine';
import { runBlindIndexMaintenance } from './data/dexie/blindIndexMaintenance';
import { maybeRunScheduledBackup } from './data/io/autoBackupService';
import { syncBackupReminder } from './data/io/backupReminderService';
import { isStoragePersisted } from './data/storage/persistence';
import { OnboardingScreen } from './components/OnboardingScreen';
import { LockScreen } from './components/LockScreen';
import { BlockedScreen } from './components/BlockedScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StorageWarningBanner } from './components/StorageWarningBanner';
import { UpdateAvailableBanner } from './components/UpdateAvailableBanner';
import { BiometricEnrollmentPrompt } from './components/BiometricEnrollmentPrompt';
import { NotificationPermissionPrompt } from './components/NotificationPermissionPrompt';
import { NativeShareBridge } from './components/NativeShareBridge';
import { AndroidBackHandler } from './components/AndroidBackHandler';
import { NotificationTapHandler } from './components/NotificationTapHandler';
import { CaptureHealthBanner } from './components/CaptureHealthBanner';
import { AppShell } from './components/AppShell';
import { ConfirmProvider } from './components/ConfirmProvider';
import { DashboardPage } from './pages/DashboardPage';
import { QuickTourProvider } from './components/ui/quick-tour/QuickTourProvider';
import { QuickTourOverlay } from './components/ui/quick-tour/QuickTourOverlay';
import { QUICK_TOUR_STEPS } from './components/ui/quick-tour/tour-steps';

/**
 * Pages load on demand: the whole app used to ship as one 2.3 MB script that the lock screen had
 * to download and parse before showing anything. The service worker precaches every chunk, so
 * offline use is unaffected. The dashboard stays in the main bundle as the first screen after unlock.
 */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
	return lazy(async () => {
		try {
			return { default: (await load())[name] };
		} catch (error) {
			// The build this tab started from has been replaced: reload once to pick up the new one.
			if (!shouldReloadForStaleChunk()) throw error;
			window.location.reload();
			return new Promise<never>(() => {});
		}
	});
}

const AccountsPage = lazyPage(() => import('./pages/AccountsPage'), 'AccountsPage');
const TransactionsPage = lazyPage(() => import('./pages/TransactionsPage'), 'TransactionsPage');
const NewTransactionPage = lazyPage(
	() => import('./pages/NewTransactionPage'),
	'NewTransactionPage'
);
const TransferPage = lazyPage(() => import('./pages/TransferPage'), 'TransferPage');
const CategoriesPage = lazyPage(() => import('./pages/CategoriesPage'), 'CategoriesPage');
const QuickAddPage = lazyPage(() => import('./pages/QuickAddPage'), 'QuickAddPage');
const ShareTargetLandingPage = lazyPage(
	() => import('./pages/ShareTargetLandingPage'),
	'ShareTargetLandingPage'
);
const ReviewPage = lazyPage(() => import('./pages/ReviewPage'), 'ReviewPage');
const BulkTextImportPage = lazyPage(
	() => import('./pages/BulkTextImportPage'),
	'BulkTextImportPage'
);
const BudgetsPage = lazyPage(() => import('./pages/BudgetsPage'), 'BudgetsPage');
const RecurringPage = lazyPage(() => import('./pages/RecurringPage'), 'RecurringPage');
const RecurringUpcomingPage = lazyPage(
	() => import('./pages/RecurringUpcomingPage'),
	'RecurringUpcomingPage'
);
const InvestmentsPage = lazyPage(() => import('./pages/InvestmentsPage'), 'InvestmentsPage');
const LiabilitiesPage = lazyPage(() => import('./pages/LiabilitiesPage'), 'LiabilitiesPage');
const DebtPayoffPlannerPage = lazyPage(
	() => import('./pages/DebtPayoffPlannerPage'),
	'DebtPayoffPlannerPage'
);
const SavingsGoalsPage = lazyPage(() => import('./pages/SavingsGoalsPage'), 'SavingsGoalsPage');
const PeoplePage = lazyPage(() => import('./pages/PeoplePage'), 'PeoplePage');
const NotificationSettingsPage = lazyPage(
	() => import('./pages/NotificationSettingsPage'),
	'NotificationSettingsPage'
);
const NetWorthPage = lazyPage(() => import('./pages/NetWorthPage'), 'NetWorthPage');
const AnalyticsPage = lazyPage(() => import('./pages/AnalyticsPage'), 'AnalyticsPage');
const FinancialHealthPage = lazyPage(
	() => import('./pages/FinancialHealthPage'),
	'FinancialHealthPage'
);
const ImportPage = lazyPage(() => import('./pages/ImportPage'), 'ImportPage');
const ExportPage = lazyPage(() => import('./pages/ExportPage'), 'ExportPage');
const BackupSettingsPage = lazyPage(
	() => import('./pages/BackupSettingsPage'),
	'BackupSettingsPage'
);
const CategorizationRulesPage = lazyPage(
	() => import('./pages/CategorizationRulesPage'),
	'CategorizationRulesPage'
);
const SubscriptionsPage = lazyPage(() => import('./pages/SubscriptionsPage'), 'SubscriptionsPage');
const CashFlowForecastPage = lazyPage(
	() => import('./pages/CashFlowForecastPage'),
	'CashFlowForecastPage'
);
const BudgetVarianceReportPage = lazyPage(
	() => import('./pages/BudgetVarianceReportPage'),
	'BudgetVarianceReportPage'
);
const AboutPage = lazyPage(() => import('./pages/AboutPage'), 'AboutPage');
const SecurityPage = lazyPage(() => import('./pages/SecurityPage'), 'SecurityPage');
const AutoCapturePage = lazyPage(() => import('./pages/AutoCapturePage'), 'AutoCapturePage');
const NotFoundPage = lazyPage(() => import('./pages/NotFoundPage'), 'NotFoundPage');
const AlertsPage = lazyPage(() => import('./pages/AlertsPage'), 'AlertsPage');

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
	// Bank messages the Android app captured while it was closed or locked. After the blind-index
	// maintenance above: filing an entry looks its merchant up through that index. Never throws.
	await syncCapturedTransactions(key);
	// research.md §3 (spec 004): "app opened" is treated as "just unlocked".
	try {
		await runNotificationCheck(key);
	} catch (err) {
		console.warn('[afterUnlock] notification check failed', err);
	}
	// Net worth history builds itself: the first unlock of each day records that day's point.
	try {
		await ensureDailyNetWorthSnapshot(key);
	} catch (err) {
		console.warn('[afterUnlock] net worth snapshot failed', err);
	}
	// Keeps the weekly backup reminder scheduled against the last backup. Never throws.
	await syncBackupReminder();
}

/**
 * First-run and housekeeping prompts, shown one at a time: the tour first, then the offer to turn
 * on fingerprint unlock, then the offer to turn on notifications. Shown together they pushed the
 * page down while the tour was trying to spotlight things on it.
 */
function StartupPrompts({
	showEnrollPrompt,
	getPin,
	onEnrollDone
}: {
	showEnrollPrompt: boolean;
	getPin: () => string | null;
	onEnrollDone: () => void;
}) {
	const { isTourActive } = useQuickTour();
	if (isTourActive) return null;
	return showEnrollPrompt ? (
		<BiometricEnrollmentPrompt getPin={getPin} onDone={onEnrollDone} />
	) : (
		<NotificationPermissionPrompt />
	);
}

// Root security/availability gate (Constitution Principles I & II, FR-001–006, FR-044,
// FR-045). Every route renders only after this gate clears: not blocked by another tab,
// then onboarded, then unlocked. Nothing below this gate can run before those resolve.
function Gate() {
	const session = useSession();
	const {
		recordActivity,
		restoreSession,
		setOnboarded,
		getEncryptionKey,
		lock,
		handleAppActiveChange,
		setLockOnBackground
	} = session;
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
	// Keeps captured bank messages flowing while the app is open: on return to the foreground and
	// whenever the Android side reports a new one. (The unlock itself is covered by afterUnlock.)
	useCaptureSync(!session.isLocked, getEncryptionKey);

	useEffect(() => {
		const stopLock = acquireSingleInstanceLock(setRole);
		// The Android app keeps its data in the WebView's private storage, which the system does not
		// evict the way a browser can, and which never reports "persisted" — the browser wording
		// would be wrong there.
		if (!isNativeApp()) {
			void isStoragePersisted().then((persisted) => setShowStorageWarning(!persisted));
		}

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

		// The inactivity timer is throttled or frozen while the app is in the background, so on
		// coming back, enforce the auto-lock deadline directly: away longer than the timeout
		// means the lock screen (and the fingerprint prompt) appears; a quick switch does not.
		const stopAppState = subscribeAppActive((active) => {
			handleAppActiveChange(active);
		});

		// Before ever falling back to LockScreen, try to silently resume a session persisted
		// before this reload (spec 009) — otherwise every refresh forces PIN/biometric entry
		// even seconds after the user last unlocked, regardless of their auto-lock timeout.
		void (async () => {
			const p = await UserProfileRepository.get();
			setProfileExists(!!p);
			setOnboarded(!!p);
			if (p) {
				setLockOnBackground(!!p.lockOnBackground);
				const restored = await restoreSession(p.autoLockTimeoutMs);
				if (restored) void afterUnlock(getEncryptionKey());
			}
			setCheckingProfile(false);
		})();

		return () => {
			stopLock();
			stopAppState();
			for (const evt of activityEvents) window.removeEventListener(evt, onActivity);
		};
	}, [
		recordActivity,
		restoreSession,
		setOnboarded,
		getEncryptionKey,
		handleAppActiveChange,
		setLockOnBackground
	]);

	function handleUnlock(pin: string) {
		transientPinRef.current = pin;
		// Decide the enrollment prompt from freshly-read data, not from state a parallel
		// refresh may not have written yet — reading stale state here flashed the prompt at
		// users who had already enrolled.
		void UserProfileRepository.get().then(async (p) => {
			setProfileExists(!!p);
			setOnboarded(!!p);
			setLockOnBackground(!!p?.lockOnBackground);
			// A user who already said "not now" is not asked again after every PIN unlock.
			const needsEnrollPrompt = !(await isBiometricEnrolled(p)) && !isBiometricPromptSnoozed();
			setShowEnrollPrompt(needsEnrollPrompt);
			// With no enrollment prompt to hand it to, nothing else will ever clear the PIN, so
			// drop it now rather than keeping it in memory for the whole session.
			if (!needsEnrollPrompt) transientPinRef.current = null;
			setCheckingProfile(false);
			// spec 019, research.md R5: this is the ONLY moment the plaintext PIN exists in
			// memory (it is never stored — Constitution Principle II), so a scheduled backup
			// (which needs the PIN to derive its encryption key, same as a manual export) can
			// only ever run here, on an explicit unlock — never on the silent session-restore
			// path below, which never has the PIN. No-ops unless a backup is actually due.
			if (p) void maybeRunScheduledBackup(pin, getEncryptionKey(), p);
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
					<CaptureHealthBanner />
					<StartupPrompts
						showEnrollPrompt={showEnrollPrompt}
						getPin={() => transientPinRef.current}
						onEnrollDone={() => {
							transientPinRef.current = null;
							setShowEnrollPrompt(false);
						}}
					/>
					<NativeShareBridge />
					<AndroidBackHandler />
					<NotificationTapHandler />
					<QuickTourOverlay />
					<Routes>
						<Route element={<AppShell />}>
							<Route index element={<DashboardPage />} />
							<Route path="accounts" element={<AccountsPage />} />
							<Route path="transactions" element={<TransactionsPage />} />
							<Route path="transactions/new" element={<NewTransactionPage />} />
							<Route path="transactions/transfer" element={<TransferPage />} />
							<Route path="categories" element={<CategoriesPage />} />
							<Route path="quick-add" element={<QuickAddPage />} />
							<Route path="review" element={<ReviewPage />} />
							<Route path="import/bulk-text" element={<BulkTextImportPage />} />
							<Route path="budgets" element={<BudgetsPage />} />
							<Route path="budgets/variance" element={<BudgetVarianceReportPage />} />
							<Route path="savings-goals" element={<SavingsGoalsPage />} />
							<Route path="people" element={<PeoplePage />} />
							<Route path="recurring" element={<RecurringPage />} />
							<Route path="recurring/upcoming" element={<RecurringUpcomingPage />} />
							<Route path="subscriptions" element={<SubscriptionsPage />} />
							<Route path="forecast" element={<CashFlowForecastPage />} />
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
							<Route path="security" element={<SecurityPage />} />
							<Route path="auto-capture" element={<AutoCapturePage />} />
							<Route path="alerts" element={<AlertsPage />} />
							<Route path="*" element={<NotFoundPage />} />
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
				<ConfirmProvider>
					<Gate />
				</ConfirmProvider>
				<Toaster />
			</TooltipProvider>
		</SessionProvider>
	);
}
