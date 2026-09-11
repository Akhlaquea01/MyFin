import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MoreVertical, Plus, Wallet } from 'lucide-react';
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

const accountSchema = z.object({
	name: z.string().trim().min(1, 'Account name is required.'),
	type: z.enum(['bank', 'cash', 'wallet', 'credit_card']),
	openingBalance: z.string().refine((v) => isValidMoney(v || '0'), 'Enter a valid amount.')
});
type AccountFormValues = z.infer<typeof accountSchema>;

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

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);

	const form = useForm<AccountFormValues>({
		resolver: zodResolver(accountSchema),
		defaultValues: { name: '', type: 'bank', openingBalance: '0' }
	});

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
			await AccountRepository.create(key, {
				name: values.name,
				type: values.type,
				openingBalance: parseMoneyOrZero(values.openingBalance || '0'),
				creditLimit: null,
				billingCycleDay: null
			});
			form.reset({ name: '', type: 'bank', openingBalance: '0' });
			setDialogOpen(false);
			toast.success(`${values.name} added`);
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not create account.');
		}
	}

	async function archiveAccount(account: Account) {
		await AccountRepository.update(key, account.id, { isArchived: !account.isArchived });
		await refresh();
	}

	async function deleteAccount(account: Account) {
		try {
			await AccountRepository.softDelete(key, account.id);
			toast.success(`${account.name} moved to trash`);
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
					{accounts.map((account) => (
						<Card key={account.id} className={account.isArchived ? 'opacity-60' : undefined}>
							<CardHeader className="flex items-start justify-between space-y-0">
								<div>
									<CardTitle className="text-base">{account.name}</CardTitle>
									<Badge variant="secondary" className="mt-1">
										{TYPE_LABELS[account.type]}
									</Badge>
								</div>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon-sm" aria-label={`${account.name} actions`}>
											<MoreVertical />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onSelect={() => archiveAccount(account)}>
											{account.isArchived ? 'Unarchive' : 'Archive'}
										</DropdownMenuItem>
										<DropdownMenuItem variant="destructive" onSelect={() => deleteAccount(account)}>
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</CardHeader>
							<CardContent>
								<p className="font-mono text-2xl font-semibold">
									{formatMoney(account.currentBalance)}
								</p>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
