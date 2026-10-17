import { useEffect, useState } from 'react';
import { TrendingDown } from 'lucide-react';
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
import { ChartCanvas } from '../components/ChartCanvas';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import { projectAccountBalance } from '../domain/forecast/forecastEngine';
import type { BalanceForecast, ForecastHorizonDays } from '../domain/forecast/types';
import type { Account } from '../domain/entities';
import { isValidMoney, parseMoneyOrZero, formatMoney } from '../domain/shared/money';
import { getPrimaryColor, withAlpha, getAxisColor, getGridColor } from '../lib/chartColors';
import { isoDateToLocalDate } from '../domain/shared/dateMath';

const HORIZON_OPTIONS: ForecastHorizonDays[] = [30, 60, 90];

function formatDate(iso: string): string {
	return isoDateToLocalDate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// User Story 2 (P1, spec 019): projects an account's balance forward and warns before a
// projected low/negative balance, rather than only showing the balance as of today. See
// contracts/cashflow-forecast.md.
export function CashFlowForecastPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [accountId, setAccountId] = useState('');
	const [horizonDays, setHorizonDays] = useState<ForecastHorizonDays>(30);
	const [forecast, setForecast] = useState<BalanceForecast | null>(null);
	const [thresholdInput, setThresholdInput] = useState('0');
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void (async () => {
			const list = await AccountRepository.list(key, false);
			setAccounts(list);
			if (list.length > 0) setAccountId((prev) => prev || list[0].id);
			setLoading(false);
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function refreshForecast() {
		if (!accountId) return;
		const account = accounts.find((a) => a.id === accountId);
		if (account) setThresholdInput(String((account.lowBalanceThresholdMinor ?? 0) / 100));
		const result = await projectAccountBalance(key, accountId, horizonDays);
		setForecast(result);
	}

	useEffect(() => {
		void refreshForecast();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [accountId, horizonDays, accounts]);

	async function saveThreshold() {
		if (!accountId || !isValidMoney(thresholdInput || '0')) return;
		try {
			await AccountRepository.update(key, accountId, {
				lowBalanceThresholdMinor: parseMoneyOrZero(thresholdInput || '0')
			});
			const updated = await AccountRepository.list(key, false);
			setAccounts(updated);
			toast.success('Low-balance threshold saved');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save threshold.');
		}
	}

	const primaryColor = getPrimaryColor();
	const selectedAccount = accounts.find((a) => a.id === accountId);
	// A card's balance is what is owed (negative), so it is forecast and drawn as an amount owed, and
	// warned about against its credit limit rather than a low-balance threshold.
	const isCard = selectedAccount?.type === 'credit_card';

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center gap-2">
				<TrendingDown className="size-6 text-primary" />
				<h1 className="text-2xl font-semibold tracking-tight">Cash-Flow Forecast</h1>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : accounts.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="py-10 text-center text-sm text-muted-foreground">
						Add an account first to see its forecast.
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-4">
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="forecast-account">Account</Label>
							<Select value={accountId} onValueChange={setAccountId}>
								<SelectTrigger id="forecast-account" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{accounts.map((a) => (
										<SelectItem key={a.id} value={a.id}>
											{a.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="forecast-horizon">Horizon</Label>
							<Select
								value={String(horizonDays)}
								onValueChange={(v) => setHorizonDays(Number(v) as ForecastHorizonDays)}
							>
								<SelectTrigger id="forecast-horizon" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{HORIZON_OPTIONS.map((h) => (
										<SelectItem key={h} value={String(h)}>
											{h} days
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{isCard && selectedAccount && (
						<Card className="border-dashed">
							<CardContent className="py-4 text-sm text-muted-foreground">
								{selectedAccount.name} is a credit card, so this shows how much you would{' '}
								<strong>owe</strong> — based on your card spending and payments over the last 90
								days.{' '}
								{selectedAccount.creditLimit
									? `You'll be warned if it would pass your ${formatMoney(selectedAccount.creditLimit)} credit limit.`
									: 'Set a credit limit on the Accounts page to get a warning before you would pass it.'}
							</CardContent>
						</Card>
					)}

					{!isCard && (
						<Card>
							<CardContent className="flex flex-col gap-2 pt-6 sm:flex-row sm:items-end sm:justify-between">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="forecast-threshold">Low-balance threshold</Label>
									<Input
										id="forecast-threshold"
										type="number"
										step="0.01"
										className="w-40"
										value={thresholdInput}
										onChange={(e) => setThresholdInput(e.target.value)}
									/>
								</div>
								<Button variant="outline" onClick={saveThreshold}>
									Save threshold
								</Button>
							</CardContent>
						</Card>
					)}

					{forecast && (
						<>
							{forecast.confidence === 'low' && (
								<Card className="border-dashed">
									<CardContent className="py-4 text-sm text-muted-foreground">
										Not enough recurring or historical data yet for a confident projection — this
										trajectory is a rough estimate.
									</CardContent>
								</Card>
							)}

							{forecast.warning && (
								<Card className="border-destructive">
									<CardContent className="flex items-center gap-2 py-4 text-sm">
										<Badge variant="destructive">
											{forecast.warning.kind === 'over-limit'
												? 'Credit limit warning'
												: 'Low balance warning'}
										</Badge>
										<span>
											{forecast.warning.kind === 'over-limit'
												? `Projected to go ${formatMoney(forecast.warning.shortfallAmountMinor)} over your credit limit by ${formatDate(forecast.warning.date)}.`
												: `Projected to fall ${formatMoney(forecast.warning.shortfallAmountMinor)} below your threshold by ${formatDate(forecast.warning.date)}.`}
										</span>
									</CardContent>
								</Card>
							)}

							<Card>
								<CardContent className="pt-6">
									<ChartCanvas
										label={`${isCard ? 'Projected amount owed' : 'Projected balance'} for the next ${horizonDays} days`}
										config={{
											type: 'line',
											data: {
												labels: forecast.points.map((p) => formatDate(p.date)),
												datasets: [
													{
														label: isCard ? 'Projected amount owed' : 'Projected balance',
														data: forecast.points.map(
															(p) =>
																(isCard ? -p.projectedBalanceMinor : p.projectedBalanceMinor) / 100
														),
														borderColor: primaryColor,
														backgroundColor: withAlpha(primaryColor, 0.15),
														fill: true,
														tension: 0.25,
														pointRadius: 0
													}
												]
											},
											options: {
												responsive: true,
												maintainAspectRatio: false,
												scales: {
													x: { ticks: { color: getAxisColor() }, grid: { color: getGridColor() } },
													y: { ticks: { color: getAxisColor() }, grid: { color: getGridColor() } }
												},
												plugins: { legend: { display: false } }
											}
										}}
									/>
								</CardContent>
							</Card>
						</>
					)}
				</div>
			)}
		</div>
	);
}
