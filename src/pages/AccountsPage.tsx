import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, MoreVertical, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '../components/ui/dropdown-menu';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import type { Account, AccountType } from '../domain/entities';
import { isValidMoney, parseMoneyOrZero } from '../domain/shared/money';
import { computeCardUtilization } from '../domain/wealth/wealthEngine';

function isValidBillingCycleDay(raw: string): boolean {
	if (!raw.trim()) return true;
	const n = Number(raw);
	return Number.isInteger(n) && n >= 1 && n <= 31;
}

function isValidCardLast4(raw: string): boolean {
	return !raw.trim() || /^\d{4}$/.test(raw.trim());
}

const accountSchema = z.object({
	name: z.string().trim().min(1, 'Account name is required.'),
	type: z.enum(['bank', 'cash', 'wallet', 'credit_card']),
	openingBalance: z.string().refine((v) => isValidMoney(v || '0'), 'Enter a valid amount.'),
	// FR-001: optional — a credit_card account may be created/edited without a limit yet.
	creditLimit: z.string().refine((v) => !v.trim() || isValidMoney(v), 'Enter a valid amount.'),
	billingCycleDay: z.string().refine(isValidBillingCycleDay, 'Enter a day between 1 and 31.'),
	// FR-019: optional identifiers used to auto-match imported/pasted transactions (FR-020).
	cardLast4: z.string().refine(isValidCardLast4, 'Enter exactly 4 digits.'),
	cardNickname: z.string()
});
type AccountFormValues = z.infer<typeof accountSchema>;

function creditLimitToPaise(raw: string): number | null {
	return raw.trim() ? parseMoneyOrZero(raw) : null;
}

function billingCycleDayToNumber(raw: string): number | null {
	return raw.trim() ? Number(raw) : null;
}

function optionalTrimmed(raw: string): string | null {
	return raw.trim() ? raw.trim() : null;
}

const TYPE_LABELS: Record<AccountType, string> = {
	bank: 'Bank',
	cash: 'Cash',
	wallet: 'Wallet',
	credit_card: 'Credit Card'
};

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

// User Story 2 (P2): full account CRUD (FR-007).
export function AccountsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const navigate = useNavigate();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editTarget, setEditTarget] = useState<Account | null>(null);

	const form = useForm<AccountFormValues>({
		resolver: zodResolver(accountSchema),
		defaultValues: {
			name: '',
			type: 'bank',
			openingBalance: '0',
			creditLimit: '',
			billingCycleDay: '',
			cardLast4: '',
			cardNickname: ''
		}
	});
	const formType = form.watch('type');

	const editForm = useForm<AccountFormValues>({
		resolver: zodResolver(accountSchema),
		defaultValues: {
			name: '',
			type: 'bank',
			openingBalance: '0',
			creditLimit: '',
			billingCycleDay: '',
			cardLast4: '',
			cardNickname: ''
		}
	});
	const editFormType = editForm.watch('type');

	async function refresh() {
		setAccounts(await AccountRepository.list(key));
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function onSubmit(values: AccountFormValues) {
		try {
			const isCreditCard = values.type === 'credit_card';
			await AccountRepository.create(key, {
				name: values.name,
				type: values.type,
				openingBalance: parseMoneyOrZero(values.openingBalance || '0'),
				creditLimit: isCreditCard ? creditLimitToPaise(values.creditLimit) : null,
				billingCycleDay: isCreditCard ? billingCycleDayToNumber(values.billingCycleDay) : null,
				cardLast4: isCreditCard ? optionalTrimmed(values.cardLast4) : null,
				cardNickname: isCreditCard ? optionalTrimmed(values.cardNickname) : null
			});
			form.reset({
				name: '',
				type: 'bank',
				openingBalance: '0',
				creditLimit: '',
				billingCycleDay: '',
				cardLast4: '',
				cardNickname: ''
			});
			setDialogOpen(false);
			toast.success(`${values.name} added`);
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not create account.');
		}
	}

	function openEditDialog(account: Account) {
		setEditTarget(account);
		editForm.reset({
			name: account.name,
			type: account.type,
			openingBalance: String(account.openingBalance / 100),
			creditLimit: account.creditLimit !== null ? String(account.creditLimit / 100) : '',
			billingCycleDay: account.billingCycleDay !== null ? String(account.billingCycleDay) : '',
			cardLast4: account.cardLast4 ?? '',
			cardNickname: account.cardNickname ?? ''
		});
	}

	async function onEditSubmit(values: AccountFormValues) {
		if (!editTarget) return;
		try {
			const isCreditCard = values.type === 'credit_card';
			await AccountRepository.update(key, editTarget.id, {
				name: values.name,
				type: values.type,
				openingBalance: parseMoneyOrZero(values.openingBalance || '0'),
				creditLimit: isCreditCard ? creditLimitToPaise(values.creditLimit) : null,
				billingCycleDay: isCreditCard ? billingCycleDayToNumber(values.billingCycleDay) : null,
				cardLast4: isCreditCard ? optionalTrimmed(values.cardLast4) : null,
				cardNickname: isCreditCard ? optionalTrimmed(values.cardNickname) : null
			});
			setEditTarget(null);
			toast.success(`${values.name} updated`);
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update account.');
		}
	}

	async function archiveAccount(account: Account) {
		// Archived accounts are excluded from Net Worth/Dashboard totals — archiving one still
		// holding money would silently drop that amount from every reported total with no
		// warning or reconciling entry, so only a zeroed-out account may be archived.
		if (!account.isArchived && account.currentBalance !== 0) {
			toast.error(
				`${account.name} still has a balance of ${formatMoney(account.currentBalance)}. ` +
					'Move or clear the balance before archiving it.'
			);
			return;
		}
		try {
			await AccountRepository.update(key, account.id, { isArchived: !account.isArchived });
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update account.');
		}
	}

	async function deleteAccount(account: Account) {
		try {
			await AccountRepository.softDelete(key, account.id);
			toast.success(`${account.name} moved to trash`, {
				action: {
					label: 'Undo',
					onClick: () => {
						void AccountRepository.restore(key, account.id).then(refresh);
					}
				}
			});
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete account.');
		}
	}

	return (
		<div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogTrigger asChild>
						<Button>
							<Plus /> Add account
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>New account</DialogTitle>
						</DialogHeader>
						<form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="account-name">Name</Label>
								<Input id="account-name" {...form.register('name')} />
								{form.formState.errors.name && (
									<p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="account-type">Type</Label>
								<Controller
									control={form.control}
									name="type"
									render={({ field }) => (
										<Select value={field.value} onValueChange={field.onChange}>
											<SelectTrigger id="account-type" className="w-full">
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
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="opening-balance">Opening balance</Label>
								<Input
									id="opening-balance"
									type="number"
									step="0.01"
									{...form.register('openingBalance')}
								/>
							</div>
							{formType === 'credit_card' && (
								<div className="grid grid-cols-2 gap-3">
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="credit-limit">Credit limit (optional)</Label>
										<Input
											id="credit-limit"
											type="number"
											step="0.01"
											placeholder="No limit set"
											{...form.register('creditLimit')}
										/>
										{form.formState.errors.creditLimit && (
											<p className="text-sm text-destructive">
												{form.formState.errors.creditLimit.message}
											</p>
										)}
									</div>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="billing-cycle-day">Billing cycle day (optional)</Label>
										<Input
											id="billing-cycle-day"
											type="number"
											min={1}
											max={31}
											placeholder="1-31"
											{...form.register('billingCycleDay')}
										/>
										{form.formState.errors.billingCycleDay && (
											<p className="text-sm text-destructive">
												{form.formState.errors.billingCycleDay.message}
											</p>
										)}
									</div>
								</div>
							)}
							{formType === 'credit_card' && (
								<div className="grid grid-cols-2 gap-3">
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="card-last4">Last 4 digits (optional)</Label>
										<Input
											id="card-last4"
											inputMode="numeric"
											maxLength={4}
											placeholder="1234"
											{...form.register('cardLast4')}
										/>
										{form.formState.errors.cardLast4 && (
											<p className="text-sm text-destructive">
												{form.formState.errors.cardLast4.message}
											</p>
										)}
									</div>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="card-nickname">Nickname (optional)</Label>
										<Input
											id="card-nickname"
											placeholder="e.g. Amazon Pay Card"
											{...form.register('cardNickname')}
										/>
									</div>
								</div>
							)}
							<DialogFooter>
								<Button type="submit" disabled={form.formState.isSubmitting}>
									Add account
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : accounts.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<Wallet className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No accounts yet. Add your first one.</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					{accounts.map((account) => {
						const utilization =
							account.type === 'credit_card' ? computeCardUtilization(account) : null;
						return (
							<Card key={account.id} className={account.isArchived ? 'opacity-60' : undefined}>
								<CardHeader className="flex items-start justify-between space-y-0">
									<div>
										<CardTitle className="text-base">{account.name}</CardTitle>
										<div className="mt-1 flex flex-wrap items-center gap-1.5">
											<Badge variant="secondary">{TYPE_LABELS[account.type]}</Badge>
											{utilization?.isOverLimit && (
												<Badge variant="destructive">
													<AlertTriangle className="size-3" /> Over limit
												</Badge>
											)}
											{!utilization?.isOverLimit && utilization?.isHighUtilization && (
												<Badge variant="destructive">
													<AlertTriangle className="size-3" /> High utilization
												</Badge>
											)}
										</div>
									</div>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="ghost" size="icon-sm" aria-label={`${account.name} actions`}>
												<MoreVertical />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuItem onSelect={() => openEditDialog(account)}>
												Edit
											</DropdownMenuItem>
											{account.type === 'credit_card' && (
												<DropdownMenuItem
													onSelect={() =>
														navigate('/transactions/transfer', {
															state: { toAccountId: account.id, mode: 'pay-bill' }
														})
													}
												>
													Pay bill
												</DropdownMenuItem>
											)}
											<DropdownMenuItem onSelect={() => archiveAccount(account)}>
												{account.isArchived ? 'Unarchive' : 'Archive'}
											</DropdownMenuItem>
											<DropdownMenuItem
												variant="destructive"
												onSelect={() => deleteAccount(account)}
											>
												Delete
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</CardHeader>
								<CardContent>
									<p className="font-mono text-2xl font-semibold">
										{formatMoney(account.currentBalance)}
									</p>
									{utilization && (
										<div className="mt-3 flex flex-col gap-1.5">
											{utilization.available !== null && utilization.utilizationPercent !== null ? (
												<>
													<div className="flex items-center justify-between text-xs text-muted-foreground">
														<span>Used {formatMoney(utilization.used)}</span>
														<span>Available {formatMoney(utilization.available)}</span>
													</div>
													<Progress value={Math.min(100, utilization.utilizationPercent)} />
													<p className="text-right text-xs text-muted-foreground">
														{utilization.utilizationPercent}% utilized
													</p>
												</>
											) : (
												<p className="text-xs text-muted-foreground">
													Used {formatMoney(utilization.used)} ·{' '}
													<button
														type="button"
														className="underline underline-offset-2"
														onClick={() => openEditDialog(account)}
													>
														Add a credit limit
													</button>{' '}
													to see utilization
												</p>
											)}
										</div>
									)}
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			<Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit account</DialogTitle>
					</DialogHeader>
					<form className="flex flex-col gap-4" onSubmit={editForm.handleSubmit(onEditSubmit)}>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="edit-account-name">Name</Label>
							<Input id="edit-account-name" {...editForm.register('name')} />
							{editForm.formState.errors.name && (
								<p className="text-sm text-destructive">{editForm.formState.errors.name.message}</p>
							)}
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="edit-account-type">Type</Label>
							<Controller
								control={editForm.control}
								name="type"
								render={({ field }) => (
									<Select value={field.value} onValueChange={field.onChange}>
										<SelectTrigger id="edit-account-type" className="w-full">
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
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="edit-opening-balance">Opening balance</Label>
							<Input
								id="edit-opening-balance"
								type="number"
								step="0.01"
								{...editForm.register('openingBalance')}
							/>
						</div>
						{editFormType === 'credit_card' && (
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="edit-credit-limit">Credit limit (optional)</Label>
									<Input
										id="edit-credit-limit"
										type="number"
										step="0.01"
										placeholder="No limit set"
										{...editForm.register('creditLimit')}
									/>
									{editForm.formState.errors.creditLimit && (
										<p className="text-sm text-destructive">
											{editForm.formState.errors.creditLimit.message}
										</p>
									)}
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="edit-billing-cycle-day">Billing cycle day (optional)</Label>
									<Input
										id="edit-billing-cycle-day"
										type="number"
										min={1}
										max={31}
										placeholder="1-31"
										{...editForm.register('billingCycleDay')}
									/>
									{editForm.formState.errors.billingCycleDay && (
										<p className="text-sm text-destructive">
											{editForm.formState.errors.billingCycleDay.message}
										</p>
									)}
								</div>
							</div>
						)}
						{editFormType === 'credit_card' && (
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="edit-card-last4">Last 4 digits (optional)</Label>
									<Input
										id="edit-card-last4"
										inputMode="numeric"
										maxLength={4}
										placeholder="1234"
										{...editForm.register('cardLast4')}
									/>
									{editForm.formState.errors.cardLast4 && (
										<p className="text-sm text-destructive">
											{editForm.formState.errors.cardLast4.message}
										</p>
									)}
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="edit-card-nickname">Nickname (optional)</Label>
									<Input
										id="edit-card-nickname"
										placeholder="e.g. Amazon Pay Card"
										{...editForm.register('cardNickname')}
									/>
								</div>
							</div>
						)}
						<DialogFooter>
							<Button type="submit" disabled={editForm.formState.isSubmitting}>
								Save changes
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
