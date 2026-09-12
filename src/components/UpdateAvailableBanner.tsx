import { RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { useAppUpdate } from '../hooks/useAppUpdate';

/** Shown when a new version has finished downloading in the background. Nothing changes until
 *  the user acts — see useAppUpdate.ts for why this deliberately isn't a self-applying update. */
export function UpdateAvailableBanner() {
	const { needRefresh, updateNow, dismiss } = useAppUpdate();
	if (!needRefresh) return null;

	return (
		<div
			role="alert"
			className="flex items-start gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm text-foreground"
		>
			<RefreshCw className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
			<p className="flex-1">A new version of MyFin (v{__APP_VERSION__}) is available.</p>
			<div className="flex gap-2">
				<Button size="sm" onClick={updateNow}>
					Update now
				</Button>
				<Button variant="ghost" size="sm" onClick={dismiss}>
					Later
				</Button>
			</div>
		</div>
	);
}
