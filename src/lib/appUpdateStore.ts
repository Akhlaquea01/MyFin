// State of the Android app's self-update, kept outside React on purpose: a download takes a while,
// and the user can leave the About page and come back. A store at module level keeps the progress
// (and the Install button) across that, which component state would lose.
import {
	checkForNativeUpdate,
	describeUpdateError,
	downloadNativeUpdate,
	installNativeUpdate,
	type NativeInstallStatus,
	type NativeUpdateCheck
} from './native/nativeAppUpdate';

export interface AppUpdateInfo {
	version: string;
	/** APK size in bytes. */
	size: number;
	notes: string;
	publishedAt: string;
}

export type AppUpdateState =
	| { phase: 'idle' }
	| { phase: 'checking' }
	| { phase: 'up-to-date'; version: string }
	| { phase: 'available'; update: AppUpdateInfo }
	| { phase: 'downloading'; update: AppUpdateInfo; received: number; total: number }
	/** Downloaded and verified. `installer`: what the last tap of Install did. */
	| { phase: 'ready'; update: AppUpdateInfo; installer: 'idle' | 'opened' | 'needs-permission' }
	/** `retry` is the step to run again; `update` is set once an update has been found. */
	| {
			phase: 'error';
			message: string;
			retry: 'check' | 'download' | 'install';
			update?: AppUpdateInfo;
	  };

/** The native calls the store needs; the real ones are the default, tests pass their own. */
export interface AppUpdateApi {
	check(): Promise<NativeUpdateCheck>;
	download(onProgress: (received: number, total: number) => void): Promise<void>;
	install(): Promise<NativeInstallStatus>;
	describeError(err: unknown): string;
}

const nativeApi: AppUpdateApi = {
	check: checkForNativeUpdate,
	download: downloadNativeUpdate,
	install: installNativeUpdate,
	describeError: describeUpdateError
};

export function createAppUpdateStore(api: AppUpdateApi = nativeApi) {
	let state: AppUpdateState = { phase: 'idle' };
	const listeners = new Set<() => void>();

	function set(next: AppUpdateState): void {
		state = next;
		for (const listener of listeners) listener();
	}

	async function runInstall(update: AppUpdateInfo): Promise<void> {
		try {
			const status = await api.install();
			set({
				phase: 'ready',
				update,
				installer: status === 'permission-needed' ? 'needs-permission' : 'opened'
			});
		} catch (err) {
			set({ phase: 'error', message: api.describeError(err), retry: 'install', update });
		}
	}

	return {
		getState: (): AppUpdateState => state,

		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		/** Asks GitHub for the newest release. Ignored while a check or download is running. */
		async check(): Promise<void> {
			if (state.phase === 'checking' || state.phase === 'downloading') return;
			set({ phase: 'checking' });
			try {
				const result = await api.check();
				if (!result.updateAvailable) {
					set({ phase: 'up-to-date', version: result.installedVersion });
					return;
				}
				set({
					phase: 'available',
					update: {
						version: result.latestVersion,
						size: result.size,
						notes: result.notes,
						publishedAt: result.publishedAt
					}
				});
			} catch (err) {
				set({ phase: 'error', message: api.describeError(err), retry: 'check' });
			}
		},

		/** Downloads the update found by `check`, then opens Android's installer on it. */
		async download(): Promise<void> {
			const update =
				state.phase === 'available' || state.phase === 'error' ? state.update : undefined;
			if (!update) return;
			set({ phase: 'downloading', update, received: 0, total: update.size });
			try {
				await api.download((received, total) => {
					if (state.phase === 'downloading') {
						set({ phase: 'downloading', update, received, total: total || update.size });
					}
				});
			} catch (err) {
				set({ phase: 'error', message: api.describeError(err), retry: 'download', update });
				return;
			}
			await runInstall(update);
		},

		/** Opens Android's installer again on the file already downloaded. */
		async install(): Promise<void> {
			const update =
				state.phase === 'ready' || (state.phase === 'error' && state.retry === 'install')
					? state.update
					: undefined;
			if (!update) return;
			await runInstall(update);
		}
	};
}

/** The one store the app uses. */
export const appUpdateStore = createAppUpdateStore();

/** "8.4 MB"; "" when the size is unknown. */
export function formatMegabytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '';
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
