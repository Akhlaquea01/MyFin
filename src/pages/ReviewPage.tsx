import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	ArrowRightLeft,
	CheckCheck,
	CheckCircle2,
	Inbox,
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
import type {
	Account,
	Category,
	Merchant,
	RecurringFrequency,
	Transaction,
	TransactionSplit
} from '../domain/entities';
import { categoryOptions } from '../domain/categories/categoryHierarchy';

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

// User Story 4 (P4): review queue for unreviewed/unconfirmed transactions from Quick Add
// and bulk import (FR-022) — nothing lands in reports until the user accepts it here.
// Spec 006 extends this with an editable category/tag pre-fill (rule- or suggestion-based)
// that the user can accept as-is or override before confirming.
export function ReviewPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [merchants, setMerchants] = useState<Merchant[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [items, setItems] = useState<Transaction[]>([]);
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
	const [working, setWorking] = useState(false);

	async function refresh() {
		setLoading(true);
		try {
			const [accts, allMerchants, allCategories, allTags, unreviewed, allRules] = await Promise.all(
				[
					AccountRepository.list(key),
					MerchantRepository.list(key),
					CategoryRepository.list(key),
					TagRepository.list(key),
					TransactionRepository.listUnreviewed(key),
					CategorizationRuleRepository.list(key)
				]
			);
			setAccounts(accts);
			setRules(allRules);
			setMerchants(allMerchants);
			setCategories(allCategories);
			setItems(unreviewed);

			const nextFirstSplit: Record<string, TransactionSplit | undefined> = {};
			const nextCategoryChoice: Record<string, string> = {};
			const nextTagsInput: Record<string, string> = {};
			await Promise.all(
				unreviewed.map(async (tx) => {
					const [splits, tagIds] = await Promise.all([
						TransactionRepository.getSplits(key, tx.id),
						TransactionTagRepository.getTagIds(tx.id)
					]);
					nextFirstSplit[tx.id] = splits[0];
					nextCategoryChoice[tx.id] = splits[0]?.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
					nextTagsInput[tx.id] = tagIds
						.map((id) => allTags.find((t) => t.id === id)?.name)
						.filter((name): name is string => Boolean(name))
						.join(', ');
				})
			);
			setFirstSplit(nextFirstSplit);
			setCategoryChoice(nextCategoryChoice);
			setTagsInput(nextTagsInput);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load this page.');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
			tx.notes ?? '',
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

	async function accept(tx: Transaction) {
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
				await refresh();
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
		setItems((prev) => prev.filter((t) => t.id !== tx.id));
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
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not categorize the queue.');
		} finally {
			setWorking(false);
		}
	}

	/** Confirms every entry that already has a category, leaving the uncategorized ones to review. */
	async function confirmAllCategorized() {
		const ready = items.filter(
			(tx) => (categoryChoice[tx.id] ?? UNCATEGORIZED_CATEGORY_ID) !== UNCATEGORIZED_CATEGORY_ID
		);
		if (ready.length === 0) return;
		if (
			!window.confirm(
				`Confirm ${ready.length} categorized ${ready.length === 1 ? 'entry' : 'entries'} as shown? Anything still "Uncategorized" stays in the queue.`
			)
		) {
			return;
		}
		setWorking(true);
		try {
			for (const tx of ready) await confirmOne(tx);
			toast.success(`Confirmed ${ready.length} ${ready.length === 1 ? 'entry' : 'entries'}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not confirm every entry.');
		} finally {
			setWorking(false);
			await refresh();
		}
	}

	function openRecurringDialog(tx: Transaction) {
		// tx.date is a plain "YYYY-MM-DD" string; parsing it with `new Date(...)` reads it as
		// UTC midnight and `.getDate()` then returns the *local* day, which can be off by one
		// depending on the viewer's timezone. Read the day-of-month directly from the string.
		const dayOfMonth = Number(tx.date.slice(8, 10)) || 1;
		setRecurringDay(String(dayOfMonth));
		setRecurringFrequency('monthly');
		setRecurringTarget(tx);
	}

	async function confirmRecurring() {
		if (!recurringTarget) return;
		try {
			const day = Math.max(1, Math.min(31, parseInt(recurringDay) || 1));
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

	async function reject(tx: Transaction) {
		await TransactionEngine.deleteTransaction(key, tx.id);
		// This page exists for fast triage of many transactions, with Confirm/Discard sitting
		// right next to each other — an undo path matters more here than on a page where
		// deletion is a slower, more deliberate action.
		toast.success('Discarded', {
			action: {
				label: 'Undo',
				onClick: () => {
					void TransactionEngine.restoreTransaction(key, tx.id).then(refresh);
				}
			}
		});
		// Local patch: remove the discarded transaction from the queue
		setItems((prev) => prev.filter((t) => t.id !== tx.id));
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
						disabled={
							working ||
							!items.some(
								(tx) =>
									(categoryChoice[tx.id] ?? UNCATEGORIZED_CATEGORY_ID) !== UNCATEGORIZED_CATEGORY_ID
							)
						}
						onClick={() => void confirmAllCategorized()}
					>
						<CheckCheck /> Confirm all categorized
					</Button>
					<span className="text-xs text-muted-foreground">
						{items.length} waiting · nothing counts in reports until it is confirmed
					</span>
				</div>
			)}

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : items.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<Inbox className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">Nothing to review.</p>
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
										</p>
										<p className="text-xs text-muted-foreground">
											{tx.date} · {accountName(tx.accountId)}
										</p>
									</div>
									<span
										className={`font-mono text-sm ${tx.amount < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}
									>
										{formatMoney(tx.amount)}
									</span>
								</div>

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

								{tx.type !== 'transfer' && detectCardPayment(tx.notes) && (
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
										onClick={() => accept(tx)}
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
										onClick={() => reject(tx)}
									>
										<Trash2 className="text-destructive" />
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
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
									onValueChange={(v) => setRecurringFrequency(v as RecurringFrequency)}
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
								<Label htmlFor="recurring-day">Day of period</Label>
								<Input
									id="recurring-day"
									type="number"
									min={1}
									max={31}
									value={recurringDay}
									onChange={(e) => setRecurringDay(e.target.value)}
								/>
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
