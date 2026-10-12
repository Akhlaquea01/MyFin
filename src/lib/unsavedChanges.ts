import { useEffect } from 'react';

// Which screens currently hold something the user has typed and not saved. A share arriving from
// another app navigates to Quick Add or New Transaction, which would throw a half-filled form
// away without a word; the share bridge asks first when anything is registered here.
const dirty = new Set<symbol>();

/** Registers this screen as holding unsaved input for as long as `isDirty` is true. */
export function useUnsavedChanges(isDirty: boolean): void {
	useEffect(() => {
		if (!isDirty) return;
		const token = Symbol('unsaved');
		dirty.add(token);
		return () => {
			dirty.delete(token);
		};
	}, [isDirty]);
}

export function hasUnsavedChanges(): boolean {
	return dirty.size > 0;
}
