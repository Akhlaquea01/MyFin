import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LineChart, Minus, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '../components/ui/dialog';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { useSession } from '../context/SessionContext';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository
} from '../data/dexie/wealthRepository';
import { computePortfolioSummary, recordPurchase, recordSale } from '../domain/wealth/wealthEngine';
import type { InvestmentHolding, InvestmentType } from '../domain/entities';
import { isNonNegativeMoney, isPositiveMoney, parseMoneyOrZero } from '../domain/shared/money';

const TYPE_LABELS: Record<InvestmentType, string> = {
	stock: 'Stock',
	mutual_fund: 'Mutual Fund',
	etf: 'ETF',
	bond: 'Bond',
	fixed_deposit: 'Fixed Deposit',
	crypto: 'Crypto',
	other: 'Other'
};

function isPositiveUnits(raw: string): boolean {
	const n = Number(raw);
	return Number.isFinite(n) && n > 0;
}

function parseUnits(raw: string): number {
	const n = Number(raw);
	return Number.isFinite(n) ? n : 0;
}

const holdingSchema = z.object({
	name: z.string().trim().min(1, 'Name is required.'),
	type: z.enum(['stock', 'mutual_fund', 'etf', 'bond', 'fixed_deposit', 'crypto', 'other']),
	units: z.string().refine(isPositiveUnits, 'Enter a positive number of units.'),
	avgPrice: z.string().refine((v) => isPositiveMoney(v), 'Enter a positive price per unit.')
});
type HoldingFormValues = z.infer<typeof holdingSchema>;

const valuationSchema = z.object({
	value: z.string().refine((v) => isNonNegativeMoney(v || '0'), 'Enter a valid amount.')
});
type ValuationFormValues = z.infer<typeof valuationSchema>;

const purchaseSchema = z.object({
	units: z.string().refine(isPositiveUnits, 'Enter a positive number of units.'),
	price: z.string().refine((v) => isPositiveMoney(v), 'Enter a positive price per unit.')
});
type PurchaseFormValues = z.infer<typeof purchaseSchema>;

const saleSchema = z.object({
	units: z.string().refine(isPositiveUnits, 'Enter a positive number of units.')
});
type SaleFormValues = z.infer<typeof saleSchema>;

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

function formatUnits(units: number): string {
	return units.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatPercent(percent: number | null): string {
	if (percent === null) return '—';
	return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

// User Story 7 (P7): investment holdings with periodic valuations (FR-032).
// Spec 016 adds a fixed Type dropdown plus units/average-price tracking with weighted-average
// recalculation on additional purchases and a validated sale/decrease path (FR-015-FR-021).
export function InvestmentsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [holdings, setHoldings] = useState<InvestmentHolding[]>([]);
	const [valuesWithSource, setValuesWithSource] = useState<
		Record<string, { value: number; isEstimate: boolean }>
	>({});
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [valuationTarget, setValuationTarget] = useState<InvestmentHolding | null>(null);
	const [purchaseTarget, setPurchaseTarget] = useState<InvestmentHolding | null>(null);
	const [saleTarget, setSaleTarget] = useState<InvestmentHolding | null>(null);

	const holdingForm = useForm<HoldingFormValues>({
		resolver: zodResolver(holdingSchema),
		defaultValues: { name: '', type: 'stock', units: '', avgPrice: '' }
	});
	const valuationForm = useForm<ValuationFormValues>({
		resolver: zodResolver(valuationSchema),
		defaultValues: { value: '0' }
	});
	const purchaseForm = useForm<PurchaseFormValues>({
		resolver: zodResolver(purchaseSchema),
		defaultValues: { units: '', price: '' }
	});
	const saleForm = useForm<SaleFormValues>({
		resolver: zodResolver(saleSchema),
		defaultValues: { units: '' }
	});

	async function refresh() {
		setLoading(true);
		try {
			const list = await InvestmentHoldingRepository.list(key);
			setHoldings(list);
			const values = await Promise.all(
				list.map((h) => InvestmentValuationRepository.latestValueWithSource(key, h))
			);
			setValuesWithSource(Object.fromEntries(list.map((h, i) => [h.id, values[i]])));
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

	async function onAddHolding(values: HoldingFormValues) {
		try {
			const units = parseUnits(values.units);
			const avgPrice = parseMoneyOrZero(values.avgPrice);
			await InvestmentHoldingRepository.create(key, {
				name: values.name,
				type: values.type,
				costBasis: Math.round(units * avgPrice),
				units,
				avgPrice
			});
			holdingForm.reset({ name: '', type: 'stock', units: '', avgPrice: '' });
			setDialogOpen(false);
			toast.success('Holding added');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not add holding.');
		}
	}

	async function onAddValuation(values: ValuationFormValues) {
		if (!valuationTarget) return;
		try {
			await InvestmentValuationRepository.create(key, {
				holdingId: valuationTarget.id,
				date: new Date().toISOString().slice(0, 10),
				value: parseMoneyOrZero(values.value)
			});
			valuationForm.reset();
			setValuationTarget(null);
			toast.success('Valuation recorded');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not record valuation.');
		}
	}

	async function onPurchase(values: PurchaseFormValues) {
		if (!purchaseTarget) return;
		try {
			await recordPurchase(key, purchaseTarget.id, {
				units: parseUnits(values.units),
				price: parseMoneyOrZero(values.price)
			});
			purchaseForm.reset({ units: '', price: '' });
			setPurchaseTarget(null);
			toast.success('Purchase recorded');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not record purchase.');
		}
	}

	async function onSale(values: SaleFormValues) {
		if (!saleTarget) return;
		try {
			await recordSale(key, saleTarget.id, { units: parseUnits(values.units) });
			saleForm.reset({ units: '' });
			setSaleTarget(null);
			toast.success('Sale recorded');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not record sale.');
		}
	}

	// FR-016/FR-017: computed client-side over data already loaded above — no extra fetch.
	const portfolioSummary = computePortfolioSummary(
		holdings,
		new Map(Object.entries(valuesWithSource))
	);

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Investments</h1>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogTrigger asChild>
						<Button>
							<Plus /> Add holding
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>New holding</DialogTitle>
						</DialogHeader>
						<form className="flex flex-col gap-4" onSubmit={holdingForm.handleSubmit(onAddHolding)}>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="holding-name">Name</Label>
								<Input id="holding-name" {...holdingForm.register('name')} />
								{holdingForm.formState.errors.name && (
									<p className="text-sm text-destructive">
										{holdingForm.formState.errors.name.message}
									</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="holding-type">Type</Label>
								<Controller
									control={holdingForm.control}
									name="type"
									render={({ field }) => (
										<Select value={field.value} onValueChange={field.onChange}>
											<SelectTrigger id="holding-type" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{Object.entries(TYPE_LABELS).map(([value, label]) => (
													<SelectItem key={value} value={value}>
														{label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="holding-units">Units</Label>
									<Input
										id="holding-units"
										type="number"
										step="any"
										{...holdingForm.register('units')}
									/>
									{holdingForm.formState.errors.units && (
										<p className="text-sm text-destructive">
											{holdingForm.formState.errors.units.message}
										</p>
									)}
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="holding-avg-price">Avg. price / unit</Label>
									<Input
										id="holding-avg-price"
										type="number"
										step="0.01"
										{...holdingForm.register('avgPrice')}
									/>
									{holdingForm.formState.errors.avgPrice && (
										<p className="text-sm text-destructive">
											{holdingForm.formState.errors.avgPrice.message}
										</p>
									)}
								</div>
							</div>
							<DialogFooter>
								<Button type="submit">Add holding</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			{!loading && holdings.length > 0 && (
				<Card className="mb-6">
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Portfolio Summary
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="font-mono text-2xl font-semibold">
							{formatMoney(portfolioSummary.totalCurrentValue)}
						</p>
						<div className="mt-1 flex items-center gap-2 text-sm">
							<span className="text-muted-foreground">
								Invested {formatMoney(portfolioSummary.totalInvested)}
							</span>
							<span
								className={`flex items-center gap-1 font-mono ${
									portfolioSummary.totalGainLoss >= 0
										? 'text-emerald-600 dark:text-emerald-400'
										: 'text-destructive'
								}`}
							>
								{portfolioSummary.totalGainLoss >= 0 ? (
									<TrendingUp className="size-3.5" />
								) : (
									<TrendingDown className="size-3.5" />
								)}
								{formatMoney(portfolioSummary.totalGainLoss)} (
								{formatPercent(portfolioSummary.totalGainLossPercent)})
							</span>
						</div>
						{Object.keys(portfolioSummary.byType).length > 1 && (
							<dl className="mt-4 flex flex-col gap-1.5 border-t pt-3 text-sm">
								{(
									Object.entries(portfolioSummary.byType) as [
										InvestmentType,
										(typeof portfolioSummary.byType)[InvestmentType]
									][]
								).map(
									([type, typeSummary]) =>
										typeSummary && (
											<div key={type} className="flex items-center justify-between">
												<dt className="text-muted-foreground">
													{TYPE_LABELS[type]}
													{typeSummary.hasEstimatedValue && (
														<span className="ml-1 text-xs italic">(est.)</span>
													)}
												</dt>
												<dd className="font-mono">
													{formatMoney(typeSummary.currentValue)}{' '}
													<span className="text-xs text-muted-foreground">
														({formatPercent(typeSummary.gainLossPercent)})
													</span>
												</dd>
											</div>
										)
								)}
							</dl>
						)}
					</CardContent>
				</Card>
			)}

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : holdings.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<LineChart className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No holdings yet.</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					{holdings.map((holding) => {
						const valueEntry = valuesWithSource[holding.id];
						return (
							<Card key={holding.id}>
								<CardHeader className="pb-2">
									<CardTitle className="text-base">{holding.name}</CardTitle>
									<Badge variant="secondary" className="mt-1 w-fit">
										{TYPE_LABELS[holding.type] ?? holding.type}
									</Badge>
								</CardHeader>
								<CardContent className="flex flex-col gap-2">
									<p className="font-mono text-xl font-semibold">
										{formatMoney(valueEntry?.value ?? holding.costBasis)}
										{valueEntry?.isEstimate && (
											<span className="ml-2 align-middle text-xs font-normal text-muted-foreground italic">
												estimated (cost basis)
											</span>
										)}
									</p>
									{holding.units !== undefined && holding.avgPrice !== undefined ? (
										<p className="text-xs text-muted-foreground">
											{formatUnits(holding.units)} units @ {formatMoney(holding.avgPrice)} avg ·
											cost basis {formatMoney(holding.costBasis)}
										</p>
									) : (
										<p className="text-xs text-muted-foreground italic">
											No unit data (legacy holding) · cost basis {formatMoney(holding.costBasis)}
										</p>
									)}
									<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
										<Button
											variant="link"
											size="sm"
											className="h-auto p-0"
											onClick={() => setValuationTarget(holding)}
										>
											Update value
										</Button>
										<Button
											variant="link"
											size="sm"
											className="h-auto p-0"
											onClick={() => setPurchaseTarget(holding)}
										>
											<Plus className="size-3" /> Buy more units
										</Button>
										<Button
											variant="link"
											size="sm"
											className="h-auto p-0"
											onClick={() => setSaleTarget(holding)}
										>
											<Minus className="size-3" /> Sell units
										</Button>
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			<Dialog open={!!valuationTarget} onOpenChange={(open) => !open && setValuationTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Update value — {valuationTarget?.name}</DialogTitle>
					</DialogHeader>
					<form
						className="flex flex-col gap-4"
						onSubmit={valuationForm.handleSubmit(onAddValuation)}
					>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="valuation-value">Current value</Label>
							<Input
								id="valuation-value"
								type="number"
								step="0.01"
								{...valuationForm.register('value')}
							/>
						</div>
						<DialogFooter>
							<Button type="submit">Save</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={!!purchaseTarget} onOpenChange={(open) => !open && setPurchaseTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Buy more units — {purchaseTarget?.name}</DialogTitle>
					</DialogHeader>
					<form className="flex flex-col gap-4" onSubmit={purchaseForm.handleSubmit(onPurchase)}>
						<p className="text-sm text-muted-foreground">
							Units and average price are recalculated as a unit-weighted average across the
							existing and new purchase.
						</p>
						<div className="grid grid-cols-2 gap-3">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="purchase-units">Units purchased</Label>
								<Input
									id="purchase-units"
									type="number"
									step="any"
									{...purchaseForm.register('units')}
								/>
								{purchaseForm.formState.errors.units && (
									<p className="text-sm text-destructive">
										{purchaseForm.formState.errors.units.message}
									</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="purchase-price">Price / unit</Label>
								<Input
									id="purchase-price"
									type="number"
									step="0.01"
									{...purchaseForm.register('price')}
								/>
								{purchaseForm.formState.errors.price && (
									<p className="text-sm text-destructive">
										{purchaseForm.formState.errors.price.message}
									</p>
								)}
							</div>
						</div>
						<DialogFooter>
							<Button type="submit">Record purchase</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={!!saleTarget} onOpenChange={(open) => !open && setSaleTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Sell units — {saleTarget?.name}</DialogTitle>
					</DialogHeader>
					<form className="flex flex-col gap-4" onSubmit={saleForm.handleSubmit(onSale)}>
						<p className="text-sm text-muted-foreground">
							Currently held: {saleTarget ? formatUnits(saleTarget.units ?? 0) : 0} units. Average
							price stays unchanged; cost basis is recalculated for the remaining units.
						</p>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="sale-units">Units sold</Label>
							<Input id="sale-units" type="number" step="any" {...saleForm.register('units')} />
							{saleForm.formState.errors.units && (
								<p className="text-sm text-destructive">
									{saleForm.formState.errors.units.message}
								</p>
							)}
						</div>
						<DialogFooter>
							<Button type="submit" variant="destructive">
								Record sale
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
