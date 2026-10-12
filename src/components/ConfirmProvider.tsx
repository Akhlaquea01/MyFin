import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from '../lib/confirm';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle
} from './ui/alert-dialog';

interface Pending {
	options: ConfirmOptions;
	resolve: (confirmed: boolean) => void;
}

/**
 * One styled confirmation dialog for the whole app, in place of the browser's `window.confirm`
 * (which looks different on every platform, can't say what the button does, and is blocked
 * outright in some web views). Use `useConfirm()`; it resolves `true` only for the action button.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
	const [pending, setPending] = useState<Pending | null>(null);
	// A ref as well, so a second `confirm()` while one is open cancels the first instead of
	// leaving its caller waiting forever.
	const pendingRef = useRef<Pending | null>(null);

	const confirm = useCallback<ConfirmFn>((options) => {
		pendingRef.current?.resolve(false);
		return new Promise<boolean>((resolve) => {
			const next = { options, resolve };
			pendingRef.current = next;
			setPending(next);
		});
	}, []);

	function settle(confirmed: boolean) {
		const current = pendingRef.current;
		pendingRef.current = null;
		setPending(null);
		current?.resolve(confirmed);
	}

	const options = pending?.options;
	return (
		<ConfirmContext.Provider value={confirm}>
			{children}
			<AlertDialog open={!!pending} onOpenChange={(open) => !open && settle(false)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{options?.title ?? 'Are you sure?'}</AlertDialogTitle>
						<AlertDialogDescription>{options?.message}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{options?.cancelLabel ?? 'Cancel'}</AlertDialogCancel>
						<AlertDialogAction
							variant={options?.destructive ? 'destructive' : 'default'}
							onClick={() => settle(true)}
						>
							{options?.confirmLabel ?? 'Confirm'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</ConfirmContext.Provider>
	);
}
