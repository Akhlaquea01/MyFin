import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import {
	formatMinorUnits,
	isPositiveMoney,
	parseMoneyOrZero,
	formatMoney
} from '../domain/shared/money';
import { useUnsavedChanges } from '../lib/unsavedChanges';
import { isValidIsoDate, todayLocalISO } from '../domain/shared/dateMath';
import { computeCardUtilization } from '../domain/wealth/wealthEngine';

// spec 018, User Story 4 (FR-016/FR-019): passed by AccountsPage.tsx's "Pay bill" action — and by
// the Quick Add / Review / New Transaction entry points that recognise a card payment — via
// `navigate(..., { state })`, the same seeding pattern ShareTargetLandingPage already uses for
// QuickAddPage (spec 008). Every field is an optional seed the user can still change, except a
// destination card locked by the "Pay bill" button on that very card.
export interface TransferLocationState {
	toAccountId?: string;
	fromAccountId?: string;
	mode?: 'pay-bill';
	/** Pre-filled amount, as a plain decimal string ("1234.56"). */
	amount?: string;
	notes?: string;
	/** Whether `toAccountId` is fixed. Defaults to true for a "pay-bill" seed that names a card
	 *  (the card's own "Pay bill" button); entry points that merely *suggest* a card pass false. */
	lockDestination?: boolean;
}

const formSchema = z
	.object({
		fromAccountId: z.string().min(1, 'Choose an account.'),
		toAccountId: z.string().min(1, 'Choose an account.'),
		amount: z.string().refine((v) => isPositiveMoney(v), 'Enter a positive amount.'),
		date: z.string().refine(isValidIsoDate, 'Enter a valid date.'),
		notes: z.string()
	})
	.refine((v) => v.fromAccountId !== v.toAccountId, {
		message: 'Choose two different accounts.',
		path: ['toAccountId']
	});
type FormValues = z.infer<typeof formSchema>;

// User Story 2 (P2): transfer between two of the user's own accounts (FR-011), and — as the same
// linked pair of movements — paying a credit card bill (spec 018, User Story 4). One screen, one
// toggle, so recording "I paid my card" never means entering two separate transactions by hand.
export function TransferPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const navigate = useNavigate();
	const location = useLocation();

	const seed = (location.state as TransferLocationState | null) ?? {};
	const lockedToAccountId =
		(seed.lockDestination ?? (seed.mode === 'pay-bill' && !!seed.toAccountId))
			? seed.toAccountId
			: undefined;
	const [isPayBill, setIsPayBill] = useState(seed.mode === 'pay-bill');

	const [accounts, setAccounts] = useState<Account[]>([]);

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		// Nothing is guessed for the user: an account is pre-selected only when the entry point
		// that brought them here made an explicit, unambiguous choice (the "Pay bill" button on a
		// specific card, or a card number recognised in a pasted message). Silently picking one
		// risks recording a movement against the wrong account.
		defaultValues: {
			fromAccountId: seed.fromAccountId ?? '',
			toAccountId: seed.toAccountId ?? '',
			amount: seed.amount ?? '0',
			date: todayLocalISO(),
			notes: seed.notes ?? ''
		}
	});
	// A share from another app must not silently replace what has been typed here.
	useUnsavedChanges(form.formState.isDirty && !form.formState.isSubmitting);

	const toAccountId = form.watch('toAccountId');
	const fromAccountId = form.watch('fromAccountId');

	useEffect(() => {
		void AccountRepository.list(key, false).then(setAccounts);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const creditCards = useMemo(() => accounts.filter((a) => a.type === 'credit_card'), [accounts]);
	const toAccount = accounts.find((a) => a.id === toAccountId);
	// What the chosen card currently owes — shown next to the amount so the user can pay exactly
	// that with one tap instead of working it out from the Accounts page.
	const outstanding =
		isPayBill && toAccount?.type === 'credit_card' ? computeCardUtilization(toAccount).used : 0;

	// FR-020: the source account is always the user's own choice; the only exclusions are the
	// destination itself (a self-transfer is meaningless) and, when paying a bill, other credit
	// cards (paying one card's bill by charging another is a cash advance, not a payment).
	const fromAccountOptions = accounts.filter(
		(a) => a.id !== toAccountId && !(isPayBill && a.type === 'credit_card')
	);
	const toAccountOptions = isPayBill ? creditCards : accounts.filter((a) => a.id !== fromAccountId);

	function switchMode(payBill: boolean) {
		if (payBill === isPayBill) return;
		setIsPayBill(payBill);
		// A destination that is not a card cannot survive the switch to bill payment, and a card
		// cannot stay as the source of one.
		const to = accounts.find((a) => a.id === form.getValues('toAccountId'));
		if (payBill && to && to.type !== 'credit_card') form.setValue('toAccountId', '');
		const from = accounts.find((a) => a.id === form.getValues('fromAccountId'));
		if (payBill && from?.type === 'credit_card') form.setValue('fromAccountId', '');
	}

	async function onSubmit(values: FormValues) {
		try {
			await TransactionEngine.recordTransfer(key, {
				fromAccountId: values.fromAccountId,
				toAccountId: values.toAccountId,
				amount: parseMoneyOrZero(values.amount || '0'),
				date: values.date,
				notes: values.notes.trim() || (isPayBill ? 'Credit card bill payment' : undefined)
			});
			toast.success(isPayBill ? 'Payment recorded' : 'Transfer recorded');
			navigate('/transactions', { replace: true });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not record transfer.');
		}
	}

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-2 text-2xl font-semibold tracking-tight">
				{isPayBill ? 'Pay Credit Card Bill' : 'Transfer Between Accounts'}
			</h1>
			<p className="mb-4 text-sm text-muted-foreground">
				{isPayBill
					? 'Records one payment: money leaves the account you pay from and the card’s outstanding balance goes down by the same amount. It is not counted as spending.'
					: 'Moves money between two of your own accounts. Both balances update together, and it is not counted as income or spending.'}
			</p>

			{!lockedToAccountId && (
				<div
					className="mb-4 inline-flex rounded-lg border p-0.5"
					role="radiogroup"
					aria-label="Kind of movement"
				>
					<Button
						type="button"
						size="sm"
						variant={isPayBill ? 'ghost' : 'secondary'}
						role="radio"
						aria-checked={!isPayBill}
						onClick={() => switchMode(false)}
					>
						Transfer
					</Button>
					<Button
						type="button"
						size="sm"
						variant={isPayBill ? 'secondary' : 'ghost'}
						role="radio"
						aria-checked={isPayBill}
						onClick={() => switchMode(true)}
					>
						Card bill payment
					</Button>
				</div>
			)}

			<Card>
				<CardContent className="pt-6">
					<form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)}>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="from">From</Label>
								{isPayBill && fromAccountOptions.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										You don't have another account to pay from yet.{' '}
										<Link to="/accounts" className="underline underline-offset-2">
											Add a bank or cash account
										</Link>
										.
									</p>
								) : (
									<Controller
										control={form.control}
										name="fromAccountId"
										render={({ field }) => (
											<Select value={field.value} onValueChange={field.onChange}>
												<SelectTrigger id="from" className="w-full">
													<SelectValue placeholder="Choose account…" />
												</SelectTrigger>
												<SelectContent>
													{fromAccountOptions.map((a) => (
														<SelectItem key={a.id} value={a.id}>
															{a.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										)}
									/>
								)}
								{form.formState.errors.fromAccountId && (
									<p className="text-sm text-destructive">
										{form.formState.errors.fromAccountId.message}
									</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="to">To</Label>
								{isPayBill && creditCards.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										You haven't added a credit card yet.{' '}
										<Link to="/accounts" className="underline underline-offset-2">
											Add one
										</Link>
										.
									</p>
								) : (
									<Controller
										control={form.control}
										name="toAccountId"
										render={({ field }) => (
											<Select
												value={field.value}
												onValueChange={field.onChange}
												disabled={!!lockedToAccountId}
											>
												<SelectTrigger id="to" className="w-full">
													<SelectValue placeholder="Choose account…" />
												</SelectTrigger>
												<SelectContent>
													{toAccountOptions.map((a) => (
														<SelectItem key={a.id} value={a.id}>
															{a.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										)}
									/>
								)}
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
								{isPayBill && toAccount && (
									<p className="text-xs text-muted-foreground">
										{outstanding > 0 ? (
											<>
												Outstanding on {toAccount.name}: {formatMoney(outstanding)}{' '}
												<button
													type="button"
													className="underline underline-offset-2"
													onClick={() =>
														form.setValue('amount', formatMinorUnits(outstanding), {
															shouldValidate: true
														})
													}
												>
													Pay full outstanding
												</button>
											</>
										) : (
											<>Nothing is currently owed on {toAccount.name}.</>
										)}
									</p>
								)}
								{form.formState.errors.amount && (
									<p className="text-sm text-destructive">{form.formState.errors.amount.message}</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="date">Date</Label>
								<Input id="date" type="date" {...form.register('date')} />
								{form.formState.errors.date && (
									<p className="text-sm text-destructive">{form.formState.errors.date.message}</p>
								)}
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="notes">Notes</Label>
							<Input id="notes" {...form.register('notes')} />
						</div>
						<Button
							type="submit"
							disabled={
								form.formState.isSubmitting ||
								(isPayBill && (fromAccountOptions.length === 0 || creditCards.length === 0))
							}
						>
							{form.formState.isSubmitting
								? isPayBill
									? 'Recording…'
									: 'Transferring…'
								: isPayBill
									? 'Record payment'
									: 'Transfer'}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
