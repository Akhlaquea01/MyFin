import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
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
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import type { Account, Transaction } from '../domain/entities';

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
	const [loading, setLoading] = useState(true);
	const [scrollTop, setScrollTop] = useState(0);
	const scrollerRef = useRef<HTMLDivElement>(null);

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

	async function refresh() {
		setLoading(true);
		setAccounts(await AccountRepository.list(key));
		setTransactions(
			await TransactionRepository.search(key, {
				accountId: accountFilter || undefined,
				dateFrom: dateFrom || undefined,
				dateTo: dateTo || undefined,
				freeText: freeText || undefined
			})
		);
		setScrollTop(0);
		if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
					<div className="flex flex-1 flex-col gap-1.5">
						<Label htmlFor="tx-filter-search" className="text-xs text-muted-foreground">
							Search notes
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
									<TableHead className="w-16" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{isVirtualized && topSpacerPx > 0 && (
									<tr style={{ height: topSpacerPx }} aria-hidden="true">
										<td colSpan={5} />
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
											<Button variant="ghost" size="sm" onClick={() => remove(tx)}>
												Delete
											</Button>
										</TableCell>
									</TableRow>
								))}
								{isVirtualized && bottomSpacerPx > 0 && (
									<tr style={{ height: bottomSpacerPx }} aria-hidden="true">
										<td colSpan={5} />
									</tr>
								)}
							</TableBody>
						</Table>
					</div>
				</Card>
			)}
		</div>
	);
}
