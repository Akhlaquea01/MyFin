// FR-044 / research.md #4: request durable storage so the browser won't silently evict
// this app's data under storage pressure. Not supported on Safari as of current shipping
// versions — callers must handle `false` by warning the user (StorageWarningBanner.tsx).

export async function requestPersistentStorage(): Promise<boolean> {
	if (!navigator.storage?.persist) return false;
	try {
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

export async function isStoragePersisted(): Promise<boolean> {
	if (!navigator.storage?.persisted) return false;
	try {
		return await navigator.storage.persisted();
	} catch {
		return false;
	}
}
