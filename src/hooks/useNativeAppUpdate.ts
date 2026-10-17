import { useSyncExternalStore } from 'react';
import { appUpdateStore, type AppUpdateState } from '../lib/appUpdateStore';

/** The Android app's self-update state (see lib/appUpdateStore.ts); re-renders as it changes. */
export function useNativeAppUpdate(store: typeof appUpdateStore = appUpdateStore): AppUpdateState {
	return useSyncExternalStore(store.subscribe, store.getState);
}
