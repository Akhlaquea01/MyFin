// Turns opened capture messages into entries waiting in Review. Runs after unlock only (it needs
// the data key), over messages the native side queued while the app was closed or locked.
//
// Safety rules this follows, each of which exists because it would otherwise lose or invent money:
//  - NEVER skip a transaction because it looks like another one. Two same-amount payments on the
//    same day are normal. A likely duplicate is created and FLAGGED (`duplicateOfId`), exactly as
//    file and text import do. The one exception is a message that is provably the same message
//    again (same channel, sender, time and text), which the ledger below drops.
//  - Folding an SMS and a payment-app notification into one entry is narrow and one-to-one (see
//    capturePairing.ts), and the folded message stays visible on the entry.
//  - Create the entry, THEN write the ledger row, THEN let the caller acknowledge. A crash in
//    between replays the message and produces a flagged duplicate rather than losing it.
//  - Never write message text to the console.
import { AccountRepository } from '../dexie/accountRepository';
import { MerchantRepository } from '../dexie/merchantRepository';
import { NotifiedItemRepository } from '../dexie/notificationRepository';
import { UnreadableCaptureRepository } from '../dexie/unreadableCaptureRepository';
import { TransactionRepository } from '../dexie/transactionRepository';
import { getBlindIndexSalt } from '../dexie/blindIndexSalt';
import { blindIndex } from '../crypto/cryptoService';
import { createCategorizationResolver } from '../../domain/categorization/resolveCategorization';
import {
	findByReference,
	findDuplicateCandidates
} from '../../domain/transactions/duplicateCandidates';
import {
	TransactionEngine,
	recalculateAccountBalance
} from '../../domain/transactions/transactionEngine';
import { normalizeMerchantText, resolveMerchant } from '../../domain/parser/merchantResolver';
import { todayLocalISO } from '../../domain/shared/dateMath';
import { classifyMessage } from '../../domain/capture/captureFilter';
import { parseCapturedMessage } from '../../domain/capture/captureParser';
import { matchCaptureAccount } from '../../domain/capture/accountMatcher';
import { findPairedCapture, PAIRING_WINDOW_MS } from '../../domain/capture/capturePairing';
import {
	messageText,
	type CapturePayload,
	type IgnoreReason
} from '../../domain/capture/captureTypes';
import type { CaptureInfo, ID, Transaction } from '../../domain/entities';

export interface IngestMessage {
	/** The native queue id, handed back for acknowledgement. */
	id: string;
	payload: CapturePayload;
}

export interface IngestOptions {
	/** Where a message goes when no account digits in it match. */
	defaultAccountId: ID | null;
	/** Messages handled per run; the rest stay queued for the next one. */
	maxPerRun?: number;
	pairWindowMs?: number;
}

export interface IngestReport {
	created: number;
	/** Second sightings folded into an entry that already existed. */
	paired: number;
	/** Entries created but flagged as a likely duplicate. */
	duplicatesFlagged: number;
	/** Exactly this message was filed before. */
	alreadyProcessed: number;
	/** Looked like a transaction but could not be read; kept in the unreadable list. */
	unreadable: number;
	ignored: Partial<Record<IgnoreReason, number>>;
	/** Entries filed on a guessed account (`capture.accountCheck` is set). */
	needsAccountCheck: number;
	/** Left in the queue because there was no account to file them under. */
	noAccount: number;
	/** Left in the queue after an error, to be retried on the next run. */
	failed: number;
	/** Queue ids that are finished with and safe to acknowledge. */
	ackIds: string[];
}

export function emptyIngestReport(): IngestReport {
	return {
		created: 0,
		paired: 0,
		duplicatesFlagged: 0,
		alreadyProcessed: 0,
		unreadable: 0,
		ignored: {},
		needsAccountCheck: 0,
		noAccount: 0,
		failed: 0,
		ackIds: []
	};
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far from the time a message arrived a date written inside it is still believed. */
const DATE_BELIEVED_BEFORE_MS = 7 * DAY_MS;
const DATE_BELIEVED_AFTER_MS = DAY_MS;
const MAX_STORED_TEXT = 1000;

/** The date to file an entry under: the one written in the message if it is plausibly recent,
 *  otherwise the (local) day the message arrived. */
export function resolveCaptureDate(txnDate: string | null, receivedAt: number): string {
	if (txnDate) {
		const written = new Date(`${txnDate}T00:00:00`).getTime();
		if (
			Number.isFinite(written) &&
			written >= receivedAt - DATE_BELIEVED_BEFORE_MS &&
			written <= receivedAt + DATE_BELIEVED_AFTER_MS
		) {
			return txnDate;
		}
	}
	return todayLocalISO(new Date(receivedAt));
}

export async function ingestCapturedMessages(
	key: CryptoKey,
	messages: IngestMessage[],
	options: IngestOptions
): Promise<IngestReport> {
	const report = emptyIngestReport();
	if (messages.length === 0) return report;

	const maxPerRun = options.maxPerRun ?? 200;
	const windowMs = options.pairWindowMs ?? PAIRING_WINDOW_MS;
	const batch = [...messages]
		.sort((a, b) => a.payload.receivedAt - b.payload.receivedAt)
		.slice(0, maxPerRun);

	const [accounts, merchants, salt, categorizer, unreviewed] = await Promise.all([
		AccountRepository.list(key, false),
		MerchantRepository.list(key),
		getBlindIndexSalt(),
		createCategorizationResolver(key),
		TransactionRepository.listUnreviewed(key, { limit: 200 })
	]);
	// Entries a later message of this run may be a second sighting of, kept current as we go.
	const waiting: Transaction[] = unreviewed.filter((tx) => tx.capture);
	const merchantCache = new Map<string, Awaited<ReturnType<typeof resolveMerchant>>>();
	const touchedAccounts = new Set<ID>();

	for (const message of batch) {
		try {
			const outcome = await ingestOne(message, {
				key,
				salt,
				accounts,
				merchants,
				categorizer,
				waiting,
				merchantCache,
				touchedAccounts,
				report,
				options,
				windowMs
			});
			if (outcome === 'done') report.ackIds.push(message.id);
		} catch {
			// Deliberately not logged: the error could carry message text. Left unacknowledged, the
			// message comes back on the next run.
			report.failed += 1;
		}
	}

	for (const accountId of touchedAccounts) await recalculateAccountBalance(key, accountId);
	return report;
}

interface RunContext {
	key: CryptoKey;
	salt: string;
	accounts: Awaited<ReturnType<typeof AccountRepository.list>>;
	merchants: Awaited<ReturnType<typeof MerchantRepository.list>>;
	categorizer: Awaited<ReturnType<typeof createCategorizationResolver>>;
	waiting: Transaction[];
	merchantCache: Map<string, Awaited<ReturnType<typeof resolveMerchant>>>;
	touchedAccounts: Set<ID>;
	report: IngestReport;
	options: IngestOptions;
	windowMs: number;
}

/** `done`: finished with (acknowledge it). `keep`: leave it queued. */
async function ingestOne(message: IngestMessage, ctx: RunContext): Promise<'done' | 'keep'> {
	const { key, report } = ctx;
	const { payload } = message;
	const text = messageText(payload).slice(0, MAX_STORED_TEXT);

	const ledgerKey = `capture:${await blindIndex(
		`${payload.channel}|${payload.sender}|${payload.receivedAt}|${text}`,
		ctx.salt
	)}`;
	if (await NotifiedItemRepository.exists(key, ledgerKey)) {
		report.alreadyProcessed += 1;
		return 'done';
	}

	const verdict = classifyMessage(payload);
	if (!verdict.ok) {
		report.ignored[verdict.reason] = (report.ignored[verdict.reason] ?? 0) + 1;
		return 'done';
	}

	const parsed = parseCapturedMessage(payload);
	if (!parsed) {
		report.unreadable += 1;
		// It passed the "looks like a transaction" filter, so it is probably real money: keep the
		// text (encrypted, like everything else) for the user to add by hand instead of losing it,
		// and note it in the ledger so a replayed message is not listed twice.
		await UnreadableCaptureRepository.add(key, {
			channel: payload.channel,
			sender: payload.sender,
			receivedAt: payload.receivedAt,
			text
		});
		await NotifiedItemRepository.create(key, { key: ledgerKey });
		return 'done';
	}

	const match = matchCaptureAccount(parsed, ctx.accounts, ctx.options.defaultAccountId);
	if (!match) {
		report.noAccount += 1;
		return 'keep';
	}

	const normalized = parsed.merchantText ? normalizeMerchantText(parsed.merchantText) : null;
	let resolved: Awaited<ReturnType<typeof resolveMerchant>> | null = null;
	if (normalized) {
		resolved = ctx.merchantCache.get(normalized) ?? (await resolveMerchant(key, normalized));
		ctx.merchantCache.set(normalized, resolved);
	}

	const signed = parsed.type === 'expense' ? -parsed.amount : parsed.amount;
	const date = resolveCaptureDate(parsed.txnDate, payload.receivedAt);
	const capture: CaptureInfo = {
		channel: payload.channel,
		sender: payload.sender,
		receivedAt: payload.receivedAt,
		text,
		accountCheck: match.accountCheck,
		tailHint: match.tailHint,
		refNo: parsed.refNo
	};

	// Another sighting of a payment already filed: fold it in rather than adding a second entry. The
	// waiting entries cover an SMS and a notification; a reference number also reaches entries the
	// user already confirmed, so a re-posted copy of an old message does not come back as new.
	const sameReference = parsed.refNo ? await findByReference(key, parsed.refNo, signed, date) : [];
	const pool = [
		...ctx.waiting,
		...sameReference.filter((tx) => !ctx.waiting.some((w) => w.id === tx.id))
	];
	const survivor = findPairedCapture(
		{
			channel: payload.channel,
			receivedAt: payload.receivedAt,
			refNo: parsed.refNo,
			exactAccountId: match.accountCheck ? null : match.accountId
		},
		signed,
		pool,
		ctx.windowMs
	);
	if (survivor?.capture) {
		const survivorCapture = survivor.capture;
		const accountWasGuessed =
			survivor.reviewStatus === 'unreviewed' &&
			!!survivorCapture.accountCheck &&
			match.accountCheck === null;
		const sighting = {
			channel: payload.channel,
			sender: payload.sender,
			receivedAt: payload.receivedAt
		};
		// A replay of a message already on the entry adds nothing to show.
		const alreadyRecorded = [survivorCapture, ...(survivorCapture.alsoSeenAs ?? [])].some(
			(seen) =>
				seen.channel === sighting.channel &&
				seen.sender === sighting.sender &&
				seen.receivedAt === sighting.receivedAt
		);
		const merged: CaptureInfo = {
			...survivorCapture,
			alsoSeenAs: alreadyRecorded
				? survivorCapture.alsoSeenAs
				: [...(survivorCapture.alsoSeenAs ?? []), sighting],
			// A later sighting may carry the reference the first one lacked (a notification has none).
			refNo: survivorCapture.refNo ?? parsed.refNo,
			// The newcomer named the account precisely where the first sighting had to guess.
			...(accountWasGuessed ? { accountCheck: null, tailHint: null } : {})
		};
		const updated = await TransactionEngine.editTransaction(key, survivor.id, {
			capture: merged,
			...(accountWasGuessed ? { accountId: match.accountId } : {}),
			...(!survivor.merchantId && resolved ? { merchantId: resolved.merchantId } : {})
		});
		if (accountWasGuessed) ctx.touchedAccounts.add(survivor.accountId);
		ctx.touchedAccounts.add(updated.accountId);
		const waitingAt = ctx.waiting.findIndex((tx) => tx.id === survivor.id);
		if (waitingAt >= 0) ctx.waiting.splice(waitingAt, 1, updated);
		report.paired += 1;
		await NotifiedItemRepository.create(key, { key: ledgerKey });
		return 'done';
	}

	// A guessed account may be wrong, so a twin filed under another account must still be seen.
	const duplicates = await findDuplicateCandidates(
		key,
		{ accountId: match.accountCheck ? null : match.accountId, amount: signed, date },
		{
			merchantName: normalized ?? undefined,
			merchantId: resolved?.merchantId,
			merchants: ctx.merchants,
			refNo: parsed.refNo
		}
	);
	const duplicateOfId = duplicates[0]?.id ?? null;

	const created = await TransactionEngine.recordTransaction(
		key,
		{
			accountId: match.accountId,
			date,
			amount: signed,
			type: parsed.type,
			merchantId: resolved?.merchantId ?? null,
			merchantAliasId: resolved?.aliasId ?? null,
			// Not the message: `notes` is the row title (see CaptureInfo).
			notes: null,
			source: payload.channel === 'sms' ? 'sms_capture' : 'notification_capture',
			reviewStatus: 'unreviewed',
			duplicateOfId,
			capture
		},
		[],
		{ deferBalance: true, categorizer: ctx.categorizer }
	);
	ctx.touchedAccounts.add(match.accountId);
	ctx.waiting.push(created);
	report.created += 1;
	if (duplicateOfId) report.duplicatesFlagged += 1;
	if (match.accountCheck) report.needsAccountCheck += 1;

	await NotifiedItemRepository.create(key, { key: ledgerKey });
	return 'done';
}
