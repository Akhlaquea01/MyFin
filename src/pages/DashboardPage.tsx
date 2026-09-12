import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Wallet, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Sparkline } from '../components/Sparkline';
import { useSession } from '../context/SessionContext';
import { getDashboardSummary, type DashboardSummary } from '../domain/analytics/dashboardService';
import { PersonLoanRepository, LoanRepaymentRepository } from '../data/dexie/personLoanRepository';
import { computePendingBalance, computeOpenLoanTotals } from '../domain/personLoans/loanProgress';
import type { OpenLoanTotals } from '../domain/personLoans/types';

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

/** Feature 010, User Story 3 (FR-010): "you're owed / you owe" totals across all open loans. */
async function getLendingSummary(key: CryptoKey): Promise<OpenLoanTotals> {
	const loans = await PersonLoanRepository.listAllOpen(key);
	const withBalances = await Promise.all(
		loans.map(async (loan) => {
			const repayments = await LoanRepaymentRepository.listForLoan(key, loan.id);
			return {
				direction: loan.direction,
				pendingBalance: computePendingBalance({
					principalAmount: loan.principalAmount,
					writeOffAmount: loan.writeOffAmount,
					repayments
				})
			};
		})
	);
	return computeOpenLoanTotals({ loans: withBalances });
}

// User Story 3 (P3): at-a-glance summary reconciled exactly with the ledger (FR-016/017).
export function DashboardPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [summary, setSummary] = useState<DashboardSummary | null>(null);
	const [lending, setLending] = useState<OpenLoanTotals | null>(null);

	useEffect(() => {
		void getDashboardSummary(key).then(setSummary);
		void getLendingSummary(key).then(setLending);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	if (!summary) {
		return <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">Loading…</div>;
	}

	return (
		<div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Dashboard</h1>

			<div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Total Balance
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="font-mono text-2xl font-semibold">{formatMoney(summary.totalBalance)}</p>
						{summary.balanceTrend.length > 1 && <Sparkline values={summary.balanceTrend} />}
					</CardContent>
				</Card>
				<Link to="/people">
					<Card className="h-full transition-colors hover:bg-muted/50">
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">Lending</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-1">
							<p className="text-sm">
								You're owed{' '}
								<span className="font-mono font-semibold">
									{formatMoney(lending?.totalLent ?? 0)}
								</span>
							</p>
							<p className="text-sm">
								You owe{' '}
								<span className="font-mono font-semibold">
									{formatMoney(lending?.totalBorrowed ?? 0)}
								</span>
							</p>
						</CardContent>
					</Card>
				</Link>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
							<TrendingUp className="size-3.5 text-primary" /> Net Worth
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="font-mono text-2xl font-semibold">{formatMoney(summary.netWorth)}</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Cash only for now — investments/liabilities factor in once tracked.
						</p>
					</CardContent>
				</Card>
				<Link to="/transactions">
					<Card className="h-full transition-colors hover:bg-muted/50">
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">
								Unreviewed
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-2xl font-semibold">{summary.unreviewedCount}</p>
							<p className="mt-1 text-xs text-muted-foreground">Transactions awaiting review</p>
						</CardContent>
					</Card>
				</Link>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">Recent Transactions</CardTitle>
				</CardHeader>
				<CardContent>
					{summary.recentTransactions.length === 0 ? (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<Wallet className="size-4" /> No transactions yet.
						</p>
					) : (
						<ul className="flex flex-col gap-3">
							{summary.recentTransactions.map((tx) => (
								<li key={tx.id} className="flex items-center justify-between text-sm">
									<div className="flex items-center gap-2">
										{tx.amount < 0 ? (
											<ArrowUpRight className="size-4 text-destructive" />
										) : (
											<ArrowDownLeft className="size-4 text-emerald-600 dark:text-emerald-400" />
										)}
										<span>{tx.notes || (tx.type === 'transfer' ? 'Transfer' : tx.type)}</span>
										{tx.reviewStatus === 'unreviewed' && (
											<Badge variant="outline">Unreviewed</Badge>
										)}
									</div>
									<div className="flex items-center gap-3 text-muted-foreground">
										<span>{tx.date}</span>
										<span
											className={`font-mono ${tx.amount < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}
										>
											{formatMoney(tx.amount)}
										</span>
									</div>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
