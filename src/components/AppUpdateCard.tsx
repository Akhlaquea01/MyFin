import { CheckCircle2, Download, RefreshCw, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Progress } from './ui/progress';
import { useNativeAppUpdate } from '../hooks/useNativeAppUpdate';
import { appUpdateStore, formatMegabytes } from '../lib/appUpdateStore';

/**
 * About > App updates (Android app only): look for a newer MyFin on GitHub, download it and hand it
 * to Android's installer. Nothing happens by itself; every request starts from a button here.
 * Android asks for its own confirmation before replacing the app, and the data stays.
 */
export function AppUpdateCard({ store = appUpdateStore }: { store?: typeof appUpdateStore }) {
	const state = useNativeAppUpdate(store);
	const busy = state.phase === 'checking' || state.phase === 'downloading';
	// The update that was found, in every state after a check found one.
	const update = 'update' in state ? state.update : undefined;

	return (
		<Card className="mb-6">
			<CardHeader>
				<CardTitle className="text-base">App updates</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3 text-sm">
				<div aria-live="polite" className="flex flex-col gap-3">
					{state.phase === 'idle' && (
						<p className="text-muted-foreground">
							Look for a newer version of MyFin. It is checked only when you press the button.
						</p>
					)}

					{state.phase === 'checking' && (
						<p className="text-muted-foreground">Looking for a newer version…</p>
					)}

					{state.phase === 'up-to-date' && (
						<p className="flex items-center gap-2">
							<CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
							You have the latest version ({state.version}).
						</p>
					)}

					{update && (
						<>
							<p className="font-medium">
								Version {update.version} is available
								{update.size > 0 && (
									<span className="font-normal text-muted-foreground">
										{' '}
										({formatMegabytes(update.size)})
									</span>
								)}
							</p>
							{update.notes && (
								<div className="max-h-40 overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-line text-muted-foreground">
									{update.notes}
								</div>
							)}
						</>
					)}

					{state.phase === 'downloading' && (
						<div className="flex flex-col gap-1.5">
							<Progress
								aria-label="Download progress"
								value={state.total > 0 ? Math.min(100, (state.received / state.total) * 100) : 0}
							/>
							<p className="text-xs text-muted-foreground">
								Downloading… {formatMegabytes(state.received)}
								{state.total > 0 && ` of ${formatMegabytes(state.total)}`}
							</p>
						</div>
					)}

					{state.phase === 'ready' && state.installer === 'needs-permission' && (
						<p className="text-muted-foreground">
							Android opened a settings screen. Switch on <strong>Allow from this source</strong>{' '}
							for MyFin, go back here and tap Install.
						</p>
					)}
					{state.phase === 'ready' && state.installer === 'opened' && (
						<p className="text-muted-foreground">
							Confirm the update in Android&apos;s dialog. If you dismissed it, tap Install again.
							Your data stays.
						</p>
					)}
					{state.phase === 'ready' && state.installer === 'idle' && (
						<p className="text-muted-foreground">Downloaded. Tap Install to finish.</p>
					)}

					{state.phase === 'error' && (
						<Alert variant="destructive">
							<TriangleAlert aria-hidden="true" />
							<AlertDescription>{state.message}</AlertDescription>
						</Alert>
					)}
				</div>

				<div className="flex flex-wrap gap-2">
					{state.phase === 'available' && (
						<Button type="button" onClick={() => void store.download()}>
							<Download className="mr-2 size-4" aria-hidden="true" /> Download and install
						</Button>
					)}
					{state.phase === 'ready' && (
						<Button type="button" onClick={() => void store.install()}>
							<Download className="mr-2 size-4" aria-hidden="true" /> Install
						</Button>
					)}
					{state.phase === 'error' && state.retry !== 'check' && (
						<Button
							type="button"
							onClick={() => void (state.retry === 'install' ? store.install() : store.download())}
						>
							Try again
						</Button>
					)}
					{(state.phase === 'idle' ||
						state.phase === 'checking' ||
						state.phase === 'up-to-date' ||
						state.phase === 'available' ||
						state.phase === 'error') && (
						<Button
							type="button"
							variant={
								state.phase === 'available' || state.phase === 'error' ? 'outline' : 'default'
							}
							disabled={busy}
							onClick={() => void store.check()}
						>
							<RefreshCw
								className={`mr-2 size-4 ${state.phase === 'checking' ? 'animate-spin' : ''}`}
								aria-hidden="true"
							/>
							{state.phase === 'checking' ? 'Checking…' : 'Check for updates'}
						</Button>
					)}
				</div>

				<p className="text-xs text-muted-foreground">
					Updates come from MyFin&apos;s releases on GitHub. Only your phone&apos;s address and a
					generic app name reach GitHub; nothing from your data is sent.
				</p>
			</CardContent>
		</Card>
	);
}
