import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { db, type AccountRow, type TransactionRow } from '../data/dexie/db';
import { decryptRows } from '../data/dexie/encryptedTable';
import { NOT_DELETED } from '../data/dexie/indexable';
import { AccountRepository } from '../data/dexie/accountRepository';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import { useSession } from '../context/SessionContext';
import type { Account, Transaction } from '../domain/entities';

// User Story 2 (P2): trash/undo for soft-deleted records (FR-014, Constitution Principle VI).
export function TrashPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [deletedAccounts, setDeletedAccounts] = useState<Account[]>([]);
	const [deletedTransactions, setDeletedTransactions] = useState<Transaction[]>([]);
	const [loading, setLoading] = useState(true);

	async function refresh() {
		setLoading(true);
		const [accountRows, transactionRows] = await Promise.all([
			db.accounts.filter((r) => r.deletedAt !== NOT_DELETED).toArray(),
			db.transactions.filter((r) => r.deletedAt !== NOT_DELETED).toArray()
		]);
		setDeletedAccounts(await decryptRows<AccountRow, Account>(key, accountRows));
		setDeletedTransactions(await decryptRows<TransactionRow, Transaction>(key, transactionRows));
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function restoreAccount(account: Account) {
		await AccountRepository.restore(key, account.id);
		await refresh();
	}

	async function restoreTransaction(tx: Transaction) {
		await TransactionEngine.restoreTransaction(key, tx.id);
		await refresh();
	}

	return (
		<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Trash</h1>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : (
				<div className="flex flex-col gap-8">
					<section>
						<h2 className="mb-2 text-sm font-medium text-muted-foreground">Accounts</h2>
						{deletedAccounts.length === 0 ? (
							<EmptyTrashCard />
						) : (
							<div className="flex flex-col gap-2">
								{deletedAccounts.map((account) => (
									<div
										key={account.id}
										className="flex items-center justify-between rounded-lg border px-4 py-2"
									>
										<span className="text-sm">{account.name}</span>
										<Button variant="link" size="sm" onClick={() => restoreAccount(account)}>
											Restore
										</Button>
									</div>
								))}
							</div>
						)}
					</section>

					<section>
						<h2 className="mb-2 text-sm font-medium text-muted-foreground">Transactions</h2>
						{deletedTransactions.length === 0 ? (
							<EmptyTrashCard />
						) : (
							<div className="flex flex-col gap-2">
								{deletedTransactions.map((tx) => (
									<div
										key={tx.id}
										className="flex items-center justify-between rounded-lg border px-4 py-2"
									>
										<span className="text-sm">
											{tx.date} · {tx.notes || tx.type}
										</span>
										<Button variant="link" size="sm" onClick={() => restoreTransaction(tx)}>
											Restore
										</Button>
									</div>
								))}
							</div>
						)}
					</section>
				</div>
			)}
		</div>
	);
}

function EmptyTrashCard() {
	return (
		<Card className="border-dashed">
			<CardContent className="flex flex-col items-center gap-2 py-6 text-center">
				<Trash2 className="size-5 text-muted-foreground" />
				<p className="text-sm text-muted-foreground">Nothing here.</p>
			</CardContent>
		</Card>
	);
}
