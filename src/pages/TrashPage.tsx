import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import {
	db,
	type AccountRow,
	type SavingsGoalRow,
	type TransactionRow,
	type CategorizationRuleRow
} from '../data/dexie/db';
import { decryptRows } from '../data/dexie/encryptedTable';
import { NOT_DELETED } from '../data/dexie/indexable';
import { AccountRepository } from '../data/dexie/accountRepository';
import { SavingsGoalRepository } from '../data/dexie/savingsGoalRepository';
import { TransactionRepository } from '../data/dexie/transactionRepository';
import { CategorizationRuleRepository } from '../data/dexie/categorizationRuleRepository';
import { MerchantRepository } from '../data/dexie/merchantRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import { useSession } from '../context/SessionContext';
import type {
	Account,
	CategorizationRule,
	Category,
	Merchant,
	SavingsGoal,
	Transaction
} from '../domain/entities';

// User Story 2 (P2): trash/undo for soft-deleted records (FR-014, Constitution Principle VI).
export function TrashPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [deletedAccounts, setDeletedAccounts] = useState<Account[]>([]);
	const [deletedTransactions, setDeletedTransactions] = useState<Transaction[]>([]);
	const [deletedGoals, setDeletedGoals] = useState<SavingsGoal[]>([]);
	const [deletedRules, setDeletedRules] = useState<CategorizationRule[]>([]);
	const [merchants, setMerchants] = useState<Merchant[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [loading, setLoading] = useState(true);

	async function refresh() {
		setLoading(true);
		const [accountRows, transactionRows, goalRows, ruleRows, allMerchants, allCategories] =
			await Promise.all([
				db.accounts.filter((r) => r.deletedAt !== NOT_DELETED).toArray(),
				db.transactions.filter((r) => r.deletedAt !== NOT_DELETED).toArray(),
				db.savingsGoals.filter((r) => r.deletedAt !== NOT_DELETED).toArray(),
				db.categorizationRules.filter((r) => r.deletedAt !== NOT_DELETED).toArray(),
				MerchantRepository.list(key),
				CategoryRepository.list(key)
			]);
		setDeletedAccounts(await decryptRows<AccountRow, Account>(key, accountRows));
		setDeletedTransactions(await decryptRows<TransactionRow, Transaction>(key, transactionRows));
		setDeletedGoals(await decryptRows<SavingsGoalRow, SavingsGoal>(key, goalRows));
		setDeletedRules(
			await decryptRows<CategorizationRuleRow, CategorizationRule>(key, ruleRows)
		);
		setMerchants(allMerchants);
		setCategories(allCategories);
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

	// Constitution Principle VI: permanent purge requires explicit, separate user
	// confirmation — this is the first such flow in the app (spec 005, research.md §5).
	async function purgeTransaction(tx: Transaction) {
		const confirmed = window.confirm(
			'Permanently delete this transaction and any attached receipts? This cannot be undone.'
		);
		if (!confirmed) return;
		await TransactionRepository.purge(key, tx.id);
		toast.success('Transaction permanently deleted');
		await refresh();
	}

	async function restoreGoal(goal: SavingsGoal) {
		await SavingsGoalRepository.restore(key, goal.id);
		await refresh();
	}

	async function restoreRule(rule: CategorizationRule) {
		await CategorizationRuleRepository.restore(key, rule.id);
		await refresh();
	}

	function merchantName(id: string): string {
		return merchants.find((m) => m.id === id)?.name ?? id;
	}
	function categoryName(id: string): string {
		return categories.find((c) => c.id === id)?.name ?? id;
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
										<div className="flex items-center gap-3">
											<Button variant="link" size="sm" onClick={() => restoreTransaction(tx)}>
												Restore
											</Button>
											<Button
												variant="link"
												size="sm"
												className="text-destructive"
												onClick={() => void purgeTransaction(tx)}
											>
												Delete forever
											</Button>
										</div>
									</div>
								))}
							</div>
						)}
					</section>

					<section>
						<h2 className="mb-2 text-sm font-medium text-muted-foreground">Savings Goals</h2>
						{deletedGoals.length === 0 ? (
							<EmptyTrashCard />
						) : (
							<div className="flex flex-col gap-2">
								{deletedGoals.map((goal) => (
									<div
										key={goal.id}
										className="flex items-center justify-between rounded-lg border px-4 py-2"
									>
										<span className="text-sm">{goal.name}</span>
										<Button variant="link" size="sm" onClick={() => restoreGoal(goal)}>
											Restore
										</Button>
									</div>
								))}
							</div>
						)}
					</section>

					<section>
						<h2 className="mb-2 text-sm font-medium text-muted-foreground">
							Categorization Rules
						</h2>
						{deletedRules.length === 0 ? (
							<EmptyTrashCard />
						) : (
							<div className="flex flex-col gap-2">
								{deletedRules.map((rule) => (
									<div
										key={rule.id}
										className="flex items-center justify-between rounded-lg border px-4 py-2"
									>
										<span className="text-sm">
											{merchantName(rule.merchantId)} → {categoryName(rule.categoryId)}
										</span>
										<Button variant="link" size="sm" onClick={() => restoreRule(rule)}>
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
