import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Inbox, Repeat, Trash2, Upload } from 'lucide-react';
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

	async function refresh() {
		setLoading(true);
		try {
			const [accts, allMerchants, allCategories, allTags, unreviewed] = await Promise.all([
				AccountRepository.list(key),
				MerchantRepository.list(key),
				CategoryRepository.list(key),
				TagRepository.list(key),
				TransactionRepository.listUnreviewed(key)
			]);
			setAccounts(accts);
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

	async function accept(tx: Transaction) {
		const categoryId = categoryChoice[tx.id] ?? UNCATEGORIZED_CATEGORY_ID;
		const splits: SplitInput[] = [{ categoryId, amount: tx.amount }];
		const tagNames = (tagsInput[tx.id] ?? '')
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		const tagIds =
			tagNames.length > 0
				? (await Promise.all(tagNames.map((name) => TagRepository.getOrCreate(key, name)))).map(
						(t) => t.id
					)
				: [];
		await TransactionEngine.confirmTransaction(key, tx.id, splits, tagIds);
		toast.success('Confirmed');
		// Local patch: remove the now-confirmed transaction from the queue
		setItems((prev) => prev.filter((t) => t.id !== tx.id));
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
												{categories.map((c) => (
													<SelectItem key={c.id} value={c.id}>
														{c.name}
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

								<div className="flex items-center justify-end gap-2">
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
