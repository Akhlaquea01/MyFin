import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { useSession } from '../context/SessionContext';
import { NotificationPreferenceRepository } from '../data/dexie/notificationRepository';

// User Story 3 (P3): enable/disable, and tune the reminder lead time and budget threshold.
export function NotificationSettingsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [loading, setLoading] = useState(true);
	const [enabled, setEnabled] = useState(true);
	const [reminderLeadDays, setReminderLeadDays] = useState('1');
	const [budgetThresholdPercent, setBudgetThresholdPercent] = useState('80');

	useEffect(() => {
		void NotificationPreferenceRepository.get(key).then((pref) => {
			setEnabled(pref.enabled);
			setReminderLeadDays(String(pref.reminderLeadDays));
			setBudgetThresholdPercent(String(pref.budgetThresholdPercent));
			setLoading(false);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function save(
		changes: Partial<{
			enabled: boolean;
			reminderLeadDays: number;
			budgetThresholdPercent: number;
		}>
	) {
		await NotificationPreferenceRepository.save(key, changes);
	}

	async function handleEnabledChange(value: boolean) {
		setEnabled(value);
		await save({ enabled: value });
		toast.success(value ? 'Notifications enabled' : 'Notifications disabled');
	}

	async function handleLeadDaysBlur() {
		const parsed = parseInt(reminderLeadDays, 10);
		if (!Number.isFinite(parsed) || parsed < 0) return;
		await save({ reminderLeadDays: parsed });
		toast.success('Reminder lead time updated');
	}

	async function handleThresholdBlur() {
		const parsed = parseInt(budgetThresholdPercent, 10);
		if (!Number.isFinite(parsed) || parsed < 0) return;
		await save({ budgetThresholdPercent: parsed });
		toast.success('Budget threshold updated');
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
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="reminder-lead-days">Recurring reminder lead time (days)</Label>
						<Input
							id="reminder-lead-days"
							type="number"
							min="0"
							step="1"
							value={reminderLeadDays}
							onChange={(e) => setReminderLeadDays(e.target.value)}
							onBlur={handleLeadDaysBlur}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="budget-threshold">Budget alert threshold (%)</Label>
						<Input
							id="budget-threshold"
							type="number"
							min="0"
							step="1"
							value={budgetThresholdPercent}
							onChange={(e) => setBudgetThresholdPercent(e.target.value)}
							onBlur={handleThresholdBlur}
						/>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
