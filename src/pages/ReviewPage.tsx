import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Inbox, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import { MerchantRepository } from '../data/dexie/merchantRepository';
import { TransactionRepository } from '../data/dexie/transactionRepository';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import type { Account, Merchant, Transaction } from '../domain/entities';

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

// User Story 4 (P4): review queue for unreviewed/unconfirmed transactions from Quick Add
// and bulk import (FR-022) — nothing lands in reports until the user accepts it here.
export function ReviewPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [merchants, setMerchants] = useState<Merchant[]>([]);
	const [items, setItems] = useState<Transaction[]>([]);
	const [loading, setLoading] = useState(true);

	async function refresh() {
		setLoading(true);
		const [accts, allMerchants, unreviewed] = await Promise.all([
			AccountRepository.list(key),
			MerchantRepository.list(key),
			TransactionRepository.listUnreviewed(key)
		]);
		setAccounts(accts);
		setMerchants(allMerchants);
		setItems(unreviewed);
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function accountName(id: string): string {
		return accounts.find((a) => a.id === id)?.name ?? id;
	}

	function transactionLabel(tx: Transaction): string {
		if (tx.notes) return tx.notes;
		const merchant = tx.merchantId ? merchants.find((m) => m.id === tx.merchantId) : undefined;
		return merchant?.name ?? 'Unlabeled transaction';
	}

	async function accept(tx: Transaction) {
		await TransactionRepository.update(key, tx.id, { reviewStatus: 'confirmed' });
		toast.success('Confirmed');
		await refresh();
	}

	async function reject(tx: Transaction) {
		await TransactionEngine.deleteTransaction(key, tx.id);
		toast.success('Discarded');
		await refresh();
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
							<CardContent className="flex items-center justify-between pt-6">
								<div>
									<p className="text-sm font-medium">
										{transactionLabel(tx)}
										{tx.duplicateOfId && (
											<Badge variant="outline" className="ml-2">
												Possible duplicate
											</Badge>
										)}
									</p>
									<p className="text-xs text-muted-foreground">
										{tx.date} · {accountName(tx.accountId)}
									</p>
								</div>
								<div className="flex items-center gap-3">
									<span
										className={`font-mono text-sm ${tx.amount < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}
									>
										{formatMoney(tx.amount)}
									</span>
									<Button
										size="icon-sm"
										variant="ghost"
										aria-label="Confirm transaction"
										onClick={() => accept(tx)}
									>
										<CheckCircle2 className="text-emerald-600 dark:text-emerald-400" />
									</Button>
									<Button
										size="icon-sm"
										variant="ghost"
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
		</div>
	);
}
