import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
	ArrowRightLeft,
	Check,
	Paperclip,
	Plus,
	Search,
	Tag as TagIcon,
	X,
	Bookmark,
	Save,
	Trash2,
	Edit2,
	Pencil
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter
} from '../components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger
} from '../components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow
} from '../components/ui/table';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../data/dexie/transactionRepository';
import { AttachmentRepository } from '../data/dexie/attachmentRepository';
import { TagRepository } from '../data/dexie/tagRepository';
import { MerchantRepository } from '../data/dexie/merchantRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { EditTransactionDialog } from '../components/EditTransactionDialog';
import { ConvertToTransferDialog } from '../components/ConvertToTransferDialog';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import { filterTagOptions, type TagOption } from '../domain/transactions/tagFilterEngine';
import { formatTransactionLabel } from '../domain/transactions/transactionLabel';
import { describeCaptureMoment } from '../domain/capture/captureMoment';
import { PURPOSE_SHORT_LABELS } from '../domain/transactions/purposeEngine';
import { linkedTransactionNotice } from '../domain/transactions/linkedTransactionNotice';
import { validateAttachmentFile, compressImage } from '../lib/imageAttachment';
import type {
	Account,
	Attachment,
	Category,
	Merchant,
	Transaction,
	SavedFilterView
} from '../domain/entities';
import { SavedFilterViewRepository } from '../data/dexie/savedFilterViewRepository';
import { buildCategoryLabels } from '../domain/categories/categoryHierarchy';
import { useConfirm } from '../lib/confirm';
import { formatMoney } from '../domain/shared/money';

// Row-level (not library) virtualization: past this many rows, rendering every <tr> at
// once is the actual jank source at 10k+ transactions (SC-008), so only the rows within
// (plus a small overscan around) the scrolled viewport are mounted. Below the threshold,
// the list renders normally in the page's own scroll — no fixed-height scroll box.
const VIRTUALIZE_THRESHOLD = 200;
const ROW_HEIGHT_PX = 49;
const OVERSCAN_ROWS = 8;
const VIEWPORT_HEIGHT_PX = 560;
/** Settles a scroll gesture before querying attachment counts for the new window. */
const ATTACHMENT_COUNT_DEBOUNCE_MS = 120;

/**
 * Folds a fresh count query into the existing map.
 *
 * Every id that was queried is written explicitly, including as `0`: `countsForTransactions`
 * only returns ids that actually have attachments, so a plain spread would leave the previous
 * non-zero count in place after the last attachment on a row was removed — the badge would
 * never clear. Ids outside `queriedIds` are preserved so rows scrolled out of view keep their
 * counts instead of flickering when they scroll back.
 */
function mergeCounts(
	previous: Record<string, number>,
	queriedIds: string[],
	counts: Record<string, number>
): Record<string, number> {
	const next = { ...previous };
	for (const id of queriedIds) next[id] = counts[id] ?? 0;
	return next;
}

// User Story 2 (P2): search/filter (FR-013) and delete (FR-014) of transactions.
export function TransactionsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const confirm = useConfirm();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [merchants, setMerchants] = useState<Merchant[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [transactions, setTransactions] = useState<Transaction[]>([]);
	const [editTx, setEditTx] = useState<Transaction | null>(null);
	const [convertTx, setConvertTx] = useState<Transaction | null>(null);
	// Per visible row, fetched lazily like attachment counts: the category label, and — for a
	// transfer — the account on its other side.
	const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
	const [counterpartAccounts, setCounterpartAccounts] = useState<Record<string, string>>({});
	const [accountFilter, setAccountFilter] = useState('');
	const [dateFrom, setDateFrom] = useState('');
	const [dateTo, setDateTo] = useState('');
	const [freeText, setFreeText] = useState('');
	const [tags, setTags] = useState<TagOption[]>([]);
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
	const [tagQuery, setTagQuery] = useState('');
	const [loading, setLoading] = useState(true);
	const [scrollTop, setScrollTop] = useState(0);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
	const [attachmentDialogTx, setAttachmentDialogTx] = useState<Transaction | null>(null);

	const hasActiveFilters =
		accountFilter !== '' ||
		dateFrom !== '' ||
		dateTo !== '' ||
		freeText.trim() !== '' ||
		selectedTagIds.length > 0;
	function clearAllFilters() {
		setAccountFilter('');
		setDateFrom('');
		setDateTo('');
		setFreeText('');
		setSelectedTagIds([]);
	}
	const [savedViews, setSavedViews] = useState<SavedFilterView[]>([]);
	const [saveViewOpen, setSaveViewOpen] = useState(false);
	const [newViewName, setNewViewName] = useState('');
	const [savingView, setSavingView] = useState(false);
	const [renamingView, setRenamingView] = useState<SavedFilterView | null>(null);
	const [renameViewName, setRenameViewName] = useState('');

	const isVirtualized = transactions.length > VIRTUALIZE_THRESHOLD;
	const { visibleTransactions, topSpacerPx, bottomSpacerPx } = useMemo(() => {
		if (!isVirtualized) {
			return { visibleTransactions: transactions, topSpacerPx: 0, bottomSpacerPx: 0 };
		}
		const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
		const endIndex = Math.min(
			transactions.length,
			Math.ceil((scrollTop + VIEWPORT_HEIGHT_PX) / ROW_HEIGHT_PX) + OVERSCAN_ROWS
		);
		return {
			visibleTransactions: transactions.slice(startIndex, endIndex),
			topSpacerPx: startIndex * ROW_HEIGHT_PX,
			bottomSpacerPx: (transactions.length - endIndex) * ROW_HEIGHT_PX
		};
	}, [transactions, scrollTop, isVirtualized]);

	function accountName(id: string): string {
		return accounts.find((a) => a.id === id)?.name ?? id;
	}

	function tagName(id: string): string {
		return tags.find((t) => t.id === id)?.name ?? id;
	}

	function toggleTag(id: string) {
		setSelectedTagIds((prev) =>
			prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]
		);
	}

	async function refresh() {
		setLoading(true);
		try {
			setAccounts(await AccountRepository.list(key));
			setMerchants(await MerchantRepository.list(key));
			setCategories(await CategoryRepository.list(key));
			setTags(await TagRepository.listInUse(key));
			setSavedViews(await SavedFilterViewRepository.list(key));
			setTransactions(
				await TransactionRepository.search(key, {
					accountId: accountFilter || undefined,
					dateFrom: dateFrom || undefined,
					dateTo: dateTo || undefined,
					freeText: freeText || undefined,
					tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined
				})
			);
			setScrollTop(0);
			if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
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

	// research.md §4: one bulk query for the currently-visible window of rows, never one
	// query per row — stays proportional to viewport size, not total transaction count.
	//
	// Keyed on the id list rather than the array identity: `visibleTransactions` is rebuilt by
	// `useMemo` on every scroll event, so depending on its identity fired an IndexedDB query per
	// scroll frame, each resolving out of order and *replacing* the count map — which made the
	// paperclip badges flicker while scrolling. The debounce settles the scroll first, and the
	// merge keeps counts already fetched for rows still on screen.
	const visibleIdsKey = useMemo(
		() => visibleTransactions.map((t) => t.id).join(','),
		[visibleTransactions]
	);

	useEffect(() => {
		let cancelled = false;
		const handle = setTimeout(() => {
			const ids = visibleIdsKey ? visibleIdsKey.split(',') : [];
			void AttachmentRepository.countsForTransactions(key, ids)
				.then((counts) => {
					if (!cancelled) setAttachmentCounts((prev) => mergeCounts(prev, ids, counts));
				})
				.catch(() => {
					// A missing paperclip badge is not worth interrupting the user for.
				});
		}, ATTACHMENT_COUNT_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(handle);
		};
	}, [visibleIdsKey, key]);

	useEffect(() => {
		let cancelled = false;
		const handle = setTimeout(() => {
			const ids = visibleIdsKey ? visibleIdsKey.split(',') : [];
			if (ids.length === 0) return;
			void (async () => {
				const splitsByTx = await TransactionRepository.splitsByTransaction(key, ids);
				const categoryLabels = buildCategoryLabels(categories);
				const labels: Record<string, string> = {};
				for (const id of ids) {
					const splits = splitsByTx.get(id) ?? [];
					if (splits.length > 1) labels[id] = `Split (${splits.length})`;
					else if (splits.length === 0 || splits[0].categoryId === UNCATEGORIZED_CATEGORY_ID)
						labels[id] = '';
					else labels[id] = categoryLabels.get(splits[0].categoryId) ?? '';
				}

				const counterparts: Record<string, string> = {};
				const byId = new Map(transactions.map((t) => [t.id, t]));
				for (const tx of visibleTransactions) {
					if (!tx.transferPairId) continue;
					const pair =
						byId.get(tx.transferPairId) ??
						(await TransactionRepository.getById(key, tx.transferPairId));
					if (pair) counterparts[tx.id] = pair.accountId;
				}
				if (!cancelled) {
					setCategoryLabels((prev) => ({ ...prev, ...labels }));
					setCounterpartAccounts((prev) => ({ ...prev, ...counterparts }));
				}
			})().catch(() => {
				// A missing category label is not worth interrupting the user for.
			});
		}, ATTACHMENT_COUNT_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(handle);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visibleIdsKey, key, categories]);

	function refreshAttachmentCounts() {
		const ids = visibleTransactions.map((t) => t.id);
		void AttachmentRepository.countsForTransactions(key, ids)
			.then((counts) => setAttachmentCounts((prev) => mergeCounts(prev, ids, counts)))
			.catch(() => {});
	}

	async function remove(tx: Transaction) {
		try {
			// The ledger movement behind a person loan/repayment is not an ordinary entry: deleting it
			// here left the loan still "pending" for money that had been taken back out of the account.
			const link = await TransactionRepository.getLoanLink(key, tx.id);
			if (link) {
				toast.error(linkedTransactionNotice(link).message);
				return;
			}
		} catch {
			// If the check itself fails, fall through to the normal confirmation rather than block.
		}
		const confirmed = await confirm({
			message: tx.transferPairId
				? 'This is a transfer — both sides (the money leaving one account and arriving in the other) will be deleted, along with any receipts. This cannot be undone.'
				: 'Delete this transaction and any attached receipts? This cannot be undone.',
			confirmLabel: 'Delete permanently',
			destructive: true
		});
		if (!confirmed) return;
		try {
			await TransactionEngine.deleteTransaction(key, tx.id);
			toast.success('Transaction deleted');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete transaction.');
		}
	}

	async function handleSaveView() {
		if (!newViewName.trim()) {
			toast.error('Please enter a name for the view.');
			return;
		}
		setSavingView(true);
		try {
			const existing = await SavedFilterViewRepository.findByName(key, newViewName.trim());
			if (existing) {
				if (
					!(await confirm({
						message: `A view named "${existing.name}" already exists. Overwrite?`,
						confirmLabel: 'Overwrite',
						destructive: false
					}))
				) {
					setSavingView(false);
					return;
				}
				await SavedFilterViewRepository.update(key, existing.id, {
					accountId: accountFilter || null,
					dateFrom: dateFrom || null,
					dateTo: dateTo || null,
					freeText: freeText || null,
					tagIds: selectedTagIds
				});
			} else {
				await SavedFilterViewRepository.create(key, {
					name: newViewName.trim(),
					accountId: accountFilter || null,
					dateFrom: dateFrom || null,
					dateTo: dateTo || null,
					freeText: freeText || null,
					tagIds: selectedTagIds
				});
			}
			toast.success('View saved successfully.');
			setSaveViewOpen(false);
			setNewViewName('');
			setSavedViews(await SavedFilterViewRepository.list(key));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save view.');
		} finally {
			setSavingView(false);
		}
	}

	async function handleRenameView() {
		if (!renamingView || !renameViewName.trim()) return;
		try {
			const existing = await SavedFilterViewRepository.findByName(key, renameViewName.trim());
			if (existing && existing.id !== renamingView.id) {
				toast.error(`A view named "${existing.name}" already exists.`);
				return;
			}
			await SavedFilterViewRepository.update(key, renamingView.id, { name: renameViewName.trim() });
			toast.success('View renamed.');
			setRenamingView(null);
			setSavedViews(await SavedFilterViewRepository.list(key));
		} catch {
			toast.error('Could not rename view.');
		}
	}

	async function handleDeleteView(id: string) {
		if (
			!(await confirm({
				message: 'Delete this saved view?',
				confirmLabel: 'Delete view',
				destructive: true
			}))
		)
			return;
		try {
			await SavedFilterViewRepository.delete(id);
			toast.success('Saved view deleted.');
			setSavedViews(await SavedFilterViewRepository.list(key));
		} catch {
			toast.error('Could not delete view.');
		}
	}

	function applySavedView(view: SavedFilterView) {
		let hasMissingAccounts = false;
		const newAccountId =
			view.accountId && accounts.some((a) => a.id === view.accountId) ? view.accountId : '';
		if (view.accountId && !newAccountId) hasMissingAccounts = true;

		const newDateFrom = view.dateFrom || '';
		const newDateTo = view.dateTo || '';
		const newFreeText = view.freeText || '';

		let hasMissingTags = false;
		const newTagIds: string[] = [];
		for (const tid of view.tagIds) {
			if (tags.some((t) => t.id === tid)) newTagIds.push(tid);
			else hasMissingTags = true;
		}

		setAccountFilter(newAccountId);
		setDateFrom(newDateFrom);
		setDateTo(newDateTo);
		setFreeText(newFreeText);
		setSelectedTagIds(newTagIds);

		if (hasMissingAccounts || hasMissingTags) {
			toast.warning('Some filter criteria (like a deleted account or tag) could not be applied.');
		} else {
			toast.success(`Applied view "${view.name}"`);
		}

		setLoading(true);
		TransactionRepository.search(key, {
			accountId: newAccountId || undefined,
			dateFrom: newDateFrom || undefined,
			dateTo: newDateTo || undefined,
			freeText: newFreeText || undefined,
			tagIds: newTagIds.length > 0 ? newTagIds : undefined
		})
			.then(setTransactions)
			.catch(() => toast.error('Failed to apply filter view.'))
			.finally(() => setLoading(false));
	}

	return (
		<div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
				<div className="flex gap-2">
					<Button variant="outline" asChild>
						<Link to="/transactions/transfer">
							<ArrowRightLeft /> Transfer
						</Link>
					</Button>
					<Button asChild>
						<Link to="/transactions/new">
							<Plus /> New transaction
						</Link>
					</Button>
				</div>
			</div>

			<Card className="mb-6">
				<CardContent className="flex flex-wrap items-end gap-3 pt-6">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="tx-filter-account" className="text-xs text-muted-foreground">
							Account
						</Label>
						<Select
							value={accountFilter || '__all__'}
							onValueChange={(v) => setAccountFilter(v === '__all__' ? '' : v)}
						>
							<SelectTrigger id="tx-filter-account" className="w-40">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="__all__">All</SelectItem>
								{accounts.map((a) => (
									<SelectItem key={a.id} value={a.id}>
										{a.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="tx-filter-from" className="text-xs text-muted-foreground">
							From
						</Label>
						<Input
							id="tx-filter-from"
							type="date"
							value={dateFrom}
							onChange={(e) => setDateFrom(e.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="tx-filter-to" className="text-xs text-muted-foreground">
							To
						</Label>
						<Input
							id="tx-filter-to"
							type="date"
							value={dateTo}
							onChange={(e) => setDateTo(e.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs text-muted-foreground">Tags</Label>
						<Popover
							onOpenChange={(open) => {
								if (!open) setTagQuery('');
							}}
						>
							<PopoverTrigger asChild>
								<Button variant="outline" className="w-40 justify-start">
									<TagIcon />
									{selectedTagIds.length > 0 ? `${selectedTagIds.length} selected` : 'All tags'}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-64">
								{tags.length === 0 ? (
									<p className="text-sm text-muted-foreground">No tags yet.</p>
								) : (
									<div className="flex flex-col gap-2">
										<Input
											placeholder="Search tags…"
											value={tagQuery}
											onChange={(e) => setTagQuery(e.target.value)}
											autoFocus
										/>
										<p className="text-xs text-muted-foreground">
											Shows transactions matching any selected tag.
										</p>
										<div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
											{filterTagOptions(tags, tagQuery).length === 0 ? (
												<p className="px-2 py-1 text-sm text-muted-foreground">
													No tags match &ldquo;{tagQuery}&rdquo;.
												</p>
											) : (
												filterTagOptions(tags, tagQuery).map((t) => (
													<button
														key={t.id}
														type="button"
														className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
														onClick={() => toggleTag(t.id)}
													>
														<span className="flex size-4 items-center justify-center">
															{selectedTagIds.includes(t.id) && <Check className="size-4" />}
														</span>
														{t.name}
													</button>
												))
											)}
										</div>
										{selectedTagIds.length > 0 && (
											<Button
												variant="ghost"
												size="sm"
												className="self-start"
												onClick={() => setSelectedTagIds([])}
											>
												Clear tags
											</Button>
										)}
									</div>
								)}
							</PopoverContent>
						</Popover>
					</div>
					<div className="flex flex-1 flex-col gap-1.5">
						<Label htmlFor="tx-filter-search" className="text-xs text-muted-foreground">
							Search (notes or tags)
						</Label>
						<Input
							id="tx-filter-search"
							value={freeText}
							onChange={(e) => setFreeText(e.target.value)}
						/>
					</div>
					<Button variant="secondary" onClick={() => void refresh()}>
						<Search /> Filter
					</Button>
					<div className="ml-auto flex gap-1.5">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline">
									<Bookmark className="mr-2" /> Saved Views
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-56">
								{savedViews.length === 0 ? (
									<div className="p-2 text-center text-sm text-muted-foreground">
										No saved views
									</div>
								) : (
									savedViews.map((view) => (
										<div
											key={view.id}
											className="group flex items-center justify-between rounded-sm px-2 py-1.5 hover:bg-accent"
										>
											<button
												className="mr-2 flex-1 truncate text-left text-sm"
												onClick={() => applySavedView(view)}
											>
												{view.name}
											</button>
											<div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
												<button
													className="rounded p-1 hover:bg-muted"
													onClick={() => {
														setRenameViewName(view.name);
														setRenamingView(view);
													}}
													aria-label="Rename"
												>
													<Edit2 className="size-3 text-muted-foreground" />
												</button>
												<button
													className="rounded p-1 text-destructive hover:bg-muted"
													onClick={() => void handleDeleteView(view.id)}
													aria-label="Delete"
												>
													<Trash2 className="size-3" />
												</button>
											</div>
										</div>
									))
								)}
							</DropdownMenuContent>
						</DropdownMenu>

						<Button variant="outline" onClick={() => setSaveViewOpen(true)}>
							<Save className="mr-2" /> Save View
						</Button>
					</div>
					{selectedTagIds.length > 0 && (
						<div className="flex w-full flex-wrap gap-1.5">
							{selectedTagIds.map((id) => (
								<Badge key={id} variant="secondary" className="gap-1">
									{tagName(id)}
									<button
										type="button"
										aria-label={`Remove tag filter ${tagName(id)}`}
										onClick={() => toggleTag(id)}
									>
										<X className="size-3" />
									</button>
								</Badge>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : transactions.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
						{hasActiveFilters ? (
							<>
								<p>No transactions match these filters.</p>
								<Button variant="outline" size="sm" onClick={clearAllFilters}>
									Clear filters
								</Button>
							</>
						) : (
							<>
								<p>No transactions yet.</p>
								<div className="flex flex-wrap justify-center gap-2">
									<Button size="sm" asChild>
										<Link to="/transactions/new">Add your first one</Link>
									</Button>
									<Button size="sm" variant="outline" asChild>
										<Link to="/quick-add">Paste a bank message</Link>
									</Button>
									<Button size="sm" variant="outline" asChild>
										<Link to="/import">Upload a statement file</Link>
									</Button>
								</div>
							</>
						)}
					</CardContent>
				</Card>
			) : (
				<Card>
					<div
						ref={scrollerRef}
						className={isVirtualized ? 'overflow-y-auto' : undefined}
						style={isVirtualized ? { maxHeight: VIEWPORT_HEIGHT_PX } : undefined}
						onScroll={isVirtualized ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
					>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Date</TableHead>
									<TableHead>Description</TableHead>
									<TableHead>Account</TableHead>
									<TableHead className="hidden md:table-cell">Category</TableHead>
									<TableHead className="text-right">Amount</TableHead>
									<TableHead className="w-12" />
									<TableHead className="w-28" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{isVirtualized && topSpacerPx > 0 && (
									<tr style={{ height: topSpacerPx }} aria-hidden="true">
										<td colSpan={7} />
									</tr>
								)}
								{visibleTransactions.map((tx) => (
									<TableRow
										key={tx.id}
										style={isVirtualized ? { height: ROW_HEIGHT_PX } : undefined}
									>
										<TableCell className="text-muted-foreground">
											{tx.date}
											{tx.capture && (
												<span
													className="ml-1 text-xs whitespace-nowrap"
													title={describeCaptureMoment(tx.capture)}
												>
													{new Date(tx.capture.txnAt ?? tx.capture.receivedAt).toLocaleTimeString(
														undefined,
														{ hour: 'numeric', minute: '2-digit' }
													)}
												</span>
											)}
										</TableCell>
										<TableCell className="w-full max-w-0">
											<div className="flex min-w-0 items-center gap-2">
												<span className="truncate" title={formatTransactionLabel(tx, merchants)}>
													{formatTransactionLabel(tx, merchants)}
												</span>
												{tx.type === 'transfer' && (
													<Badge variant="secondary" className="shrink-0">
														{tx.transferPairId ? 'Transfer' : 'Loan'}
													</Badge>
												)}
												{tx.purpose && (
													<Badge variant="secondary" className="shrink-0">
														{PURPOSE_SHORT_LABELS[tx.purpose.kind]}
													</Badge>
												)}
												{tx.reviewStatus === 'unreviewed' && (
													<Badge variant="outline" className="ml-0 shrink-0">
														Unreviewed
													</Badge>
												)}
											</div>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{accountName(tx.accountId)}
											{tx.transferPairId && counterpartAccounts[tx.id] && (
												<span className="ml-1 text-xs whitespace-nowrap">
													{tx.amount < 0 ? 'to' : 'from'} {accountName(counterpartAccounts[tx.id])}
												</span>
											)}
										</TableCell>
										<TableCell className="hidden text-muted-foreground md:table-cell">
											{tx.type === 'transfer'
												? '—'
												: (categoryLabels[tx.id] ?? '') || (
														<span className="text-xs italic">Uncategorized</span>
													)}
										</TableCell>
										<TableCell
											className={`text-right font-mono ${tx.amount < 0 ? 'text-expense' : 'text-income'}`}
										>
											{formatMoney(tx.amount)}
										</TableCell>
										<TableCell>
											<Button
												variant="ghost"
												size="icon"
												className="relative"
												aria-label="Attachments"
												onClick={() => setAttachmentDialogTx(tx)}
											>
												<Paperclip className="size-4" />
												{(attachmentCounts[tx.id] ?? 0) > 0 && (
													<Badge
														variant="secondary"
														className="absolute -top-1 -right-1 size-4 justify-center rounded-full p-0 text-[10px]"
													>
														{attachmentCounts[tx.id]}
													</Badge>
												)}
											</Button>
										</TableCell>
										<TableCell>
											<div className="flex items-center justify-end gap-1">
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label="Edit transaction"
													onClick={() => setEditTx(tx)}
												>
													<Pencil className="size-4" />
												</Button>
												<Button
													variant="ghost"
													size="sm"
													aria-label="Delete transaction"
													onClick={() => remove(tx)}
												>
													{/* Icon only on a phone, where seven columns leave no room for a word. */}
													<Trash2 className="size-4 sm:hidden" />
													<span className="hidden sm:inline">Delete</span>
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
								{isVirtualized && bottomSpacerPx > 0 && (
									<tr style={{ height: bottomSpacerPx }} aria-hidden="true">
										<td colSpan={7} />
									</tr>
								)}
							</TableBody>
						</Table>
					</div>
				</Card>
			)}

			{editTx && (
				<EditTransactionDialog
					transaction={editTx}
					accounts={accounts}
					categories={categories}
					merchants={merchants}
					onOpenChange={(open) => !open && setEditTx(null)}
					onSaved={() => {
						setEditTx(null);
						// Drop cached labels for the edited row so the category cell re-fetches.
						setCategoryLabels((prev) => {
							const next = { ...prev };
							delete next[editTx.id];
							return next;
						});
						void refresh();
					}}
					onRecordAsTransfer={(tx) => setConvertTx(tx)}
				/>
			)}

			{convertTx && (
				<ConvertToTransferDialog
					transaction={convertTx}
					accounts={accounts.filter((a) => !a.isArchived)}
					merchants={merchants}
					onOpenChange={(open) => !open && setConvertTx(null)}
					onConverted={() => {
						setConvertTx(null);
						setCategoryLabels({});
						setCounterpartAccounts({});
						void refresh();
					}}
				/>
			)}

			{attachmentDialogTx && (
				<AttachmentsDialog
					transaction={attachmentDialogTx}
					onOpenChange={(open) => !open && setAttachmentDialogTx(null)}
					onChanged={() => void refreshAttachmentCounts()}
				/>
			)}

			<Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Save Filter View</DialogTitle>
					</DialogHeader>
					<div className="py-4">
						<Label htmlFor="view-name">View Name</Label>
						<Input
							id="view-name"
							value={newViewName}
							onChange={(e) => setNewViewName(e.target.value)}
							autoFocus
						/>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setSaveViewOpen(false)}>
							Cancel
						</Button>
						<Button onClick={() => void handleSaveView()} disabled={savingView}>
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={!!renamingView} onOpenChange={(open) => !open && setRenamingView(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename Filter View</DialogTitle>
					</DialogHeader>
					<div className="py-4">
						<Label htmlFor="rename-view-name">New Name</Label>
						<Input
							id="rename-view-name"
							value={renameViewName}
							onChange={(e) => setRenameViewName(e.target.value)}
							autoFocus
						/>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRenamingView(null)}>
							Cancel
						</Button>
						<Button onClick={() => void handleRenameView()}>Rename</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

/** User Story 1 (spec 005): view/attach/remove receipt photos for one transaction. */
function AttachmentsDialog({
	transaction,
	onOpenChange,
	onChanged
}: {
	transaction: Transaction;
	onOpenChange: (open: boolean) => void;
	onChanged: () => void;
}) {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const confirm = useConfirm();

	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [loading, setLoading] = useState(true);
	const [uploading, setUploading] = useState(false);
	const [viewing, setViewing] = useState<Attachment | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	async function refreshAttachments() {
		setLoading(true);
		setAttachments(await AttachmentRepository.listForTransaction(key, transaction.id));
		setLoading(false);
	}

	useEffect(() => {
		void refreshAttachments();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (fileInputRef.current) fileInputRef.current.value = '';
		if (!file) return;

		const validation = validateAttachmentFile(file);
		if (!validation.ok) {
			toast.error(validation.reason);
			return;
		}

		setUploading(true);
		try {
			const compressed = await compressImage(file);
			await AttachmentRepository.create(key, { transactionId: transaction.id, ...compressed });
			await refreshAttachments();
			onChanged();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not attach that image.');
		} finally {
			setUploading(false);
		}
	}

	async function removeAttachment(attachment: Attachment) {
		// AttachmentRepository.remove is a permanent hard delete (no undo), so it needs its own
		// confirmation.
		if (
			!(await confirm({
				message: 'Permanently delete this receipt? This cannot be undone.',
				confirmLabel: 'Delete receipt',
				destructive: true
			}))
		)
			return;
		try {
			await AttachmentRepository.remove(key, attachment.id);
			await refreshAttachments();
			onChanged();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete receipt.');
		}
	}

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Attachments</DialogTitle>
				</DialogHeader>
				{loading ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : (
					<div className="flex flex-col gap-4">
						{attachments.length === 0 ? (
							<p className="text-sm text-muted-foreground">No attachments yet.</p>
						) : (
							<div className="grid grid-cols-3 gap-3">
								{attachments.map((a) => (
									<div key={a.id} className="relative">
										<button
											type="button"
											className="block w-full overflow-hidden rounded-md border"
											onClick={() => setViewing(a)}
										>
											<img
												src={`data:${a.mimeType};base64,${a.data}`}
												alt="Receipt attachment"
												className="aspect-square w-full object-cover"
											/>
										</button>
										<Button
											variant="destructive"
											size="icon"
											className="absolute -top-2 -right-2 size-6"
											aria-label="Remove attachment"
											onClick={() => void removeAttachment(a)}
										>
											<X className="size-3" />
										</Button>
									</div>
								))}
							</div>
						)}
						<div>
							<Button
								type="button"
								variant="outline"
								disabled={uploading || attachments.length >= 5}
								onClick={() => fileInputRef.current?.click()}
							>
								<Plus /> {uploading ? 'Adding…' : 'Add attachment'}
							</Button>
							<input
								ref={fileInputRef}
								type="file"
								accept="image/*"
								className="hidden"
								onChange={(e) => void handleFileChange(e)}
							/>
						</div>
					</div>
				)}
			</DialogContent>

			<Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Receipt</DialogTitle>
					</DialogHeader>
					{viewing && (
						<img
							src={`data:${viewing.mimeType};base64,${viewing.data}`}
							alt="Receipt attachment full size"
							className="w-full rounded-md"
						/>
					)}
				</DialogContent>
			</Dialog>
		</Dialog>
	);
}
