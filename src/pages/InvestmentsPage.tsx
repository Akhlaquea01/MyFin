import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LineChart, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '../components/ui/dialog';
import { useSession } from '../context/SessionContext';
import {
	InvestmentHoldingRepository,
	InvestmentValuationRepository
} from '../data/dexie/wealthRepository';
import type { InvestmentHolding } from '../domain/entities';
import { isNonNegativeMoney, parseMoneyOrZero } from '../domain/shared/money';

const holdingSchema = z.object({
	name: z.string().trim().min(1, 'Name is required.'),
	type: z.string().trim().min(1, 'Type is required.'),
	costBasis: z.string().refine((v) => isNonNegativeMoney(v || '0'), 'Enter a valid amount.')
});
type HoldingFormValues = z.infer<typeof holdingSchema>;

const valuationSchema = z.object({
	value: z.string().refine((v) => isNonNegativeMoney(v || '0'), 'Enter a valid amount.')
});
type ValuationFormValues = z.infer<typeof valuationSchema>;

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

// User Story 7 (P7): investment holdings with periodic valuations (FR-032).
export function InvestmentsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [holdings, setHoldings] = useState<InvestmentHolding[]>([]);
	const [currentValues, setCurrentValues] = useState<Record<string, number>>({});
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [valuationTarget, setValuationTarget] = useState<InvestmentHolding | null>(null);

	const holdingForm = useForm<HoldingFormValues>({
		resolver: zodResolver(holdingSchema),
		defaultValues: { name: '', type: '', costBasis: '0' }
	});
	const valuationForm = useForm<ValuationFormValues>({
		resolver: zodResolver(valuationSchema),
		defaultValues: { value: '0' }
	});

	async function refresh() {
		setLoading(true);
		try {
			const list = await InvestmentHoldingRepository.list(key);
			setHoldings(list);
			const values = await Promise.all(
				list.map((h) => InvestmentValuationRepository.latestValue(key, h))
			);
			setCurrentValues(Object.fromEntries(list.map((h, i) => [h.id, values[i]])));
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
		await InvestmentHoldingRepository.create(key, {
			name: values.name,
			type: values.type,
			costBasis: parseMoneyOrZero(values.costBasis)
		});
		holdingForm.reset();
		setDialogOpen(false);
		toast.success('Holding added');
		await refresh();
	}

	async function onAddValuation(values: ValuationFormValues) {
		if (!valuationTarget) return;
		await InvestmentValuationRepository.create(key, {
			holdingId: valuationTarget.id,
			date: new Date().toISOString().slice(0, 10),
			value: parseMoneyOrZero(values.value)
		});
		valuationForm.reset();
		setValuationTarget(null);
		toast.success('Valuation recorded');
		await refresh();
	}

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
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="holding-type">Type</Label>
								<Input
									id="holding-type"
									placeholder="e.g. mutual fund, stock, gold"
									{...holdingForm.register('type')}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="holding-cost">Cost basis</Label>
								<Input
									id="holding-cost"
									type="number"
									step="0.01"
									{...holdingForm.register('costBasis')}
								/>
							</div>
							<DialogFooter>
								<Button type="submit">Add holding</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>

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
					{holdings.map((holding) => (
						<Card key={holding.id}>
							<CardHeader className="pb-2">
								<CardTitle className="text-base">{holding.name}</CardTitle>
								<p className="text-xs text-muted-foreground">{holding.type}</p>
							</CardHeader>
							<CardContent>
								<p className="font-mono text-xl font-semibold">
									{formatMoney(currentValues[holding.id] ?? holding.costBasis)}
								</p>
								<Button
									variant="link"
									size="sm"
									className="h-auto p-0"
									onClick={() => setValuationTarget(holding)}
								>
									Update value
								</Button>
							</CardContent>
						</Card>
					))}
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
		</div>
	);
}
