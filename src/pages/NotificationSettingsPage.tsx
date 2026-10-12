import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { useSession } from '../context/SessionContext';
import { useAppActive } from '../hooks/useAppActive';
import { NotificationPreferenceRepository } from '../data/dexie/notificationRepository';
import { getNotifyPermission, requestNotifyPermission, type NotifyPermission } from '../lib/notify';
import {
	TransactionCapture,
	isTransactionCaptureAvailable
} from '../lib/native/transactionCapture';

const MAX_LEAD_DAYS = 30;

/** A whole number within [min, max], or a message saying what is wrong. */
function validateWholeNumber(raw: string, min: number, max: number, what: string): string | null {
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return `Enter a whole number for ${what}.`;
	const value = Number(trimmed);
	if (value < min || value > max)
		return `${what[0].toUpperCase()}${what.slice(1)} must be ${min}–${max}.`;
	return null;
}

// User Story 3 (P3): enable/disable, and tune the reminder lead time and budget threshold.
export function NotificationSettingsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const { activationCount } = useAppActive();

	const [loading, setLoading] = useState(true);
	const [enabled, setEnabled] = useState(true);
	const [reminderLeadDays, setReminderLeadDays] = useState('1');
	const [budgetThresholdPercent, setBudgetThresholdPercent] = useState('80');
	const [saved, setSaved] = useState({ reminderLeadDays: '1', budgetThresholdPercent: '80' });
	const [leadError, setLeadError] = useState<string | null>(null);
	const [thresholdError, setThresholdError] = useState<string | null>(null);
	const [permission, setPermission] = useState<NotifyPermission | null>(null);

	useEffect(() => {
		void NotificationPreferenceRepository.get(key)
			.then((pref) => {
				setEnabled(pref.enabled);
				setReminderLeadDays(String(pref.reminderLeadDays));
				setBudgetThresholdPercent(String(pref.budgetThresholdPercent));
				setSaved({
					reminderLeadDays: String(pref.reminderLeadDays),
					budgetThresholdPercent: String(pref.budgetThresholdPercent)
				});
			})
			.catch(() => toast.error('Could not load your notification settings.'))
			.finally(() => setLoading(false));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Re-read on every return to the app: the user leaves to flip the switch in Android settings.
	const refreshPermission = useCallback(async () => {
		setPermission(await getNotifyPermission());
	}, []);
	useEffect(() => {
		void refreshPermission();
	}, [refreshPermission, activationCount]);

	async function save(
		changes: Partial<{
			enabled: boolean;
			reminderLeadDays: number;
			budgetThresholdPercent: number;
		}>
	): Promise<boolean> {
		try {
			await NotificationPreferenceRepository.save(key, changes);
			return true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save that setting.');
			return false;
		}
	}

	async function handleEnabledChange(value: boolean) {
		setEnabled(value);
		if (await save({ enabled: value })) {
			toast.success(value ? 'Notifications enabled' : 'Notifications disabled');
		} else {
			setEnabled(!value);
		}
	}

	async function handleLeadDaysBlur() {
		const problem = validateWholeNumber(
			reminderLeadDays,
			0,
			MAX_LEAD_DAYS,
			'the lead time in days'
		);
		setLeadError(problem);
		if (problem || reminderLeadDays.trim() === saved.reminderLeadDays) return;
		if (await save({ reminderLeadDays: Number(reminderLeadDays) })) {
			setSaved((s) => ({ ...s, reminderLeadDays: reminderLeadDays.trim() }));
			toast.success('Reminder lead time updated');
		}
	}

	async function handleThresholdBlur() {
		const problem = validateWholeNumber(budgetThresholdPercent, 1, 100, 'the alert threshold');
		setThresholdError(problem);
		if (problem || budgetThresholdPercent.trim() === saved.budgetThresholdPercent) return;
		if (await save({ budgetThresholdPercent: Number(budgetThresholdPercent) })) {
			setSaved((s) => ({ ...s, budgetThresholdPercent: budgetThresholdPercent.trim() }));
			toast.success('Budget threshold updated');
		}
	}

	async function handleAllow() {
		const result = await requestNotifyPermission();
		setPermission(result);
		if (result !== 'granted') toast.info('Notifications are still off. See the note below.');
	}

	if (loading) {
		return (
			<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
				<p className="text-sm text-muted-foreground">Loading…</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center gap-2">
				<Bell className="size-6 text-primary" />
				<h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
			</div>

			{enabled && permission !== null && permission !== 'granted' && (
				<div
					role="status"
					className="mb-6 flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
				>
					{permission === 'default' && (
						<>
							<p>Reminders are on, but your device has not been asked to let MyFin notify you.</p>
							<div>
								<Button size="sm" onClick={() => void handleAllow()}>
									Allow notifications
								</Button>
							</div>
						</>
					)}
					{permission === 'denied' && (
						<>
							<p>
								Notifications are blocked for MyFin, so no reminder will appear even though the
								switch below is on. Allow them in your device’s settings for MyFin.
							</p>
							{isTransactionCaptureAvailable() && (
								<div>
									<Button
										size="sm"
										variant="outline"
										onClick={() => void TransactionCapture.openAppSettings()}
									>
										Open app settings
									</Button>
								</div>
							)}
						</>
					)}
					{permission === 'unsupported' && (
						<p>This device or browser cannot show notifications, so reminders will not appear.</p>
					)}
				</div>
			)}

			<Card>
				<CardHeader>
					<CardTitle className="text-base">Preferences</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-6">
					<div className="flex items-center justify-between">
						<Label htmlFor="notifications-enabled">Enable notifications</Label>
						<Switch
							id="notifications-enabled"
							checked={enabled}
							onCheckedChange={handleEnabledChange}
						/>
					</div>
					<p className="-mt-3 text-xs text-muted-foreground">
						MyFin checks for due bills, budget limits and overdue loans each time you unlock it, so
						a reminder appears when you open the app — not while it is closed. Tapping one takes you
						to the matching screen, and every one is kept in your{' '}
						<Link to="/alerts" className="underline underline-offset-2">
							list of alerts
						</Link>
						.
					</p>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="reminder-lead-days">Recurring reminder lead time (days)</Label>
						<Input
							id="reminder-lead-days"
							type="number"
							min="0"
							max={MAX_LEAD_DAYS}
							step="1"
							value={reminderLeadDays}
							aria-invalid={leadError !== null}
							onChange={(e) => {
								setReminderLeadDays(e.target.value);
								setLeadError(null);
							}}
							onBlur={handleLeadDaysBlur}
						/>
						{leadError && (
							<p role="alert" className="text-sm text-destructive">
								{leadError}
							</p>
						)}
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="budget-threshold">Budget alert threshold (%)</Label>
						<Input
							id="budget-threshold"
							type="number"
							min="1"
							max="100"
							step="1"
							value={budgetThresholdPercent}
							aria-invalid={thresholdError !== null}
							onChange={(e) => {
								setBudgetThresholdPercent(e.target.value);
								setThresholdError(null);
							}}
							onBlur={handleThresholdBlur}
						/>
						{thresholdError && (
							<p role="alert" className="text-sm text-destructive">
								{thresholdError}
							</p>
						)}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
