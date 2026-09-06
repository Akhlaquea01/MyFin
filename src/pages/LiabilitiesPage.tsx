import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreditCard, Plus } from 'lucide-react';
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
import { LiabilityRepository } from '../data/dexie/wealthRepository';
import type { Liability, LiabilityType } from '../domain/entities';

const liabilitySchema = z.object({
	name: z.string().trim().min(1, 'Name is required.'),
	type: z.enum(['loan', 'credit_card']),
	outstandingBalance: z.string().refine((v) => parseFloat(v || '0') >= 0, 'Enter a valid amount.')
});
type LiabilityFormValues = z.infer<typeof liabilitySchema>;

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

// User Story 7 (P7): loans and credit cards, with an outstanding balance (FR-033).
export function LiabilitiesPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [liabilities, setLiabilities] = useState<Liability[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);

	const form = useForm<LiabilityFormValues>({
		resolver: zodResolver(liabilitySchema),
		defaultValues: { name: '', type: 'loan', outstandingBalance: '0' }
	});

	async function refresh() {
		setLoading(true);
		setLiabilities(await LiabilityRepository.list(key));
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function onSubmit(values: LiabilityFormValues) {
		await LiabilityRepository.create(key, {
			name: values.name,
			type: values.type,
			outstandingBalance: Math.round(parseFloat(values.outstandingBalance) * 100),
			emiAmount: null,
			emiDueDay: null
		});
		form.reset();
		setDialogOpen(false);
		toast.success('Liability added');
		await refresh();
	}

	async function remove(liability: Liability) {
		await LiabilityRepository.softDelete(key, liability.id);
		await refresh();
	}

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Liabilities</h1>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogTrigger asChild>
						<Button>
							<Plus /> Add liability
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>New liability</DialogTitle>
						</DialogHeader>
						<form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="liability-name">Name</Label>
								<Input id="liability-name" {...form.register('name')} />
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="liability-type">Type</Label>
								<Controller
									control={form.control}
									name="type"
									render={({ field }) => (
										<Select
											value={field.value}
											onValueChange={(v) => field.onChange(v as LiabilityType)}
										>
											<SelectTrigger id="liability-type" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="loan">Loan</SelectItem>
												<SelectItem value="credit_card">Credit Card</SelectItem>
											</SelectContent>
										</Select>
									)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="liability-balance">Outstanding balance</Label>
								<Input
									id="liability-balance"
									type="number"
									step="0.01"
									{...form.register('outstandingBalance')}
								/>
							</div>
							<DialogFooter>
								<Button type="submit">Add liability</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : liabilities.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<CreditCard className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No liabilities yet.</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					{liabilities.map((liability) => (
						<Card key={liability.id}>
							<CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
								<CardTitle className="text-base">{liability.name}</CardTitle>
								<Badge variant="secondary">
									{liability.type === 'loan' ? 'Loan' : 'Credit Card'}
								</Badge>
							</CardHeader>
							<CardContent>
								<p className="font-mono text-xl font-semibold text-destructive">
									{formatMoney(liability.outstandingBalance)}
								</p>
								<Button
									variant="link"
									size="sm"
									className="h-auto p-0"
									onClick={() => remove(liability)}
								>
									Remove
								</Button>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
