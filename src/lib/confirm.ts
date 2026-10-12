import { createContext, useContext, useMemo } from 'react';

export interface ConfirmOptions {
	/** What is being asked, in the user's terms. Line breaks are kept. */
	message: string;
	title?: string;
	/** The action's own name ("Move to trash", "Discard") rather than a bare "OK". */
	confirmLabel?: string;
	cancelLabel?: string;
	/** Red button — for anything that cannot be undone. */
	destructive?: boolean;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Falls back to the browser's own prompt when no provider is mounted (component tests). */
const nativeConfirm: ConfirmFn = async ({ message }) => window.confirm(message);

/**
 * Asks the user to confirm something, in the app's own dialog (see `ConfirmProvider`). Resolves
 * `true` only when the action button is pressed; Cancel, Escape and clicking outside all resolve
 * `false`.
 */
export function useConfirm(): ConfirmFn {
	const confirm = useContext(ConfirmContext);
	return useMemo(() => confirm ?? nativeConfirm, [confirm]);
}
