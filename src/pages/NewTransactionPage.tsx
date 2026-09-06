import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
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
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { MerchantRepository } from '../data/dexie/merchantRepository';
import { TagRepository, TransactionTagRepository } from '../data/dexie/tagRepository';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import type { Account, Category } from '../domain/entities';

const formSchema = z.object({
	accountId: z.string().min(1, 'Choose an account.'),
	type: z.enum(['expense', 'income']),
	amount: z.string().refine((v) => parseFloat(v || '0') > 0, 'Enter a positive amount.'),
	date: z.string().min(1),
	merchantName: z.string(),
	notes: z.string(),
	tagsInput: z.string(),
	splits: z.array(z.object({ categoryId: z.string(), amountInput: z.string() }))
});
type FormValues = z.infer<typeof formSchema>;

function toPaise(rupees: number | string): number {
	const value = Math.round(parseFloat(String(rupees) || '0') * 100);
	return Number.isFinite(value) ? value : 0;
}

// User Story 2 (P2): transaction entry, with optional multi-category splits (FR-008, FR-009).
export function NewTransactionPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const navigate = useNavigate();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		// No account is pre-selected: with more than one account, silently guessing "the
		// first one" is ambiguous and risks recording money against the wrong account.
		// The user always picks explicitly (validated by the "Choose an account." error).
		defaultValues: {
			accountId: '',
			type: 'expense',
			amount: '0',
			date: new Date().toISOString().slice(0, 10),
			merchantName: '',
			notes: '',
			tagsInput: '',
			splits: [{ categoryId: '', amountInput: '' }]
		}
	});
	const { fields, append, remove } = useFieldArray({ control: form.control, name: 'splits' });

	useEffect(() => {
		void Promise.all([AccountRepository.list(key, false), CategoryRepository.list(key)]).then(
			([accts, cats]) => {
				setAccounts(accts);
				setCategories(cats);
			}
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function onSubmit(values: FormValues) {
		const signedTotal =
			values.type === 'expense' ? -toPaise(values.amount) : toPaise(values.amount);
		const usableSplits = values.splits.filter((s) => s.categoryId && s.amountInput);
		const splitInputs = usableSplits.map((s) => ({
			categoryId: s.categoryId,
			amount: values.type === 'expense' ? -toPaise(s.amountInput) : toPaise(s.amountInput)
		}));

		try {
			let merchantId: string | null = null;
			if (values.merchantName.trim()) {
				const merchant = await MerchantRepository.create(key, values.merchantName.trim());
				merchantId = merchant.id;
			}

			const tx = await TransactionEngine.recordTransaction(
				key,
				{
					accountId: values.accountId,
					date: values.date,
					amount: signedTotal,
					type: values.type,
					merchantId,
					notes: values.notes.trim() || null
				},
				splitInputs
			);

			const tagNames = values.tagsInput
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			if (tagNames.length > 0) {
				const tags = await Promise.all(tagNames.map((n) => TagRepository.getOrCreate(key, n)));
				await TransactionTagRepository.setTags(
					tx.id,
					tags.map((t) => t.id)
				);
			}

			toast.success('Transaction saved');
			navigate('/transactions');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save transaction.');
		}
	}

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">New Transaction</h1>

			<Card>
				<CardContent className="pt-6">
					<form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)}>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="account">Account</Label>
								<Controller
									control={form.control}
									name="accountId"
									render={({ field }) => (
										<Select value={field.value} onValueChange={field.onChange}>
											<SelectTrigger id="account" className="w-full">
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
								{form.formState.errors.accountId && (
									<p className="text-sm text-destructive">
										{form.formState.errors.accountId.message}
									</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="type">Type</Label>
								<Controller
									control={form.control}
									name="type"
									render={({ field }) => (
										<Select value={field.value} onValueChange={field.onChange}>
											<SelectTrigger id="type" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="expense">Expense</SelectItem>
												<SelectItem value="income">Income</SelectItem>
											</SelectContent>
										</Select>
									)}
								/>
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

						<fieldset className="rounded-lg border p-3">
							<legend className="px-1 text-xs text-muted-foreground">
								Split across categories (optional)
							</legend>
							{fields.map((field, i) => (
								<div key={field.id} className="mb-2 flex items-center gap-2">
									<Controller
										control={form.control}
										name={`splits.${i}.categoryId`}
										render={({ field: selectField }) => (
											<Select value={selectField.value} onValueChange={selectField.onChange}>
												<SelectTrigger className="flex-1">
													<SelectValue placeholder="Category…" />
												</SelectTrigger>
												<SelectContent>
													{categories.map((c) => (
														<SelectItem key={c.id} value={c.id}>
															{c.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										)}
									/>
									<Input
										className="w-28"
										placeholder="Amount"
										{...form.register(`splits.${i}.amountInput`)}
									/>
									{fields.length > 1 && (
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label="Remove split"
											onClick={() => remove(i)}
										>
											<X />
										</Button>
									)}
								</div>
							))}
							<Button
								type="button"
								variant="link"
								size="sm"
								className="h-auto p-0"
								onClick={() => append({ categoryId: '', amountInput: '' })}
							>
								<Plus className="size-3.5" /> Add split
							</Button>
							<p className="mt-1 text-xs text-muted-foreground">
								Leave blank to record the full amount uncategorized.
							</p>
						</fieldset>

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="merchant">Merchant</Label>
							<Input id="merchant" {...form.register('merchantName')} />
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="tags">Tags (comma-separated)</Label>
							<Input id="tags" {...form.register('tagsInput')} />
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="notes">Notes</Label>
							<Textarea id="notes" {...form.register('notes')} />
						</div>

						<Button type="submit" disabled={form.formState.isSubmitting}>
							{form.formState.isSubmitting ? 'Saving…' : 'Save transaction'}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
