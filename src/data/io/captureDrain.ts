// Moves captured messages from the Android app's sealed queue into Review. Called after unlock
// (the data key is needed both to open the messages and to write the entries), when the app
// returns to the foreground, and when native says something new arrived.
import {
	TransactionCapture,
	isTransactionCaptureAvailable
} from '../../lib/native/transactionCapture';
import { UserProfileRepository } from '../dexie/userProfileRepository';
import { loadSealingPrivateKey, openSealedItem } from '../crypto/sealedBox';
import {
	emptyIngestReport,
	ingestCapturedMessages,
	type IngestMessage,
	type IngestReport
} from './captureIngestService';
import type { CapturePayload } from '../../domain/capture/captureTypes';
import type { CaptureSettings } from '../../domain/entities';

/** Fired on `window` when entries were added to Review behind the page's back. */
export const REVIEW_CHANGED_EVENT = 'myfin:review-changed';

const BATCH_SIZE = 200;
/** A bound on one run; whatever is left stays queued for the next. */
const MAX_ROUNDS = 10;

export interface DrainResult {
	report: IngestReport;
	/** Items that could not be opened (sealed to an old key, or damaged) and were discarded. */
	undecryptable: number;
	/** Messages still queued when the run stopped. */
	remaining: number;
}

function isCapturePayload(value: unknown): value is CapturePayload {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		(v.channel === 'sms' || v.channel === 'notification') &&
		typeof v.sender === 'string' &&
		typeof v.body === 'string' &&
		typeof v.receivedAt === 'number' &&
		(v.title === undefined || v.title === null || typeof v.title === 'string')
	);
}

/** Makes native match the profile — the profile is the source of truth, and a restored backup or
 *  a reinstall can leave native with a different key or switches. */
export async function syncCaptureToNative(settings: CaptureSettings): Promise<void> {
	if (!settings.sealing) return;
	await TransactionCapture.setSealingKey(settings.sealing.publicKey, settings.sealing.keyId);
	await TransactionCapture.setEnabled({
		sms: settings.enabled && settings.sms,
		notifications: settings.enabled && settings.notifications
	});
}

let inFlight: Promise<DrainResult | null> | null = null;

/**
 * One drain at a time: the three triggers (unlock, return to foreground, native event) can fire
 * together, and two concurrent drains would hand the same queue items to two ingests.
 * Resolves `null` when capture is not available or not switched on.
 */
export function drainCapturedTransactions(key: CryptoKey): Promise<DrainResult | null> {
	if (!inFlight) {
		inFlight = run(key).finally(() => {
			inFlight = null;
		});
	}
	return inFlight;
}

async function run(key: CryptoKey): Promise<DrainResult | null> {
	if (!isTransactionCaptureAvailable()) return null;
	const profile = await UserProfileRepository.get();
	const settings = profile?.capture;
	if (!settings?.enabled || !settings.sealing) return null;

	await syncCaptureToNative(settings);
	const privateKey = await loadSealingPrivateKey(key, settings.sealing.wrappedPrivateKey);

	const total = emptyIngestReport();
	let undecryptable = 0;
	let remaining = 0;
	let dropped = 0;

	for (let round = 0; round < MAX_ROUNDS; round++) {
		const drained = await TransactionCapture.drainQueue(BATCH_SIZE);
		remaining = drained.remaining;
		dropped += drained.dropped;
		if (drained.items.length === 0) break;

		const opened: IngestMessage[] = [];
		const finished: string[] = [];
		for (const item of drained.items) {
			try {
				if (item.kid !== settings.sealing.keyId) throw new Error('sealed to another key');
				const payload = await openSealedItem(privateKey, item);
				if (!isCapturePayload(payload)) throw new Error('unexpected shape');
				opened.push({ id: item.id, payload });
			} catch {
				// Nothing can ever open it, so keeping it only blocks the queue.
				undecryptable += 1;
				finished.push(item.id);
			}
		}

		const report = await ingestCapturedMessages(key, opened, {
			defaultAccountId: settings.defaultAccountId
		});
		merge(total, report);
		finished.push(...report.ackIds);

		if (finished.length === 0) {
			// Nothing moved: do not spin on the same items. None of this batch was acknowledged, so
			// they are all still queued, on top of whatever lay beyond the batch.
			remaining = drained.items.length + drained.remaining;
			break;
		}
		const acked = await TransactionCapture.ack(finished);
		remaining = acked.remaining;
		if (remaining === 0) break;
	}

	if (remaining === 0) await TransactionCapture.cancelAlert().catch(() => {});

	// Re-read: the settings page may have saved something while this was running.
	const latest = (await UserProfileRepository.get())?.capture;
	if (latest) {
		await UserProfileRepository.update({
			capture: {
				...latest,
				unreadableCount: (latest.unreadableCount ?? 0) + total.unreadable + undecryptable,
				droppedCount: (latest.droppedCount ?? 0) + dropped,
				lastDrainAt: Date.now()
			}
		});
	}
	return { report: total, undecryptable, remaining };
}

function merge(into: IngestReport, from: IngestReport): void {
	into.created += from.created;
	into.paired += from.paired;
	into.duplicatesFlagged += from.duplicatesFlagged;
	into.alreadyProcessed += from.alreadyProcessed;
	into.unreadable += from.unreadable;
	into.needsAccountCheck += from.needsAccountCheck;
	into.noAccount += from.noAccount;
	into.failed += from.failed;
	into.ackIds.push(...from.ackIds);
	for (const [reason, count] of Object.entries(from.ignored)) {
		const r = reason as keyof IngestReport['ignored'];
		into.ignored[r] = (into.ignored[r] ?? 0) + (count ?? 0);
	}
}
