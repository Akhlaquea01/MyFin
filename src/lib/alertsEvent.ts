// Fired on `window` when the Alerts list changed behind a screen's back (the unlock-time check
// added entries; a page marked some read), so the unread badge can recount.
export const ALERTS_CHANGED_EVENT = 'myfin:alerts-changed';

export function announceAlertsChanged(): void {
	if (typeof window !== 'undefined') window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT));
}
