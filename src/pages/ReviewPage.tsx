import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	ArrowRightLeft,
	CheckCheck,
	CheckCircle2,
	Inbox,
	Pencil,
	Repeat,
	Sparkles,
	Trash2,
	Upload
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '../components/ui/dialog';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import { MerchantRepository } from '../data/dexie/merchantRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { TagRepository, TransactionTagRepository } from '../data/dexie/tagRepository';
import {
	CategorizationRuleRepository,
	type CategorizationRuleWithStatus
} from '../data/dexie/categorizationRuleRepository';
import { ConvertToTransferDialog } from '../components/ConvertToTransferDialog';
import { EditTransactionDialog } from '../components/EditTransactionDialog';
import {
	applyAutoCategorization,
	setMerchantRule
} from '../domain/categorization/resolveCategorization';
import { detectCardPayment } from '../domain/parser/cardPaymentDetector';
import { findCardMatches } from '../domain/parser/cardIdentifierMatcher';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID,
	type SplitInput
} from '../data/dexie/transactionRepository';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import { formatTransactionLabel } from '../domain/transactions/transactionLabel';
import { createRuleFromTransaction } from '../domain/recurring/recurringEngine';
import { DAY_RANGE, clampDay, defaultDayFor } from '../domain/recurring/recurringDay';
import { isNativeApp } from '../lib/native/platform';
import { originalMessageOf } from '../domain/capture/originalMessage';
import { REVIEW_CHANGED_EVENT } from '../data/io/captureDrain';
import type {
	Account,
	CaptureInfo,
	Category,
	Merchant,
	RecurringFrequency,
	Tag,
	Transaction,
	TransactionSplit
} from '../domain/entities';
import { categoryOptions } from '../domain/categories/categoryHierarchy';
import { useConfirm } from '../lib/confirm';
import { formatMoney } from '../domain/shared/money';

/** How many waiting entries are loaded, decrypted and drawn at a time. */
const PAGE_SIZE = 50;

/** Where a captured entry came from, in one line: the sender, when it arrived, and anything the
 *  user should know about how it was filed. */
function describeCaptureSource(capture: CaptureInfo): string {
	const when = new Date(capture.receivedAt).toLocaleString(undefined, {
		day: 'numeric',
		month: 'short',
		hour: 'numeric',
		minute: '2-digit'
	});
	const parts = [`${capture.sender} · ${when}`];
	if (capture.accountCheck === 'unmatched-tail' && capture.tailHint) {
		parts.push(`message mentions account ending ${capture.tailHint}`);
	}
	if (capture.alsoSeenAs && capture.alsoSeenAs.length > 0) {
		parts.push(
			'also seen as ' +
				capture.alsoSeenAs
					.map((s) =>
						s.channel === 'sms' ? `SMS from ${s.sender}` : `notification from ${s.sender}`
					)
					.join(', ')
		);
	}
	return parts.join(' · ');
}

// User Story 4 (P4): review queue for unreviewed/unconfirmed transactions from Quick Add
// and bulk import (FR-022). Entries here already count in balances and reports; confirming one
// marks it as checked. Every field can be corrected first with the pencil (Edit).
// Spec 006 extends this with an editable category/tag pre-fill (rule- or suggestion-based)
// that the user can accept as-is or override before confirming.
export function ReviewPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const confirm = useConfirm();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [merchants, setMerchants] = useState<Merchant[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [tags, setTags] = useState<Tag[]>([]);
	const [items, setItems] = useState<Transaction[]>([]);
	// Waiting entries NOT on the page — they load on "Show more". Kept as the count behind the page
	// rather than a grand total, so taking an entry off the page cannot leave the two disagreeing.
	const [hidden, setHidden] = useState(0);
	const [pageLimit, setPageLimit] = useState(PAGE_SIZE);
	const [loadingMore, setLoadingMore] = useState(false);
	const total = items.length + hidden;
	const [firstSplit, setFirstSplit] = useState<Record<string, TransactionSplit | undefined>>({});
	const [categoryChoice, setCategoryChoice] = useState<Record<string, string>>({});
	const [tagsInput, setTagsInput] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [recurringTarget, setRecurringTarget] = useState<Transaction | null>(null);
	const [recurringFrequency, setRecurringFrequency] = useState<RecurringFrequency>('monthly');
	const [recurringDay, setRecurringDay] = useState('1');
	const [rules, setRules] = useState<CategorizationRuleWithStatus[]>([]);
	// Per-row "always file this merchant under the chosen category" opt-in.
	const [rememberRule, setRememberRule] = useState<Record<string, boolean>>({});
	const [convertTarget, setConvertTarget] = useState<Transaction | null>(null);
	const [editTarget, setEditTarget] = useState<Transaction | null>(null);
	const [working, setWorking] = useState(false);
	// Entries with a Confirm/Discard already in flight. A ref guards against a second tap landing
	// before React has re-rendered the button disabled; the state is what the buttons read.
	const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
	const busyRef = useRef<Set<string>>(new Set());
	// The category/tags each row was last LOADED with, so a reload can tell a row the user has
	// edited (keep their choice) from one they have not (take what was just filed — a new rule may
	// have categorized it).
	const loadedCategoryRef = useRef<Record<string, string>>({});
	const loadedTagsRef = useRef<Record<string, string>>({});
	// "Account not matched" is only a useful hint when there is more than one account to choose from.
	const hasAccountChoice =
		accounts.filter((a) => !a.isArchived && a.type !== 'credit_card').length >= 2;

	/**
	 * Loads the newest `limit` waiting entries with their splits and tags — one query each for ALL
	 * of them, not one per row. `keepEdits` leaves the category/tags already chosen on rows that were
	 * on screen alone, so "Show more" does not throw away what the user has typed so far.
	 */
	async function loadQueue(limit: number, allTags: Tag[], keepEdits: boolean) {
		const [unreviewed, waiting] = await Promise.all([
			TransactionRepository.listUnreviewed(key, { limit }),
			TransactionRepository.countUnreviewed()
		]);
		const ids = unreviewed.map((tx) => tx.id);
		const [splitsByTx, tagIdsByTx] = await Promise.all([
			TransactionRepository.splitsByTransaction(key, ids),
			TransactionTagRepository.getTagIdsByTransaction(ids)
		]);

		const tagNames = new Map(allTags.map((t) => [t.id, t.name]));
		const nextFirstSplit: Record<string, TransactionSplit | undefined> = {};
		const nextCategoryChoice: Record<string, string> = {};
		const nextTagsInput: Record<string, string> = {};
		for (const tx of unreviewed) {
			const first = splitsByTx.get(tx.id)?.[0];
			nextFirstSplit[tx.id] = first;
			nextCategoryChoice[tx.id] = first?.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
			nextTagsInput[tx.id] = (tagIdsByTx.get(tx.id) ?? [])
				.map((id) => tagNames.get(id))
				.filter((name): name is string => Boolean(name))
				.join(', ');
		}
		const keepOnScreen = (
			next: Record<string, string>,
			prev: Record<string, string>,
			loaded: Record<string, string>
		): Record<string, string> =>
			keepEdits
				? Object.fromEntries(
						Object.entries(next).map(([id, value]) => [
							id,
							id in prev && prev[id] !== loaded[id] ? prev[id] : value
						])
					)
				: next;
		const previouslyLoadedCategory = loadedCategoryRef.current;
		const previouslyLoadedTags = loadedTagsRef.current;
		loadedCategoryRef.current = nextCategoryChoice;
		loadedTagsRef.current = nextTagsInput;

		setItems(unreviewed);
		setHidden(Math.max(0, waiting - unreviewed.length));
		setPageLimit(limit);
		setFirstSplit(nextFirstSplit);
		setCategoryChoice((prev) => keepOnScreen(nextCategoryChoice, prev, previouslyLoadedCategory));
		setTagsInput((prev) => keepOnScreen(nextTagsInput, prev, previouslyLoadedTags));
	}

	async function refresh() {
		setLoading(true);
		try {
			const [accts, allMerchants, allCategories, allTags, allRules] = await Promise.all([
				AccountRepository.list(key),
				MerchantRepository.list(key),
				CategoryRepository.list(key),
				TagRepository.list(key),
				CategorizationRuleRepository.list(key)
			]);
			setAccounts(accts);
			setRules(allRules);
			setMerchants(allMerchants);
			setCategories(allCategories);
			setTags(allTags);
			await loadQueue(pageLimit, allTags, false);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load this page.');
		} finally {
			setLoading(false);
		}
	}

	async function showMore() {
		setLoadingMore(true);
		try {
			// Counted from what is on screen, not from `pageLimit`: confirming and discarding shrink
			// the list without shrinking the limit.
			await loadQueue(items.length + PAGE_SIZE, tags, true);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load more entries.');
		} finally {
			setLoadingMore(false);
		}
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/** Pulls in entries that arrived behind the page's back (captured bank messages) without
	 *  discarding the categories and tags already chosen on the cards on screen. */
	async function refreshQuietly() {
		try {
			const [accts, allMerchants, allTags, allRules] = await Promise.all([
				AccountRepository.list(key),
				MerchantRepository.list(key),
				TagRepository.list(key),
				CategorizationRuleRepository.list(key)
			]);
			setAccounts(accts);
			setMerchants(allMerchants);
			setTags(allTags);
			setRules(allRules);
			await loadQueue(Math.max(pageLimit, items.length), allTags, true);
		} catch {
			// The next visit loads the queue afresh.
		}
	}
	const refreshQuietlyRef = useRef(refreshQuietly);
	useEffect(() => {
		refreshQuietlyRef.current = refreshQuietly;
	});
	useEffect(() => {
		const onChanged = () => void refreshQuietlyRef.current();
		window.addEventListener(REVIEW_CHANGED_EVENT, onChanged);
		return () => window.removeEventListener(REVIEW_CHANGED_EVENT, onChanged);
	}, []);

	// Triage can empty the page while more entries are still waiting behind it: bring the next ones
	// in rather than announcing "Nothing to review" over a queue that is not empty.
	useEffect(() => {
		if (!loading && !loadingMore && items.length === 0 && hidden > 0) void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loading, loadingMore, items.length, hidden]);

	/**
	 * Re-reads one entry after it was edited and patches only its card. A full `refresh()` would also
	 * rebuild every other card's pending category/tags and throw away what was typed there. Merchants
	 * and tags are re-listed too, because the edit may have created new ones.
	 */
	async function reloadRow(id: string) {
		try {
			const [tx, allMerchants, allTags, splitsByTx, tagIdsByTx] = await Promise.all([
				TransactionRepository.getById(key, id),
				MerchantRepository.list(key),
				TagRepository.list(key),
				TransactionRepository.splitsByTransaction(key, [id]),
				TransactionTagRepository.getTagIdsByTransaction([id])
			]);
			setMerchants(allMerchants);
			setTags(allTags);
			if (!tx || tx.deletedAt !== null || tx.reviewStatus !== 'unreviewed') {
				removeFromPage(id);
				return;
			}
			const first = splitsByTx.get(id)?.[0];
			const tagNames = new Map(allTags.map((t) => [t.id, t.name]));
			setItems((prev) => prev.map((t) => (t.id === id ? tx : t)));
			const loadedCategory = first?.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
			const loadedTags = (tagIdsByTx.get(id) ?? [])
				.map((tagId) => tagNames.get(tagId))
				.filter((name): name is string => Boolean(name))
				.join(', ');
			loadedCategoryRef.current = { ...loadedCategoryRef.current, [id]: loadedCategory };
			loadedTagsRef.current = { ...loadedTagsRef.current, [id]: loadedTags };
			setFirstSplit((prev) => ({ ...prev, [id]: first }));
			setCategoryChoice((prev) => ({ ...prev, [id]: loadedCategory }));
			setTagsInput((prev) => ({ ...prev, [id]: loadedTags }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not reload the edited entry.');
		}
	}

	/** Takes an entry off the page after it was confirmed or discarded. */
	function removeFromPage(id: string) {
		setItems((prev) => prev.filter((t) => t.id !== id));
	}

	function accountName(id: string): string {
		return accounts.find((a) => a.id === id)?.name ?? id;
	}

	function merchantName(id: string | null): string | null {
		return id ? (merchants.find((m) => m.id === id)?.name ?? null) : null;
	}

	/** The live merchant-wide rule for a merchant, if any. */
	function ruleFor(merchantId: string | null): CategorizationRuleWithStatus | undefined {
		if (!merchantId) return undefined;
		return rules.find(
			(r) => r.merchantId === merchantId && r.merchantAliasId === null && !r.isInvalid
		);
	}

	/** A card whose number appears in the message — offered as the likely other side of a payment. */
	function suggestedCardFor(tx: Transaction): string | null {
		const matches = findCardMatches(
			originalMessageOf(tx),
			accounts.filter((a) => !a.isArchived)
		);
		const ids = [...new Set(matches.map((m) => m.accountId))];
		return ids.length === 1 ? ids[0] : null;
	}

	function parseTagIds(tx: Transaction): Promise<string[]> {
		const tagNames = (tagsInput[tx.id] ?? '')
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		return Promise.all(tagNames.map((name) => TagRepository.getOrCreate(key, name))).then((tags) =>
			tags.map((t) => t.id)
		);
	}

	/** Confirms one entry using the category/tags currently chosen on its row. */
	async function confirmOne(tx: Transaction): Promise<void> {
		const categoryId = categoryChoice[tx.id] ?? UNCATEGORIZED_CATEGORY_ID;
		const splits: SplitInput[] = [{ categoryId, amount: tx.amount }];
		const tagIds = await parseTagIds(tx);
		await TransactionEngine.confirmTransaction(key, tx.id, splits, tagIds);
	}

	/**
	 * Runs one Confirm/Discard for an entry at most once at a time and reports a failure instead of
	 * letting it vanish as an unhandled rejection. A double-tap used to confirm twice (counting the
	 * merchant-learning streak twice) or fail silently.
	 */
	async function runForRow(id: string, failureMessage: string, action: () => Promise<void>) {
		if (busyRef.current.has(id)) return;
		busyRef.current.add(id);
		setBusyIds(new Set(busyRef.current));
		try {
			await action();
		} catch (err) {
			toast.error(`${failureMessage}: ${err instanceof Error ? err.message : 'unknown error'}`);
		} finally {
			busyRef.current.delete(id);
			setBusyIds(new Set(busyRef.current));
		}
	}

	function accept(tx: Transaction): Promise<void> {
		return runForRow(tx.id, 'Could not confirm this entry', () => acceptOne(tx));
	}

	async function acceptOne(tx: Transaction) {
		const categoryId = categoryChoice[tx.id] ?? UNCATEGORIZED_CATEGORY_ID;
		await confirmOne(tx);

		// "Always file this merchant here": turns the choice just made into a rule, and applies it
		// to everything else still waiting, so the user is not asked the same question again for
		// every remaining row from the same merchant.
		if (rememberRule[tx.id] && tx.merchantId && categoryId !== UNCATEGORIZED_CATEGORY_ID) {
			try {
				await setMerchantRule(key, tx.merchantId, categoryId, await parseTagIds(tx));
				const { updated } = await applyAutoCategorization(key, {
					merchantId: tx.merchantId,
					unreviewedOnly: true
				});
				toast.success(
					updated > 0
						? `Confirmed. Rule saved — ${updated} more waiting ${updated === 1 ? 'entry was' : 'entries were'} categorized.`
						: 'Confirmed. Rule saved for next time.'
				);
				removeFromPage(tx.id);
				// Quietly: a full refresh would throw away the categories and tags typed on every
				// other card. Rows nobody has touched pick up what the new rule just filed.
				await refreshQuietly();
				return;
			} catch (err) {
				toast.error(
					`Confirmed, but the rule wasn't saved: ${err instanceof Error ? err.message : 'unknown error'}`
				);
			}
		} else {
			toast.success('Confirmed');
		}
		// Local patch: remove the now-confirmed transaction from the queue
		removeFromPage(tx.id);
	}

	/** Re-runs rules and learned suggestions over entries that are still uncategorized — a rule
	 *  made after an entry arrived used to leave that entry untouched. */
	async function categorizeQueue() {
		setWorking(true);
		try {
			const { updated } = await applyAutoCategorization(key, { unreviewedOnly: true });
			toast.success(
				updated > 0
					? `Categorized ${updated} ${updated === 1 ? 'entry' : 'entries'} using your rules and suggestions.`
					: 'Nothing to categorize — no rule or suggestion applies to the uncategorized entries.'
			);
			await refreshQuietly();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not categorize the queue.');
		} finally {
			setWorking(false);
		}
	}

	/**
	 * Confirms every entry in the queue that already has a category, leaving the uncategorized ones
	 * to review. It reaches past the page on screen: entries on it are confirmed as currently chosen
	 * on their rows; the ones not shown are confirmed exactly as they are filed, which is why the
	 * prompt says how many of those there are.
	 */
	async function confirmAllCategorized() {
		const isFlagged = (tx: Transaction) => !!tx.duplicateOfId || !!tx.capture?.accountCheck;
		const shownCategorized = items.filter(
			(tx) => (categoryChoice[tx.id] ?? UNCATEGORIZED_CATEGORY_ID) !== UNCATEGORIZED_CATEGORY_ID
		);
		// Entries flagged as a possible duplicate, or filed on a guessed account, are exactly the
		// ones that need a human look — bulk-confirming them would defeat the flag.
		const shownReady = shownCategorized.filter((tx) => !isFlagged(tx));
		const shownIds = new Set(items.map((tx) => tx.id));
		const unseenCategorized = (await TransactionRepository.categorizedUnreviewedIds()).filter(
			(id) => !shownIds.has(id)
		);
		const flaggedUnseen = await TransactionRepository.flaggedAmong(key, unseenCategorized);
		const unseenReady = unseenCategorized.filter((id) => !flaggedUnseen.has(id));
		const skippedFlagged = shownCategorized.length - shownReady.length + flaggedUnseen.size;
		const count = shownReady.length + unseenReady.length;
		if (count === 0) {
			toast.info(
				skippedFlagged > 0
					? `Nothing to confirm in bulk — the ${skippedFlagged} categorized ${skippedFlagged === 1 ? 'entry is' : 'entries are'} flagged (possible duplicate or account not matched) and need a look.`
					: 'Nothing to confirm yet — no waiting entry has a category.'
			);
			return;
		}
		const noun = count === 1 ? 'entry' : 'entries';
		const scope =
			unseenReady.length > 0
				? `, including ${unseenReady.length} not shown on this page, exactly as filed`
				: ' as shown';
		const flaggedNote =
			skippedFlagged > 0
				? ` ${skippedFlagged} flagged ${skippedFlagged === 1 ? 'entry' : 'entries'} (possible duplicate or account not matched) will stay for you to check.`
				: '';
		if (
			!(await confirm({ message: `Confirm ${count} categorized ${noun}${scope}? Anything still "Uncategorized" stays in the queue.${flaggedNote}`, confirmLabel: 'Confirm entries', destructive: false }))
		) {
			return;
		}
		setWorking(true);
		try {
			for (const tx of shownReady) await confirmOne(tx);
			// No splits or tags passed: the entry keeps whatever category and tags it already has.
			for (const id of unseenReady) await TransactionEngine.confirmTransaction(key, id);
			toast.success(`Confirmed ${count} ${noun}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not confirm every entry.');
		} finally {
			setWorking(false);
			await refreshQuietly();
		}
	}

	function openRecurringDialog(tx: Transaction) {
		// tx.date is a plain "YYYY-MM-DD" string; parsing it with `new Date(...)` reads it as
		// UTC midnight and `.getDate()` then returns the *local* day, which can be off by one
		// depending on the viewer's timezone. Read the day-of-month directly from the string.
		setRecurringDay(String(defaultDayFor('monthly', tx.date)));
		setRecurringFrequency('monthly');
		setRecurringTarget(tx);
	}

	/** Switching frequency changes what the day number means, so it is re-derived from the
	 *  transaction's own date rather than carried over. */
	function changeRecurringFrequency(frequency: RecurringFrequency) {
		setRecurringFrequency(frequency);
		if (recurringTarget) setRecurringDay(String(defaultDayFor(frequency, recurringTarget.date)));
	}

	async function confirmRecurring() {
		if (!recurringTarget) return;
		try {
			const day = clampDay(recurringFrequency, recurringDay);
			const rule = await createRuleFromTransaction(key, recurringTarget, {
				frequency: recurringFrequency,
				dayOfPeriod: day,
				categoryId: categoryChoice[recurringTarget.id]
			});
			// Update the local transaction to reflect the new link
			setItems((prev) =>
				prev.map((t) => (t.id === recurringTarget.id ? { ...t, recurringRuleId: rule.id } : t))
			);
			setRecurringTarget(null);
			toast.success('Recurring rule created');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not create recurring rule.');
		}
	}

	function reject(tx: Transaction): Promise<void> {
		return runForRow(tx.id, 'Could not discard this entry', () => rejectOne(tx));
	}

	async function rejectOne(tx: Transaction) {
		await TransactionEngine.deleteTransaction(key, tx.id);
		// This page exists for fast triage of many transactions, with Confirm/Discard sitting
		// right next to each other — an undo path matters more here than on a page where
		// deletion is a slower, more deliberate action.
		toast.success('Discarded', {
			duration: 10_000,
			action: {
				label: 'Undo',
				onClick: () => {
					// Quietly, so bringing the entry back does not wipe edits typed on other cards.
					void TransactionEngine.restoreTransaction(key, tx.id).then(() =>
						refreshQuietlyRef.current()
					);
				}
			}
		});
		// Local patch: remove the discarded transaction from the queue
		removeFromPage(tx.id);
	}

	return (
		<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Review Queue</h1>
				<Button variant="outline" asChild>
					<Link to="/import/bulk-text">
						<Upload /> Bulk import
					</Link>
				</Button>
			</div>

			{!loading && items.length > 0 && (
				<div className="mb-4 flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={working}
						onClick={() => void categorizeQueue()}
					>
						<Sparkles /> Apply rules to queue
					</Button>
					<Button
						variant="outline"
						size="sm"
						// Entries behind "Show more" may be categorized too, so only a fully loaded queue
						// can be ruled out from here.
						disabled={
							working ||
							(hidden === 0 &&
								!items.some(
									(tx) =>
										(categoryChoice[tx.id] ?? UNCATEGORIZED_CATEGORY_ID) !==
										UNCATEGORIZED_CATEGORY_ID
								))
						}
						onClick={() => void confirmAllCategorized()}
					>
						<CheckCheck /> Confirm all categorized
					</Button>
					<span className="text-xs text-muted-foreground">
						{total} waiting
						{hidden > 0 ? ` (showing the newest ${items.length})` : ''} · already counted in your
						balances and reports; confirming marks an entry as checked
					</span>
				</div>
			)}

			{loading || (items.length === 0 && hidden > 0) ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : items.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<Inbox className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">Nothing to review.</p>
						<p className="max-w-sm text-xs text-muted-foreground">
							New entries land here when you use Quick Add, import a statement
							{isNativeApp() ? ' or let Auto-capture read your bank messages' : ''}.
						</p>
						<div className="mt-1 flex flex-wrap justify-center gap-2">
							<Button size="sm" variant="outline" asChild>
								<Link to="/quick-add">Paste a bank message</Link>
							</Button>
							<Button size="sm" variant="outline" asChild>
								<Link to="/import">Upload a statement file</Link>
							</Button>
							{isNativeApp() && (
								<Button size="sm" variant="outline" asChild>
									<Link to="/auto-capture">Read bank messages automatically</Link>
								</Button>
							)}
						</div>
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-3">
					{items.map((tx) => (
						<Card key={tx.id}>
							<CardContent className="flex flex-col gap-3 pt-6">
								<div className="flex items-center justify-between">
									<div>
										<p className="text-sm font-medium">
											{formatTransactionLabel(tx, merchants)}
											{tx.duplicateOfId && (
												<Badge variant="outline" className="ml-2">
													Possible duplicate
												</Badge>
											)}
											{firstSplit[tx.id]?.categorizationSource === 'suggestion' && (
												<Badge variant="secondary" className="ml-2">
													Suggested
												</Badge>
											)}
											{firstSplit[tx.id]?.categorizationSource === 'rule' && (
												<Badge variant="outline" className="ml-2">
													Auto: rule
												</Badge>
											)}
											{tx.capture && (
												<Badge variant="secondary" className="ml-2">
													{tx.capture.channel === 'sms' ? 'SMS' : 'Notification'}
												</Badge>
											)}
											{tx.capture?.accountCheck && hasAccountChoice && (
												<Badge
													variant="outline"
													className="ml-2 border-amber-500/60 text-amber-700 dark:text-amber-400"
												>
													Account not matched — check
												</Badge>
											)}
										</p>
										<p className="text-xs text-muted-foreground">
											{tx.date} · {accountName(tx.accountId)}
										</p>
										{tx.capture && (
											<p className="text-xs text-muted-foreground">
												{describeCaptureSource(tx.capture)}
											</p>
										)}
									</div>
									<div className="flex items-center gap-1">
										<span
											className={`font-mono text-sm ${tx.amount < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}
										>
											{formatMoney(tx.amount)}
										</span>
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label="Edit transaction"
											disabled={busyIds.has(tx.id)}
											onClick={() => setEditTarget(tx)}
										>
											<Pencil />
										</Button>
									</div>
								</div>

								{tx.capture && (
									<details className="text-xs">
										<summary className="cursor-pointer text-muted-foreground">
											Original message
										</summary>
										<p className="mt-1 rounded-md bg-muted/50 p-2 whitespace-pre-wrap">
											{tx.capture.text}
										</p>
									</details>
								)}

								<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
									<div className="flex flex-col gap-1.5">
										<Label htmlFor={`category-${tx.id}`}>Category</Label>
										<Select
											value={categoryChoice[tx.id] ?? UNCATEGORIZED_CATEGORY_ID}
											onValueChange={(value) =>
												setCategoryChoice((prev) => ({ ...prev, [tx.id]: value }))
											}
										>
											<SelectTrigger id={`category-${tx.id}`} className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value={UNCATEGORIZED_CATEGORY_ID}>Uncategorized</SelectItem>
												{categoryOptions(categories).map(({ id, label }) => (
													<SelectItem key={id} value={id}>
														{label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor={`tags-${tx.id}`}>Tags (comma-separated)</Label>
										<Input
											id={`tags-${tx.id}`}
											value={tagsInput[tx.id] ?? ''}
											onChange={(e) =>
												setTagsInput((prev) => ({ ...prev, [tx.id]: e.target.value }))
											}
										/>
									</div>
								</div>

								{tx.type !== 'transfer' && detectCardPayment(originalMessageOf(tx)) && (
									<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-2">
										<p className="text-xs text-muted-foreground">
											Looks like a credit card payment. Confirmed as is, it counts as{' '}
											{tx.amount < 0 ? 'spending' : 'income'} and the card's balance won't change.
										</p>
										<Button
											size="sm"
											variant="outline"
											aria-label="Record as transfer"
											onClick={() => setConvertTarget(tx)}
										>
											<ArrowRightLeft /> Record as transfer
										</Button>
									</div>
								)}

								{tx.merchantId &&
									(categoryChoice[tx.id] ?? UNCATEGORIZED_CATEGORY_ID) !==
										UNCATEGORIZED_CATEGORY_ID &&
									ruleFor(tx.merchantId)?.categoryId !== categoryChoice[tx.id] && (
										<label className="flex items-center gap-2 text-xs text-muted-foreground">
											<input
												type="checkbox"
												checked={!!rememberRule[tx.id]}
												onChange={(e) =>
													setRememberRule((prev) => ({ ...prev, [tx.id]: e.target.checked }))
												}
											/>
											{ruleFor(tx.merchantId)
												? `Update my rule for ${merchantName(tx.merchantId) ?? 'this merchant'} to this choice`
												: `Remember this choice for ${merchantName(tx.merchantId) ?? 'this merchant'} (creates a rule)`}
										</label>
									)}

								<div className="flex items-center justify-end gap-2">
									{!tx.recurringRuleId && tx.type !== 'transfer' && (
										<Button
											size="sm"
											variant="ghost"
											aria-label="Mark as transfer"
											onClick={() => setConvertTarget(tx)}
										>
											<ArrowRightLeft /> Transfer
										</Button>
									)}
									{tx.recurringRuleId ? (
										<Badge variant="secondary" className="gap-1">
											<Repeat className="size-3" /> Already recurring
										</Badge>
									) : (
										<Button
											size="sm"
											variant="outline"
											aria-label="Mark as recurring"
											onClick={() => openRecurringDialog(tx)}
										>
											<Repeat className="size-4" /> Recurring
										</Button>
									)}
									<Button
										size="sm"
										variant="secondary"
										aria-label="Confirm transaction"
										disabled={busyIds.has(tx.id)}
										onClick={() => void accept(tx)}
									>
										<CheckCircle2 className="text-emerald-600 dark:text-emerald-400" />
										Confirm
									</Button>
									{/* Deliberately separated (not adjacent) from Confirm and visually
									    de-emphasized (ghost, icon-only): this page triages many transactions
									    quickly, and a slightly mis-placed tap must not as easily discard as
									    confirm. */}
									<Button
										size="icon-sm"
										variant="ghost"
										className="ml-4"
										aria-label="Discard transaction"
										disabled={busyIds.has(tx.id)}
										onClick={() => void reject(tx)}
									>
										<Trash2 className="text-destructive" />
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
					{hidden > 0 && (
						<Button
							variant="outline"
							className="self-center"
							disabled={loadingMore || working}
							onClick={() => void showMore()}
						>
							{loadingMore
								? 'Loading…'
								: `Show ${Math.min(PAGE_SIZE, hidden)} more (${hidden} not shown)`}
						</Button>
					)}
				</div>
			)}
			{editTarget && (
				<EditTransactionDialog
					transaction={editTarget}
					accounts={accounts}
					categories={categories}
					merchants={merchants}
					initialCategoryId={categoryChoice[editTarget.id]}
					initialTagsText={tagsInput[editTarget.id]}
					onOpenChange={(open) => !open && setEditTarget(null)}
					onSaved={() => void reloadRow(editTarget.id)}
					onRecordAsTransfer={(tx) => setConvertTarget(tx)}
				/>
			)}
			{convertTarget && (
				<ConvertToTransferDialog
					transaction={convertTarget}
					accounts={accounts.filter((a) => !a.isArchived)}
					merchants={merchants}
					suggestedAccountId={suggestedCardFor(convertTarget)}
					onOpenChange={(open) => !open && setConvertTarget(null)}
					onConverted={() => {
						setConvertTarget(null);
						void refresh();
					}}
				/>
			)}
			<Dialog open={!!recurringTarget} onOpenChange={(open) => !open && setRecurringTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Mark as recurring</DialogTitle>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						<p className="text-sm text-muted-foreground">
							Create a recurring rule from this transaction. You can adjust the frequency and day
							before confirming.
						</p>
						<div className="grid grid-cols-2 gap-3">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="recurring-frequency">Frequency</Label>
								<Select
									value={recurringFrequency}
									onValueChange={(v) => changeRecurringFrequency(v as RecurringFrequency)}
								>
									<SelectTrigger id="recurring-frequency" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="weekly">Weekly</SelectItem>
										<SelectItem value="monthly">Monthly</SelectItem>
										<SelectItem value="yearly">Yearly</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="recurring-day">{DAY_RANGE[recurringFrequency].label}</Label>
								<Input
									id="recurring-day"
									type="number"
									min={DAY_RANGE[recurringFrequency].min}
									max={DAY_RANGE[recurringFrequency].max}
									value={recurringDay}
									onChange={(e) => setRecurringDay(e.target.value)}
								/>
								<p className="text-xs text-muted-foreground">
									{DAY_RANGE[recurringFrequency].hint}
								</p>
							</div>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRecurringTarget(null)}>
							Cancel
						</Button>
						<Button onClick={() => void confirmRecurring()}>Create recurring rule</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
