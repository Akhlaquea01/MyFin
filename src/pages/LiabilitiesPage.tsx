import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, CreditCard, Plus } from 'lucide-react';
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
import { AccountRepository } from '../data/dexie/accountRepository';
import {
	findLikelyDuplicateAccounts,
	linkLiabilityToAccount,
	dismissDuplicateWarning
} from '../domain/wealth/wealthEngine';
import type { Account, Liability, LiabilityType } from '../domain/entities';
import { isNonNegativeMoney, parseMoneyOrZero } from '../domain/shared/money';

const liabilitySchema = z.object({
	name: z.string().trim().min(1, 'Name is required.'),
	type: z.enum(['loan', 'credit_card']),
	outstandingBalance: z
		.string()
		.refine((v) => isNonNegativeMoney(v || '0'), 'Enter a valid amount.')
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
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);
	// FR-008: set while the "this looks like a duplicate" warning is shown for the liability
	// currently being added, blocking the actual create until the user picks Link or Add anyway.
	const [pendingDuplicate, setPendingDuplicate] = useState<{
		values: LiabilityFormValues;
		matches: Account[];
	} | null>(null);

	const form = useForm<LiabilityFormValues>({
		resolver: zodResolver(liabilitySchema),
		defaultValues: { name: '', type: 'loan', outstandingBalance: '0' }
	});

	async function refresh() {
		setLoading(true);
		try {
			const [liabilityList, accountList] = await Promise.all([
				LiabilityRepository.list(key),
				AccountRepository.list(key, false)
			]);
			setLiabilities(liabilityList);
			setAccounts(accountList);
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

	async function createLiability(
		values: LiabilityFormValues,
		linkedAccountId: string | null,
		duplicateWarningDismissed: boolean
	) {
		try {
			await LiabilityRepository.create(key, {
				name: values.name,
				type: values.type,
				outstandingBalance: parseMoneyOrZero(values.outstandingBalance),
				emiAmount: null,
				emiDueDay: null,
				linkedAccountId,
				duplicateWarningDismissed
			});
			form.reset();
			setDialogOpen(false);
			setPendingDuplicate(null);
			toast.success(linkedAccountId ? 'Liability added and linked' : 'Liability added');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not add liability.');
		}
	}

	async function onSubmit(values: LiabilityFormValues) {
		// FR-008: check before creating, not after — a detected duplicate must be surfaced and
		// resolved before it can ever count separately in net worth.
		if (values.type === 'credit_card') {
			const matches = findLikelyDuplicateAccounts(
				{ name: values.name, type: values.type },
				accounts
			);
			if (matches.length > 0) {
				setPendingDuplicate({ values, matches });
				return;
			}
		}
		await createLiability(values, null, false);
	}

	async function linkExistingLiability(liability: Liability, accountId: string) {
		try {
			await linkLiabilityToAccount(key, liability.id, accountId);
			toast.success(`${liability.name} linked — it no longer counts separately in net worth`);
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not link this liability.');
		}
	}

	async function dismissExistingWarning(liability: Liability) {
		try {
			await dismissDuplicateWarning(key, liability.id);
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update this liability.');
		}
	}

	async function remove(liability: Liability) {
		try {
			await LiabilityRepository.softDelete(key, liability.id);
			// Liabilities have no Trash entry of their own to recover this from — an in-toast
			// undo is the only way back.
			toast.success(`${liability.name} deleted`, {
				action: {
					label: 'Undo',
					onClick: () => {
						void LiabilityRepository.restore(key, liability.id).then(refresh);
					}
				}
			});
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete liability.');
		}
	}

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Liabilities</h1>
				<Dialog
					open={dialogOpen}
					onOpenChange={(open) => {
						setDialogOpen(open);
						if (!open) setPendingDuplicate(null);
					}}
				>
					<DialogTrigger asChild>
						<Button>
							<Plus /> Add liability
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>New liability</DialogTitle>
						</DialogHeader>
						{pendingDuplicate ? (
							<div className="flex flex-col gap-4">
								<div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
									<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
									<p className="text-sm text-muted-foreground">
										This looks like it might be the same card as{' '}
										{pendingDuplicate.matches.map((a) => a.name).join(', ')}, which is already
										tracked from transactions. Counting both would double-count it in net worth.
									</p>
								</div>
								<div className="flex flex-col gap-2">
									{pendingDuplicate.matches.map((account) => (
										<Button
											key={account.id}
											type="button"
											variant="outline"
											onClick={() => createLiability(pendingDuplicate.values, account.id, false)}
										>
											Link to {account.name} instead
										</Button>
									))}
									<Button
										type="button"
										variant="outline"
										onClick={() => createLiability(pendingDuplicate.values, null, true)}
									>
										These are different — add anyway
									</Button>
									<Button type="button" variant="ghost" onClick={() => setPendingDuplicate(null)}>
										Back
									</Button>
								</div>
							</div>
						) : (
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
						)}
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
					{liabilities.map((liability) => {
						// FR-008/FR-010: re-checked on every view, not just at creation time, so a
						// liability created before this feature shipped (or whose matching card was
						// tagged/linked afterward) still surfaces the warning.
						const duplicateMatches =
							!liability.linkedAccountId && !liability.duplicateWarningDismissed
								? findLikelyDuplicateAccounts(liability, accounts)
								: [];
						return (
							<Card key={liability.id}>
								<CardHeader className="flex items-start justify-between space-y-0 pb-2">
									<CardTitle className="text-base">{liability.name}</CardTitle>
									<Badge variant="secondary">
										{liability.type === 'loan' ? 'Loan' : 'Credit Card'}
									</Badge>
								</CardHeader>
								<CardContent className="flex flex-col gap-2">
									<p className="font-mono text-xl font-semibold text-destructive">
										{formatMoney(liability.outstandingBalance)}
									</p>
									{liability.linkedAccountId && (
										<p className="text-xs text-muted-foreground">
											Linked to{' '}
											{accounts.find((a) => a.id === liability.linkedAccountId)?.name ??
												'a tracked card'}{' '}
											— not counted separately in net worth.
										</p>
									)}
									{duplicateMatches.length > 0 && (
										<div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
											<p className="flex items-start gap-1.5 text-xs text-muted-foreground">
												<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
												Looks like {duplicateMatches.map((a) => a.name).join(', ')} — already
												tracked from transactions. Counting both double-counts it.
											</p>
											<div className="flex flex-wrap gap-2">
												{duplicateMatches.map((account) => (
													<Button
														key={account.id}
														variant="outline"
														size="sm"
														className="h-auto py-1"
														onClick={() => linkExistingLiability(liability, account.id)}
													>
														Link to {account.name}
													</Button>
												))}
												<Button
													variant="ghost"
													size="sm"
													className="h-auto py-1"
													onClick={() => dismissExistingWarning(liability)}
												>
													These are different
												</Button>
											</div>
										</div>
									)}
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
						);
					})}
				</div>
			)}
		</div>
	);
}
