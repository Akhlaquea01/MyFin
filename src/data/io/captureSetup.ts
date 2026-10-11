// Switching automatic capture on and off. Enabling proves, before anything is captured, that the
// Android side and the app agree on the sealed-message format — a mismatch would otherwise show
// up as every captured message being silently unreadable.
import { TransactionCapture, SELF_TEST_TEXT } from '../../lib/native/transactionCapture';
import { UserProfileRepository } from '../dexie/userProfileRepository';
import { createSealingKey, loadSealingPrivateKey, openSealedItem } from '../crypto/sealedBox';
import type { CaptureSettings, ID } from '../../domain/entities';

export class CaptureSetupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CaptureSetupError';
	}
}

export interface CaptureChoices {
	sms: boolean;
	notifications: boolean;
	defaultAccountId: ID;
}

/**
 * Creates the sealing key if there is none, checks it end to end with the native side, switches
 * the chosen sources on there, and saves the choices. Safe to call again to change the choices.
 */
export async function enableCapture(
	key: CryptoKey,
	choices: CaptureChoices
): Promise<CaptureSettings> {
	if (!choices.sms && !choices.notifications) {
		throw new CaptureSetupError('Choose at least one source: SMS or notifications.');
	}
	const profile = await UserProfileRepository.get();
	if (!profile) throw new CaptureSetupError('No profile found.');

	const sealing = profile.capture?.sealing ?? (await createSealingKey(key));
	await TransactionCapture.setSealingKey(sealing.publicKey, sealing.keyId);

	try {
		const { item } = await TransactionCapture.selfTest();
		const privateKey = await loadSealingPrivateKey(key, sealing.wrappedPrivateKey);
		const opened = (await openSealedItem(privateKey, item)) as { selfTest?: unknown } | null;
		if (opened?.selfTest !== SELF_TEST_TEXT) throw new Error('mismatch');
	} catch {
		throw new CaptureSetupError(
			'The secure storage check failed, so capture was not turned on. The phone and the app could not agree on how to lock messages away. Nothing was captured.'
		);
	}

	await TransactionCapture.setEnabled({ sms: choices.sms, notifications: choices.notifications });
	const saved: CaptureSettings = {
		...profile.capture,
		enabled: true,
		sms: choices.sms,
		notifications: choices.notifications,
		defaultAccountId: choices.defaultAccountId,
		sealing
	};
	await UserProfileRepository.update({ capture: saved });
	return saved;
}

/** Stops capturing. Anything already queued stays sealed until capture is switched on again. */
export async function disableCapture(): Promise<void> {
	await TransactionCapture.setEnabled({ sms: false, notifications: false });
	const profile = await UserProfileRepository.get();
	if (profile?.capture) {
		await UserProfileRepository.update({ capture: { ...profile.capture, enabled: false } });
	}
}
