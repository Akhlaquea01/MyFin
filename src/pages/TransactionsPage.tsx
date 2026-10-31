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
	DropdownMenuItem,
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
	UNCATEGORIZED_CATEGORY_ID,
	type TransactionLink
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
import { formatMinorUnits, formatMoney } from '../domain/shared/money';
import { parseAmountRange } from '../domain/transactions/amountFilter';
import {
	bulkDeleteTransactions,
	bulkSetCategory,
	summarizeBulkCategory,
	summarizeBulkDelete
} from '../domain/transactions/bulkActions';
import { CategoryPicker } from '../components/CategoryPicker';
import { useMediaQuery } from '../hooks/useMediaQuery';

// Row-level (not library) virtualization: past this many rows, rendering every <tr> at
// once is the actual jank source at 10k+ transactions (SC-008), so only the rows within
// (plus a small overscan around) the scrolled viewport are mounted. Below the threshold,
// the list renders normally in the page's own scroll — no fixed-height scroll box.
const VIRTUALIZE_THRESHOLD = 200;
const ROW_HEIGHT_PX = 49;
/** Below Tailwind's `sm` there is no room for seven columns, so each entry is a card instead. */
const PHONE_QUERY = '(max-width: 639px)';
/** Fixed, like a table row, so the virtualization arithmetic holds; content is sized to fit. */
const CARD_HEIGHT_PX = 96;
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
/** Badge for a one-sided transfer: what record it belongs to, or plain "Movement" when none holds it. */
function movementLabel(kind: TransactionLink['kind'] | undefined): string {
	if (kind === 'loan' || kind === 'repayment') return 'Loan';
	if (kind === 'investment-trade') return 'Investment';
	return 'Movement';
}

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
	const [amountMin, setAmountMin] = useState('');
	const [amountMax, setAmountMax] = useState('');
	const [tags, setTags] = useState<TagOption[]>([]);
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
	const [tagQuery, setTagQuery] = useState('');
	const [loading, setLoading] = useState(true);
	const [scrollTop, setScrollTop] = useState(0);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
	const [attachmentDialogTx, setAttachmentDialogTx] = useState<Transaction | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
	const [bulkCategoryId, setBulkCategoryId] = useState(UNCATEGORIZED_CATEGORY_ID);
	const [bulkBusy, setBulkBusy] = useState(false);

	const hasActiveFilters =
		accountFilter !== '' ||
		dateFrom !== '' ||
		dateTo !== '' ||
		freeText.trim() !== '' ||
		amountMin.trim() !== '' ||
		amountMax.trim() !== '' ||
		selectedTagIds.length > 0;
	function clearAllFilters() {
		setAccountFilter('');
		setDateFrom('');
		setDateTo('');
		setFreeText('');
		setAmountMin('');
		setAmountMax('');
		setSelectedTagIds([]);
	}
	// A half-typed amount must not hide the list while it is being edited (or after a delete), so
	// anything unreadable here is simply left out; the Filter button reports it.
	function amountBounds() {
		const range = parseAmountRange(amountMin, amountMax);
		return range.ok ? { amountMin: range.min, amountMax: range.max } : {};
	}
	function applyFilters() {
		const range = parseAmountRange(amountMin, amountMax);
		if (!range.ok) {
			toast.error(range.message);
			return;
		}
		void refresh();
	}
	const [savedViews, setSavedViews] = useState<SavedFilterView[]>([]);
	const [linkKinds, setLinkKinds] = useState<Map<string, TransactionLink['kind']>>(new Map());
	const [saveViewOpen, setSaveViewOpen] = useState(false);
	const [newViewName, setNewViewName] = useState('');
	const [savingView, setSavingView] = useState(false);
	const [renamingView, setRenamingView] = useState<SavedFilterView | null>(null);
	const [renameViewName, setRenameViewName] = useState('');

	const isPhone = useMediaQuery(PHONE_QUERY);
	const rowHeightPx = isPhone ? CARD_HEIGHT_PX : ROW_HEIGHT_PX;
	const isVirtualized = transactions.length > VIRTUALIZE_THRESHOLD;
	const { visibleTransactions, topSpacerPx, bottomSpacerPx } = useMemo(() => {
		if (!isVirtualized) {
			return { visibleTransactions: transactions, topSpacerPx: 0, bottomSpacerPx: 0 };
		}
		const startIndex = Math.max(0, Math.floor(scrollTop / rowHeightPx) - OVERSCAN_ROWS);
		const endIndex = Math.min(
			transactions.length,
			Math.ceil((scrollTop + VIEWPORT_HEIGHT_PX) / rowHeightPx) + OVERSCAN_ROWS
		);
		return {
			visibleTransactions: transactions.slice(startIndex, endIndex),
			topSpacerPx: startIndex * rowHeightPx,
			bottomSpacerPx: (transactions.length - endIndex) * rowHeightPx
		};
	}, [transactions, scrollTop, isVirtualized, rowHeightPx]);

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
			// Only decides how a one-sided transfer is labelled, so a failure here is not worth an error.
			setLinkKinds(await TransactionRepository.linkKindsByTransaction(key).catch(() => new Map()));
			setTransactions(
				await TransactionRepository.search(key, {
					accountId: accountFilter || undefined,
					dateFrom: dateFrom || undefined,
					dateTo: dateTo || undefined,
					freeText: freeText || undefined,
					tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
					...amountBounds()
				})
			);
			// The list was just rebuilt, so a selection could name rows that are no longer there.
			setSelectedIds(new Set());
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

	function toggleSelected(id: string) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	const allSelected = transactions.length > 0 && selectedIds.size === transactions.length;
	function toggleAllSelected() {
		setSelectedIds(allSelected ? new Set() : new Set(transactions.map((t) => t.id)));
	}

	const selectAll = (
		<input
			type="checkbox"
			className="size-4 accent-primary"
			aria-label="Select all transactions"
			checked={allSelected}
			ref={(el) => {
				if (el) el.indeterminate = selectedIds.size > 0 && !allSelected;
			}}
			onChange={toggleAllSelected}
		/>
	);

	function reportBulk({ message, partial }: { message: string; partial: boolean }) {
		if (partial) toast.warning(message);
		else toast.success(message);
	}

	async function bulkDelete() {
		const count = selectedIds.size;
		const confirmed = await confirm({
			message: `Delete ${count} ${count === 1 ? 'transaction' : 'transactions'} and any attached receipts? A transfer loses both its sides. This cannot be undone.`,
			confirmLabel: 'Delete permanently',
			destructive: true
		});
		if (!confirmed) return;
		setBulkBusy(true);
		try {
			reportBulk(summarizeBulkDelete(await bulkDeleteTransactions(key, [...selectedIds])));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete the transactions.');
		} finally {
			setBulkBusy(false);
		}
		await refresh();
	}

	async function bulkApplyCategory() {
		setBulkBusy(true);
		try {
			reportBulk(
				summarizeBulkCategory(await bulkSetCategory(key, [...selectedIds], bulkCategoryId))
			);
			setBulkCategoryOpen(false);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not change the category.');
		} finally {
			setBulkBusy(false);
		}
		await refresh();
	}

	async function handleSaveView() {
		if (!newViewName.trim()) {
			toast.error('Please enter a name for the view.');
			return;
		}
		const range = parseAmountRange(amountMin, amountMax);
		if (!range.ok) {
			toast.error(range.message);
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
					tagIds: selectedTagIds,
					amountMin: range.min ?? null,
					amountMax: range.max ?? null
				});
			} else {
				await SavedFilterViewRepository.create(key, {
					name: newViewName.trim(),
					accountId: accountFilter || null,
					dateFrom: dateFrom || null,
					dateTo: dateTo || null,
					freeText: freeText || null,
					tagIds: selectedTagIds,
					amountMin: range.min ?? null,
					amountMax: range.max ?? null
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
		const newAmountMin = view.amountMin ?? undefined;
		const newAmountMax = view.amountMax ?? undefined;
		setAmountMin(newAmountMin === undefined ? '' : formatMinorUnits(newAmountMin));
		setAmountMax(newAmountMax === undefined ? '' : formatMinorUnits(newAmountMax));

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
			tagIds: newTagIds.length > 0 ? newTagIds : undefined,
			amountMin: newAmountMin,
			amountMax: newAmountMax
		})
			.then((found) => {
				setTransactions(found);
				setSelectedIds(new Set());
			})
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
						<Label htmlFor="tx-filter-min" className="text-xs text-muted-foreground">
							Min amount
						</Label>
						<Input
							id="tx-filter-min"
							inputMode="decimal"
							className="w-28"
							placeholder="Any"
							value={amountMin}
							onChange={(e) => setAmountMin(e.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="tx-filter-max" className="text-xs text-muted-foreground">
							Max amount
						</Label>
						<Input
							id="tx-filter-max"
							inputMode="decimal"
							className="w-28"
							placeholder="Any"
							value={amountMax}
							onChange={(e) => setAmountMax(e.target.value)}
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
					<Button variant="secondary" onClick={applyFilters}>
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
											{/* A menu item, so choosing a view closes the menu instead of leaving it over the list. */}
											<DropdownMenuItem
												className="mr-2 flex-1 truncate"
												onSelect={() => applySavedView(view)}
											>
												{view.name}
											</DropdownMenuItem>
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

			{selectedIds.size > 0 && (
				<div
					role="region"
					aria-label="Bulk actions"
					className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-sm"
				>
					<span className="mr-auto font-medium">{selectedIds.size} selected</span>
					<Button
						size="sm"
						variant="outline"
						disabled={bulkBusy}
						onClick={() => {
							setBulkCategoryId(UNCATEGORIZED_CATEGORY_ID);
							setBulkCategoryOpen(true);
						}}
					>
						<TagIcon /> Set category
					</Button>
					<Button
						size="sm"
						variant="destructive"
						disabled={bulkBusy}
						onClick={() => void bulkDelete()}
					>
						<Trash2 /> Delete
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={bulkBusy}
						onClick={() => setSelectedIds(new Set())}
					>
						Clear
					</Button>
				</div>
			)}

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
						{isPhone ? (
							<ul>
								<li>
									<label className="flex items-center gap-3 border-b px-3 py-2 text-xs text-muted-foreground">
										{selectAll}
										Select all {transactions.length}
									</label>
								</li>
								{isVirtualized && topSpacerPx > 0 && (
									<li aria-hidden="true" style={{ height: topSpacerPx }} />
								)}
								{visibleTransactions.map((tx) => {
									const label = formatTransactionLabel(tx, merchants);
									const counterpart = tx.transferPairId ? counterpartAccounts[tx.id] : undefined;
									return (
										<TransactionCard
											key={tx.id}
											tx={tx}
											label={label}
											details={[
												tx.capture
													? `${tx.date} ${new Date(tx.capture.txnAt ?? tx.capture.receivedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
													: tx.date,
												counterpart
													? `${accountName(tx.accountId)} ${tx.amount < 0 ? 'to' : 'from'} ${accountName(counterpart)}`
													: accountName(tx.accountId),
												tx.type === 'transfer'
													? ''
													: (categoryLabels[tx.id] ?? '') || 'Uncategorized'
											]}
											linkKind={linkKinds.get(tx.id)}
											attachmentCount={attachmentCounts[tx.id] ?? 0}
											selected={selectedIds.has(tx.id)}
											onToggleSelected={() => toggleSelected(tx.id)}
											onAttachments={() => setAttachmentDialogTx(tx)}
											onEdit={() => setEditTx(tx)}
											onDelete={() => void remove(tx)}
										/>
									);
								})}
								{isVirtualized && bottomSpacerPx > 0 && (
									<li aria-hidden="true" style={{ height: bottomSpacerPx }} />
								)}
							</ul>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-8">{selectAll}</TableHead>
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
											<td colSpan={8} />
										</tr>
									)}
									{visibleTransactions.map((tx) => (
										<TableRow
											key={tx.id}
											style={isVirtualized ? { height: rowHeightPx } : undefined}
											data-state={selectedIds.has(tx.id) ? 'selected' : undefined}
										>
											<TableCell>
												<input
													type="checkbox"
													className="size-4 accent-primary"
													aria-label={`Select transaction ${formatTransactionLabel(tx, merchants)} on ${tx.date}`}
													checked={selectedIds.has(tx.id)}
													onChange={() => toggleSelected(tx.id)}
												/>
											</TableCell>
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
													<TxBadges tx={tx} linkKind={linkKinds.get(tx.id)} />
												</div>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{accountName(tx.accountId)}
												{tx.transferPairId && counterpartAccounts[tx.id] && (
													<span className="ml-1 text-xs whitespace-nowrap">
														{tx.amount < 0 ? 'to' : 'from'}{' '}
														{accountName(counterpartAccounts[tx.id])}
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
												<AttachmentButton
													count={attachmentCounts[tx.id] ?? 0}
													onClick={() => setAttachmentDialogTx(tx)}
												/>
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
											<td colSpan={8} />
										</tr>
									)}
								</TableBody>
							</Table>
						)}
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

			<Dialog open={bulkCategoryOpen} onOpenChange={setBulkCategoryOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Set category for {selectedIds.size}{' '}
							{selectedIds.size === 1 ? 'transaction' : 'transactions'}
						</DialogTitle>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<Label htmlFor="bulk-category">Category</Label>
						<CategoryPicker
							id="bulk-category"
							value={bulkCategoryId}
							onChange={setBulkCategoryId}
							categories={categories}
							noneOption={{ value: UNCATEGORIZED_CATEGORY_ID, label: 'Uncategorized' }}
						/>
						<p className="text-xs text-muted-foreground">
							Transfers and transactions already split across categories are left as they are.
						</p>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setBulkCategoryOpen(false)}>
							Cancel
						</Button>
						<Button disabled={bulkBusy} onClick={() => void bulkApplyCategory()}>
							Apply
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

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
/** The Transfer / purpose / Unreviewed chips an entry carries, shared by the table and the phone card. */
function TxBadges({
	tx,
	linkKind
}: {
	tx: Transaction;
	linkKind: TransactionLink['kind'] | undefined;
}) {
	return (
		<>
			{tx.type === 'transfer' && (
				<Badge variant="secondary" className="shrink-0">
					{tx.transferPairId
						? 'Transfer'
						: tx.source === 'balance_adjustment'
							? 'Adjustment'
							: movementLabel(linkKind)}
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
		</>
	);
}

function AttachmentButton({ count, onClick }: { count: number; onClick: () => void }) {
	return (
		<Button
			variant="ghost"
			size="icon"
			className="relative"
			aria-label="Attachments"
			onClick={onClick}
		>
			<Paperclip className="size-4" />
			{count > 0 && (
				<Badge
					variant="secondary"
					className="absolute -top-1 -right-1 size-4 justify-center rounded-full p-0 text-[10px]"
				>
					{count}
				</Badge>
			)}
		</Button>
	);
}

/** One entry on a phone: what the seven table columns say, in a fixed-height card. */
function TransactionCard({
	tx,
	label,
	details,
	linkKind,
	attachmentCount,
	selected,
	onToggleSelected,
	onAttachments,
	onEdit,
	onDelete
}: {
	tx: Transaction;
	label: string;
	/** Date, account and category, in the order shown; blanks are left out. */
	details: string[];
	linkKind: TransactionLink['kind'] | undefined;
	attachmentCount: number;
	selected: boolean;
	onToggleSelected: () => void;
	onAttachments: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<li
			className="flex items-start gap-1 overflow-hidden border-b px-2 py-2 data-[state=selected]:bg-muted/50"
			style={{ height: CARD_HEIGHT_PX }}
			data-state={selected ? 'selected' : undefined}
		>
			<label className="flex size-8 shrink-0 items-center justify-center">
				<input
					type="checkbox"
					className="size-4 accent-primary"
					aria-label={`Select transaction ${label} on ${tx.date}`}
					checked={selected}
					onChange={onToggleSelected}
				/>
			</label>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-baseline justify-between gap-2">
					<span className="truncate font-medium" title={label}>
						{label}
					</span>
					<span
						className={`shrink-0 font-mono text-sm ${tx.amount < 0 ? 'text-expense' : 'text-income'}`}
					>
						{formatMoney(tx.amount)}
					</span>
				</div>
				<p className="truncate text-xs text-muted-foreground">
					{details.filter(Boolean).join(' · ')}
				</p>
				<div className="flex items-center gap-1">
					<div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
						<TxBadges tx={tx} linkKind={linkKind} />
					</div>
					<AttachmentButton count={attachmentCount} onClick={onAttachments} />
					<Button variant="ghost" size="icon" aria-label="Edit transaction" onClick={onEdit}>
						<Pencil className="size-4" />
					</Button>
					<Button variant="ghost" size="icon" aria-label="Delete transaction" onClick={onDelete}>
						<Trash2 className="size-4" />
					</Button>
				</div>
			</div>
		</li>
	);
}

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
