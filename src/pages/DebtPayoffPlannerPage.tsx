import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Landmark } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useSession } from '../context/SessionContext';
import { LiabilityRepository } from '../data/dexie/wealthRepository';
import { DebtPlannerPreferenceRepository } from '../data/dexie/debtPlannerPreferenceRepository';
import {
	compareStrategies,
	generateDebtPayoffPlan,
	partitionEligibleLiabilities
} from '../domain/debtPlanner/generatePlan';
import type { DebtPayoffPlan, PayoffStrategy } from '../domain/debtPlanner/types';
import type { Liability } from '../domain/entities';
import { formatMinorUnits, parseMoneyToMinorUnits } from '../domain/shared/money';
import { toast } from 'sonner';

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

/** Whole months between `asOf` and `iso` (both truncated to first-of-month), or null. */
function monthsUntil(asOf: Date, iso: string | null): number | null {
	if (!iso) return null;
	const target = new Date(iso);
	return (
		(target.getUTCFullYear() - asOf.getUTCFullYear()) * 12 +
		(target.getUTCMonth() - asOf.getUTCMonth())
	);
}

/** Inline prompt for a liability missing the data a payoff plan needs (spec FR-008). */
function NeedsInputRow({
	liability,
	onSaved
}: {
	liability: Liability;
	onSaved: () => Promise<void>;
}) {
	const { getEncryptionKey } = useSession();
	const [interestRatePercent, setInterestRatePercent] = useState(
		liability.interestRate != null ? formatMinorUnits(liability.interestRate) : ''
	);
	const [minimumPayment, setMinimumPayment] = useState(
		liability.minimumPayment != null ? formatMinorUnits(liability.minimumPayment) : ''
	);
	const [saving, setSaving] = useState(false);

	async function save() {
		// An annual rate in basis points is the same 2-decimal-to-integer-hundredths scaling
		// as a money amount, and needs the same exactness — 18.55% must land on 1855, not 1854.
		const rateBasisPoints = parseMoneyToMinorUnits(interestRatePercent);
		const minimum = parseMoneyToMinorUnits(minimumPayment);
		if (rateBasisPoints === null || rateBasisPoints < 0 || minimum === null || minimum <= 0) return;

		setSaving(true);
		await LiabilityRepository.update(getEncryptionKey(), liability.id, {
			interestRate: rateBasisPoints,
			minimumPayment: minimum
		});
		setSaving(false);
		await onSaved();
	}

	return (
		<div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<p className="font-medium">{liability.name}</p>
				<p className="text-sm text-muted-foreground">
					Needs an interest rate and minimum payment before it can be included in a plan.
				</p>
			</div>
			<div className="flex flex-wrap items-end gap-2">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`rate-${liability.id}`}>APR %</Label>
					<Input
						id={`rate-${liability.id}`}
						type="number"
						step="0.01"
						className="w-24"
						value={interestRatePercent}
						onChange={(e) => setInterestRatePercent(e.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`min-${liability.id}`}>Min. payment</Label>
					<Input
						id={`min-${liability.id}`}
						type="number"
						step="0.01"
						className="w-28"
						value={minimumPayment}
						onChange={(e) => setMinimumPayment(e.target.value)}
					/>
				</div>
				<Button size="sm" disabled={saving} onClick={save}>
					Save
				</Button>
			</div>
		</div>
	);
}

// Feature 002: derived, read-only payoff planning on top of existing Liability records.
export function DebtPayoffPlannerPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [liabilities, setLiabilities] = useState<Liability[]>([]);
	const [loading, setLoading] = useState(true);
	const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche');
	// Smallest currency unit; mirrored into extraPaymentInput as a rupee-formatted string.
	const [extraMonthlyPayment, setExtraMonthlyPayment] = useState(0);
	const [extraPaymentInput, setExtraPaymentInput] = useState('0');
	const preferenceLoaded = useRef(false);

	async function refresh() {
		setLoading(true);
		try {
			setLiabilities(await LiabilityRepository.list(key));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load this page.');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void refresh();
		void (async () => {
			const pref = await DebtPlannerPreferenceRepository.get(key);
			setStrategy(pref.strategy);
			setExtraMonthlyPayment(pref.extraMonthlyPayment);
			setExtraPaymentInput(String(pref.extraMonthlyPayment / 100));
			preferenceLoaded.current = true;
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Persist strategy/extraMonthlyPayment (debounced) once the initial preference load has
	// completed, so this effect's own first run right after loading doesn't re-save it.
	useEffect(() => {
		if (!preferenceLoaded.current) return;
		const timeout = setTimeout(() => {
			void DebtPlannerPreferenceRepository.save(key, { strategy, extraMonthlyPayment });
		}, 300);
		return () => clearTimeout(timeout);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [strategy, extraMonthlyPayment]);

	function onExtraPaymentChange(value: string) {
		setExtraPaymentInput(value);
		const parsed = parseMoneyToMinorUnits(value);
		setExtraMonthlyPayment(parsed !== null && parsed >= 0 ? parsed : 0);
	}

	const { eligible, excludedLiabilityIds } = useMemo(
		() => partitionEligibleLiabilities(liabilities),
		[liabilities]
	);
	const excludedLiabilities = liabilities.filter((l) => excludedLiabilityIds.includes(l.id));

	const plan: DebtPayoffPlan | null = useMemo(() => {
		if (eligible.length === 0) return null;
		return generateDebtPayoffPlan({
			liabilities: eligible,
			strategy,
			extraMonthlyPayment,
			asOfDate: new Date()
		});
	}, [eligible, strategy, extraMonthlyPayment]);

	const comparison = useMemo(() => {
		if (eligible.length === 0) return null;
		return compareStrategies({ liabilities: eligible, extraMonthlyPayment, asOfDate: new Date() });
	}, [eligible, extraMonthlyPayment]);

	const liabilityById = new Map(liabilities.map((l) => [l.id, l]));

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center gap-2">
				<Landmark className="size-6 text-primary" />
				<h1 className="text-2xl font-semibold tracking-tight">Debt Payoff Planner</h1>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : liabilities.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<Landmark className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							Add a liability first to build a payoff plan.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-6">
					{excludedLiabilities.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-base">
									<AlertTriangle className="size-4 text-amber-500" />
									Needs input
								</CardTitle>
							</CardHeader>
							<CardContent className="flex flex-col gap-3">
								{excludedLiabilities.map((liability) => (
									<NeedsInputRow key={liability.id} liability={liability} onSaved={refresh} />
								))}
							</CardContent>
						</Card>
					)}

					{plan && (
						<>
							<div className="flex flex-wrap items-end justify-between gap-4">
								<Tabs value={strategy} onValueChange={(v) => setStrategy(v as PayoffStrategy)}>
									<TabsList>
										<TabsTrigger value="avalanche">Avalanche</TabsTrigger>
										<TabsTrigger value="snowball">Snowball</TabsTrigger>
									</TabsList>
								</Tabs>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="extra-payment">Extra monthly payment</Label>
									<Input
										id="extra-payment"
										type="number"
										step="0.01"
										min="0"
										className="w-36"
										value={extraPaymentInput}
										onChange={(e) => onExtraPaymentChange(e.target.value)}
									/>
								</div>
							</div>

							<Card>
								<CardHeader>
									<CardTitle className="text-base">Plan summary</CardTitle>
								</CardHeader>
								<CardContent className="flex gap-8">
									<div>
										<p className="text-sm text-muted-foreground">Debt-free by</p>
										<p className="text-xl font-semibold">
											{plan.payoffDate ? formatDate(plan.payoffDate) : 'Not reachable yet'}
										</p>
									</div>
									<div>
										<p className="text-sm text-muted-foreground">Total interest</p>
										<p className="text-xl font-semibold">{formatMoney(plan.totalInterest)}</p>
									</div>
								</CardContent>
							</Card>

							{comparison && (
								<Card>
									<CardHeader>
										<CardTitle className="text-base">Avalanche vs. snowball</CardTitle>
									</CardHeader>
									<CardContent className="grid grid-cols-2 gap-6">
										{(['avalanche', 'snowball'] as const).map((s) => {
											const p = comparison[s];
											const months = monthsUntil(new Date(), p.payoffDate);
											return (
												<div key={s} className="flex flex-col gap-1">
													<p className="text-sm font-medium capitalize">{s}</p>
													<p className="text-sm text-muted-foreground">
														{months !== null
															? `${months} month${months === 1 ? '' : 's'} to debt-free`
															: 'Not reachable yet'}
													</p>
													<p className="text-sm text-muted-foreground">
														{formatMoney(p.totalInterest)} total interest
													</p>
												</div>
											);
										})}
									</CardContent>
								</Card>
							)}

							<div className="flex flex-col gap-3">
								{plan.entries.map((entry) => {
									const liability = liabilityById.get(entry.liabilityId);
									if (!liability) return null;
									return (
										<Card key={entry.liabilityId}>
											<CardHeader className="flex items-start justify-between space-y-0 pb-2">
												<CardTitle className="text-base">{liability.name}</CardTitle>
												<Badge variant="secondary">#{entry.priorityOrder}</Badge>
											</CardHeader>
											<CardContent className="flex flex-wrap gap-6">
												<div>
													<p className="text-sm text-muted-foreground">Balance</p>
													<p className="font-mono font-semibold">
														{formatMoney(liability.outstandingBalance)}
													</p>
												</div>
												<div>
													<p className="text-sm text-muted-foreground">Payoff date</p>
													<p className="font-semibold">
														{entry.nonConverging || !entry.payoffDate
															? 'Not reachable yet'
															: formatDate(entry.payoffDate)}
													</p>
												</div>
												<div>
													<p className="text-sm text-muted-foreground">Interest</p>
													<p className="font-semibold">{formatMoney(entry.totalInterest)}</p>
												</div>
											</CardContent>
											{entry.nonConverging && (
												<CardContent className="pt-0">
													<p className="flex items-center gap-1.5 text-sm text-amber-600">
														<AlertTriangle className="size-4" />
														This debt's minimum payment doesn't cover its accruing interest —
														increase the minimum payment or add extra funds.
													</p>
												</CardContent>
											)}
										</Card>
									);
								})}
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
}
