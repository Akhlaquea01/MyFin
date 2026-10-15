import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DatabaseBackup } from 'lucide-react';
import { Button } from './ui/button';
import { AutoBackupSettingsRepository } from '../data/dexie/autoBackupSettingsRepository';
import {
	daysSinceLastBackup,
	isBackupOverdue,
	loadBackupReminderSettings
} from '../lib/backupReminder';
import { isNativeApp } from '../lib/native/platform';
import { safeGetItem, safeSetItem } from '../lib/safeStorage';
import { todayLocalISO } from '../domain/shared/dateMath';

const DISMISSED_DAY_KEY = 'myfin.backupNudgeDay';

/**
 * Tells the user, on the page they open first, that they have no recent backup. MyFin keeps all
 * data on the device — on Android a reinstall, a cleared cache or a new phone erases it — so a
 * stale backup is the biggest risk the app has, and until now it was only mentioned on the Backup
 * page itself. Dismissing hides it for the rest of the day.
 */
export function BackupNudgeBanner({ hasData }: { hasData: boolean }) {
	const [days, setDays] = useState<number | null | undefined>(undefined);
	const [dismissed, setDismissed] = useState(
		() => safeGetItem(DISMISSED_DAY_KEY) === todayLocalISO()
	);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const scheduled = await AutoBackupSettingsRepository.get().catch(() => null);
			if (!cancelled) {
				setDays(daysSinceLastBackup(loadBackupReminderSettings(), scheduled?.lastBackupAt));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	if (!hasData || dismissed || days === undefined || !isBackupOverdue(days)) return null;

	return (
		<div
			role="status"
			className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
		>
			<DatabaseBackup className="size-4 shrink-0" aria-hidden="true" />
			<p className="min-w-[14rem] flex-1">
				{days === null
					? 'You have not backed up your data yet.'
					: `Your last backup was ${days} days ago.`}{' '}
				{isNativeApp()
					? 'It lives only on this phone — uninstalling the app or changing phones would erase it.'
					: 'It lives only in this browser — clearing site data would erase it.'}
			</p>
			<div className="flex gap-2">
				<Button size="sm" asChild>
					<Link to="/backup">Back up now</Link>
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => {
						safeSetItem(DISMISSED_DAY_KEY, todayLocalISO());
						setDismissed(true);
					}}
				>
					Later
				</Button>
			</div>
		</div>
	);
}
