// "Enable biometric unlock?" is offered after a PIN unlock. Declining it used to be forgotten the
// moment the session ended, so with a 5-minute auto-lock it came back many times a day. Declining
// now snoozes the offer; the Security page's toggle is always there for anyone who changes their
// mind.
import { safeGetItem, safeSetItem } from './safeStorage';

const KEY = 'myfin.biometricPromptSnoozedUntil';
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export function isBiometricPromptSnoozed(now: number = Date.now()): boolean {
	const until = Number(safeGetItem(KEY));
	return Number.isFinite(until) && until > now;
}

export function snoozeBiometricPrompt(now: number = Date.now()): void {
	safeSetItem(KEY, String(now + SNOOZE_MS));
}
