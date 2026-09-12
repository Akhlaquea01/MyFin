import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Check, Paperclip, Plus, Search, Tag as TagIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
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
import { TransactionRepository } from '../data/dexie/transactionRepository';
import { AttachmentRepository } from '../data/dexie/attachmentRepository';
import { TagRepository } from '../data/dexie/tagRepository';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import { filterTagOptions, type TagOption } from '../domain/transactions/tagFilterEngine';
import { validateAttachmentFile, compressImage } from '../lib/imageAttachment';
import type { Account, Attachment, Transaction } from '../domain/entities';

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

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

// User Story 2 (P2): search/filter (FR-013) and soft-delete (FR-014) of transactions.
export function TransactionsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [transactions, setTransactions] = useState<Transaction[]>([]);
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
			setTags(await TagRepository.listInUse(key));
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

	function refreshAttachmentCounts() {
		const ids = visibleTransactions.map((t) => t.id);
		void AttachmentRepository.countsForTransactions(key, ids)
			.then((counts) => setAttachmentCounts((prev) => mergeCounts(prev, ids, counts)))
			.catch(() => {});
	}

	async function remove(tx: Transaction) {
		await TransactionEngine.deleteTransaction(key, tx.id);
		toast.success('Transaction moved to trash');
		await refresh();
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
					<CardContent className="py-10 text-center text-sm text-muted-foreground">
						No transactions match.
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
									<TableHead className="text-right">Amount</TableHead>
									<TableHead className="w-12" />
									<TableHead className="w-16" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{isVirtualized && topSpacerPx > 0 && (
									<tr style={{ height: topSpacerPx }} aria-hidden="true">
										<td colSpan={6} />
									</tr>
								)}
								{visibleTransactions.map((tx) => (
									<TableRow
										key={tx.id}
										style={isVirtualized ? { height: ROW_HEIGHT_PX } : undefined}
									>
										<TableCell className="text-muted-foreground">{tx.date}</TableCell>
										<TableCell>
											{tx.notes || (tx.type === 'transfer' ? 'Transfer' : tx.type)}
											{tx.reviewStatus === 'unreviewed' && (
												<Badge variant="outline" className="ml-2">
													Unreviewed
												</Badge>
											)}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{accountName(tx.accountId)}
										</TableCell>
										<TableCell
											className={`text-right font-mono ${tx.amount < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}
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
											<Button variant="ghost" size="sm" onClick={() => remove(tx)}>
												Delete
											</Button>
										</TableCell>
									</TableRow>
								))}
								{isVirtualized && bottomSpacerPx > 0 && (
									<tr style={{ height: bottomSpacerPx }} aria-hidden="true">
										<td colSpan={6} />
									</tr>
								)}
							</TableBody>
						</Table>
					</div>
				</Card>
			)}

			{attachmentDialogTx && (
				<AttachmentsDialog
					transaction={attachmentDialogTx}
					onOpenChange={(open) => !open && setAttachmentDialogTx(null)}
					onChanged={() => void refreshAttachmentCounts()}
				/>
			)}
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
		await AttachmentRepository.remove(key, attachment.id);
		await refreshAttachments();
		onChanged();
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
