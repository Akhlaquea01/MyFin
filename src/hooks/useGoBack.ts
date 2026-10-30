import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/** React Router numbers its history entries from 0, so above 0 there is an earlier screen of ours. */
export function hasPreviousEntry(): boolean {
	const idx = (window.history.state as { idx?: unknown } | null)?.idx;
	return typeof idx === 'number' && idx > 0;
}

/**
 * Returns the user to the screen they came from, or to `fallback` when this one was opened
 * directly (a shared file, a notification, a bookmark) and there is nowhere of ours to go back to.
 */
export function useGoBack(fallback: string): () => void {
	const navigate = useNavigate();
	return useCallback(() => {
		if (hasPreviousEntry()) navigate(-1);
		else navigate(fallback, { replace: true });
	}, [navigate, fallback]);
}
