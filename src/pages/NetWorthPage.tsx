import { useEffect, useState } from 'react';
import { Camera, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Sparkline } from '../components/Sparkline';
import { useSession } from '../context/SessionContext';
import {
	computeNetWorth,
	netWorthHistory,
	recordNetWorthSnapshot,
	type NetWorthBreakdown
} from '../domain/wealth/wealthEngine';
import type { NetWorthSnapshot } from '../domain/entities';

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

// User Story 7 (P7): net worth = assets - liabilities, with a recorded history (FR-034).
export function NetWorthPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [breakdown, setBreakdown] = useState<NetWorthBreakdown | null>(null);
	const [history, setHistory] = useState<NetWorthSnapshot[]>([]);

	async function refresh() {
		setBreakdown(await computeNetWorth(key));
		setHistory(await netWorthHistory(key));
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function handleSnapshot() {
		await recordNetWorthSnapshot(key);
		toast.success('Snapshot recorded');
		await refresh();
	}

	if (!breakdown) return <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">Loading…</div>;

	return (
		<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Net Worth</h1>
				<Button variant="outline" onClick={handleSnapshot}>
					<Camera /> Record snapshot
				</Button>
			</div>

			<Card className="mb-6">
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						Total Net Worth
					</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="font-mono text-3xl font-semibold">{formatMoney(breakdown.netWorth)}</p>
					{history.length > 1 && <Sparkline values={history.map((s) => s.netWorth)} />}
					<dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
						<dt className="text-muted-foreground">Cash</dt>
						<dd className="text-right font-mono">{formatMoney(breakdown.cashBalance)}</dd>
						<dt className="text-muted-foreground">Investments</dt>
						<dd className="text-right font-mono">{formatMoney(breakdown.investmentValue)}</dd>
						<dt className="text-muted-foreground">Liabilities</dt>
						<dd className="text-right font-mono text-destructive">
							-{formatMoney(breakdown.totalLiabilities)}
						</dd>
					</dl>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">History</CardTitle>
				</CardHeader>
				<CardContent>
					{history.length === 0 ? (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<TrendingUp className="size-4" /> No snapshots recorded yet.
						</p>
					) : (
						<ul className="flex flex-col gap-2">
							{history
								.slice()
								.reverse()
								.map((snapshot) => (
									<li key={snapshot.id} className="flex justify-between text-sm">
										<span className="text-muted-foreground">{snapshot.date}</span>
										<span className="font-mono">{formatMoney(snapshot.netWorth)}</span>
									</li>
								))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
