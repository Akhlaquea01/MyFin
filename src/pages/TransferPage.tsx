import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import type { Account } from '../domain/entities';
import { isPositiveMoney, parseMoneyOrZero } from '../domain/shared/money';

const formSchema = z
	.object({
		fromAccountId: z.string().min(1, 'Choose an account.'),
		toAccountId: z.string().min(1, 'Choose an account.'),
		amount: z.string().refine((v) => isPositiveMoney(v), 'Enter a positive amount.'),
		date: z.string().min(1),
		notes: z.string()
	})
	.refine((v) => v.fromAccountId !== v.toAccountId, {
		message: 'Choose two different accounts.',
		path: ['toAccountId']
	});
type FormValues = z.infer<typeof formSchema>;

// User Story 2 (P2): transfer between two of the user's own accounts (FR-011).
export function TransferPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const navigate = useNavigate();

	const [accounts, setAccounts] = useState<Account[]>([]);

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		// No accounts pre-selected — see the comment in NewTransactionPage.tsx: silently
		// guessing which accounts the user means risks a transfer against the wrong ones.
		defaultValues: {
			fromAccountId: '',
			toAccountId: '',
			amount: '0',
			date: new Date().toISOString().slice(0, 10),
			notes: ''
		}
	});

	useEffect(() => {
		void AccountRepository.list(key, false).then(setAccounts);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function onSubmit(values: FormValues) {
		try {
			await TransactionEngine.recordTransfer(key, {
				fromAccountId: values.fromAccountId,
				toAccountId: values.toAccountId,
				amount: parseMoneyOrZero(values.amount || '0'),
				date: values.date,
				notes: values.notes.trim() || undefined
			});
			toast.success('Transfer recorded');
			navigate('/transactions');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not record transfer.');
		}
	}

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Transfer Between Accounts</h1>

			<Card>
				<CardContent className="pt-6">
					<form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)}>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="from">From</Label>
								<Controller
									control={form.control}
									name="fromAccountId"
									render={({ field }) => (
										<Select value={field.value} onValueChange={field.onChange}>
											<SelectTrigger id="from" className="w-full">
												<SelectValue placeholder="Choose account…" />
											</SelectTrigger>
											<SelectContent>
												{accounts.map((a) => (
													<SelectItem key={a.id} value={a.id}>
														{a.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
								/>
								{form.formState.errors.fromAccountId && (
									<p className="text-sm text-destructive">
										{form.formState.errors.fromAccountId.message}
									</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="to">To</Label>
								<Controller
									control={form.control}
									name="toAccountId"
									render={({ field }) => (
										<Select value={field.value} onValueChange={field.onChange}>
											<SelectTrigger id="to" className="w-full">
												<SelectValue placeholder="Choose account…" />
											</SelectTrigger>
											<SelectContent>
												{accounts.map((a) => (
													<SelectItem key={a.id} value={a.id}>
														{a.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									)}
								/>
								{form.formState.errors.toAccountId && (
									<p className="text-sm text-destructive">
										{form.formState.errors.toAccountId.message}
									</p>
								)}
							</div>
						</div>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="amount">Amount</Label>
								<Input id="amount" type="number" step="0.01" {...form.register('amount')} />
								{form.formState.errors.amount && (
									<p className="text-sm text-destructive">{form.formState.errors.amount.message}</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="date">Date</Label>
								<Input id="date" type="date" {...form.register('date')} />
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="notes">Notes</Label>
							<Input id="notes" {...form.register('notes')} />
						</div>
						<Button type="submit" disabled={form.formState.isSubmitting}>
							{form.formState.isSubmitting ? 'Transferring…' : 'Transfer'}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
