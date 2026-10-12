import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '../components/ui/dialog';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import {
	PersonRepository,
	PersonLoanRepository,
	LoanRepaymentRepository
} from '../data/dexie/personLoanRepository';
import {
	computePendingBalance,
	deriveLoanStatus,
	computeNetPositionForPerson,
	isLoanOverdue
} from '../domain/personLoans/loanProgress';
import type { Account, LoanDirection, LoanRepayment, Person, PersonLoan } from '../domain/entities';
import { formatMinorUnits, isPositiveMoney, parseMoneyOrZero, formatMoney } from '../domain/shared/money';
import { todayLocalISO } from '../domain/shared/dateMath';
import { useConfirm } from '../lib/confirm';

function todayISO(): string {
	return todayLocalISO();
}

const loanSchema = z.object({
	personName: z.string().trim().min(1, 'Enter a name.'),
	direction: z.enum(['lent', 'borrowed']),
	principalAmount: z.string().refine((v) => isPositiveMoney(v), 'Enter a positive amount.'),
	accountId: z.string().min(1, 'Choose an account.'),
	date: z.string().min(1),
	dueDate: z.string(), // '' means no due date
	notes: z.string()
});
type LoanFormValues = z.infer<typeof loanSchema>;

const repaymentSchema = z.object({
	amount: z.string().refine((v) => isPositiveMoney(v), 'Enter a positive amount.'),
	date: z.string().min(1),
	accountId: z.string().min(1, 'Choose an account.')
});
type RepaymentFormValues = z.infer<typeof repaymentSchema>;

// User Story 1 (P1): record a loan (lent or borrowed) against a person and an account.
// User Story 2 (P2): log a partial or full repayment against an open loan.
export function PeoplePage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [people, setPeople] = useState<Person[]>([]);
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [loansByPerson, setLoansByPerson] = useState<Record<string, PersonLoan[]>>({});
	const [repaymentsByLoan, setRepaymentsByLoan] = useState<Record<string, LoanRepayment[]>>({});
	const [loading, setLoading] = useState(true);
	const [loanDialogOpen, setLoanDialogOpen] = useState(false);

	const loanForm = useForm<LoanFormValues>({
		resolver: zodResolver(loanSchema),
		defaultValues: {
			personName: '',
			direction: 'lent',
			principalAmount: '0',
			accountId: '',
			date: todayISO(),
			dueDate: '',
			notes: ''
		}
	});

	async function refresh() {
		setLoading(true);
		const [peopleList, accountList] = await Promise.all([
			PersonRepository.list(key),
			AccountRepository.list(key, false)
		]);
		setPeople(peopleList);
		setAccounts(accountList);

		const loanEntries = await Promise.all(
			peopleList.map(
				async (p) => [p.id, await PersonLoanRepository.listForPerson(key, p.id)] as const
			)
		);
		const loansMap = Object.fromEntries(loanEntries);
		setLoansByPerson(loansMap);

		const allLoans = Object.values(loansMap).flat();
		const repaymentEntries = await Promise.all(
			allLoans.map(
				async (l) => [l.id, await LoanRepaymentRepository.listForLoan(key, l.id)] as const
			)
		);
		setRepaymentsByLoan(Object.fromEntries(repaymentEntries));

		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function openRecordLoanDialog() {
		loanForm.reset({
			personName: '',
			direction: 'lent',
			principalAmount: '0',
			accountId: '',
			date: todayISO(),
			dueDate: '',
			notes: ''
		});
		setLoanDialogOpen(true);
	}

	/** Reuses an existing person (case-insensitive name match) or creates a new one — FR-001's
	 *  "either from a dedicated screen or inline while recording a loan". */
	async function resolvePerson(name: string): Promise<Person> {
		const trimmed = name.trim();
		const existing = people.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
		if (existing) return existing;
		return PersonRepository.create(key, { name: trimmed });
	}

	async function onSubmitLoan(values: LoanFormValues) {
		try {
			const person = await resolvePerson(values.personName);
			await PersonLoanRepository.create(key, {
				personId: person.id,
				direction: values.direction as LoanDirection,
				principalAmount: parseMoneyOrZero(values.principalAmount),
				date: values.date,
				dueDate: values.dueDate || null,
				notes: values.notes.trim() || null,
				accountId: values.accountId
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not record loan.');
			return;
		}
		setLoanDialogOpen(false);
		toast.success('Loan recorded');
		await refresh();
	}

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Users className="size-6 text-primary" />
					<h1 className="text-2xl font-semibold tracking-tight">People</h1>
				</div>
				<Dialog open={loanDialogOpen} onOpenChange={setLoanDialogOpen}>
					<DialogTrigger asChild>
						<Button onClick={openRecordLoanDialog}>
							<Plus /> Record a loan
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Record a loan</DialogTitle>
						</DialogHeader>
						<form className="flex flex-col gap-4" onSubmit={loanForm.handleSubmit(onSubmitLoan)}>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="loan-person">Person</Label>
								<Input
									id="loan-person"
									placeholder="Existing or new name"
									list="people-names"
									autoComplete="off"
									{...loanForm.register('personName')}
								/>
								<datalist id="people-names">
									{people.map((p) => (
										<option key={p.id} value={p.name} />
									))}
								</datalist>
								{loanForm.formState.errors.personName && (
									<p className="text-sm text-destructive">
										{loanForm.formState.errors.personName.message}
									</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="loan-direction">Direction</Label>
								<Controller
									control={loanForm.control}
									name="direction"
									render={({ field }) => (
										<Select value={field.value} onValueChange={field.onChange}>
											<SelectTrigger id="loan-direction" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="lent">I lent them money</SelectItem>
												<SelectItem value="borrowed">I borrowed money from them</SelectItem>
											</SelectContent>
										</Select>
									)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="loan-amount">Amount</Label>
								<Input
									id="loan-amount"
									type="number"
									step="0.01"
									{...loanForm.register('principalAmount')}
								/>
								{loanForm.formState.errors.principalAmount && (
									<p className="text-sm text-destructive">
										{loanForm.formState.errors.principalAmount.message}
									</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="loan-account">Account</Label>
								<Controller
									control={loanForm.control}
									name="accountId"
									render={({ field }) => (
										<Select value={field.value} onValueChange={field.onChange}>
											<SelectTrigger id="loan-account" className="w-full">
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
								{loanForm.formState.errors.accountId && (
									<p className="text-sm text-destructive">
										{loanForm.formState.errors.accountId.message}
									</p>
								)}
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="loan-date">Date</Label>
									<Input id="loan-date" type="date" {...loanForm.register('date')} />
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="loan-due-date">Due date (optional)</Label>
									<Input id="loan-due-date" type="date" {...loanForm.register('dueDate')} />
								</div>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="loan-notes">Notes (optional)</Label>
								<Input id="loan-notes" {...loanForm.register('notes')} />
							</div>
							<DialogFooter>
								<Button type="submit">Record loan</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : people.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<Users className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							No one you've lent to or borrowed from yet.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-4">
					{people.map((person) => (
						<PersonCard
							key={person.id}
							person={person}
							loans={loansByPerson[person.id] ?? []}
							repaymentsByLoan={repaymentsByLoan}
							accounts={accounts}
							onChanged={refresh}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function PersonCard({
	person,
	loans,
	repaymentsByLoan,
	accounts,
	onChanged
}: {
	person: Person;
	loans: PersonLoan[];
	repaymentsByLoan: Record<string, LoanRepayment[]>;
	accounts: Account[];
	onChanged: () => Promise<void>;
}) {
	const loansWithBalance = loans.map((loan) => ({
		loan,
		pendingBalance: computePendingBalance({
			principalAmount: loan.principalAmount,
			writeOffAmount: loan.writeOffAmount,
			repayments: repaymentsByLoan[loan.id] ?? []
		})
	}));
	const netPosition = computeNetPositionForPerson({
		loans: loansWithBalance.map(({ loan, pendingBalance }) => ({
			direction: loan.direction,
			pendingBalance
		}))
	});
	const hasOverdue = loansWithBalance.some(({ loan, pendingBalance }) =>
		isLoanOverdue({ dueDate: loan.dueDate, pendingBalance }, new Date())
	);

	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	async function onDeletePerson() {
		try {
			await PersonRepository.softDelete(key, person.id);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete this person.');
			return;
		}
		toast.success('Person deleted', {
			action: {
				label: 'Undo',
				onClick: () => {
					void PersonRepository.restore(key, person.id).then(onChanged);
				}
			}
		});
		await onChanged();
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
				<CardTitle className="text-base">{person.name}</CardTitle>
				<div className="flex items-center gap-2">
					{hasOverdue && <Badge variant="destructive">Overdue</Badge>}
					{netPosition !== 0 && (
						<span
							className={`font-mono text-sm ${netPosition > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
						>
							{netPosition > 0
								? `Owed to you: ${formatMoney(netPosition)}`
								: `You owe: ${formatMoney(-netPosition)}`}
						</span>
					)}
					<Button
						variant="ghost"
						size="icon"
						onClick={() => void onDeletePerson()}
						aria-label="Delete person"
					>
						<Trash2 className="size-4" />
					</Button>
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{loans.length === 0 ? (
					<p className="text-sm text-muted-foreground">No loans yet.</p>
				) : (
					loans.map((loan) => (
						<LoanRow
							key={loan.id}
							loan={loan}
							personName={person.name}
							repayments={repaymentsByLoan[loan.id] ?? []}
							accounts={accounts}
							onChanged={onChanged}
						/>
					))
				)}
			</CardContent>
		</Card>
	);
}

function LoanRow({
	loan,
	personName,
	repayments,
	accounts,
	onChanged
}: {
	loan: PersonLoan;
	personName: string;
	repayments: LoanRepayment[];
	accounts: Account[];
	onChanged: () => Promise<void>;
}) {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const confirm = useConfirm();
	const [repayDialogOpen, setRepayDialogOpen] = useState(false);
	const [settleDialogOpen, setSettleDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [settleAccountId, setSettleAccountId] = useState(loan.accountId);
	const [settleDate, setSettleDate] = useState(todayISO());
	const [editDueDate, setEditDueDate] = useState(loan.dueDate ?? '');
	const [editNotes, setEditNotes] = useState(loan.notes ?? '');

	const pendingBalance = computePendingBalance({
		principalAmount: loan.principalAmount,
		writeOffAmount: loan.writeOffAmount,
		repayments
	});
	const status = deriveLoanStatus({ pendingBalance, writeOffAt: loan.writeOffAt });
	const isLent = loan.direction === 'lent';

	const repayForm = useForm<RepaymentFormValues>({
		resolver: zodResolver(repaymentSchema),
		// Pre-filled with everything still owed: the common case is paying it all back, and
		// starting at "0" meant retyping a balance the screen was already showing (and an overshoot
		// by one digit was rejected as an overpayment).
		defaultValues: {
			amount: formatMinorUnits(pendingBalance),
			date: todayISO(),
			accountId: loan.accountId
		}
	});

	function openRepayDialog(open: boolean) {
		if (open) {
			repayForm.reset({
				amount: formatMinorUnits(pendingBalance),
				date: todayISO(),
				accountId: loan.accountId
			});
		}
		setRepayDialogOpen(open);
	}

	function openSettleDialog(open: boolean) {
		if (open) {
			setSettleAccountId(loan.accountId);
			setSettleDate(todayISO());
		}
		setSettleDialogOpen(open);
	}

	function openEditDialog(open: boolean) {
		if (open) {
			setEditDueDate(loan.dueDate ?? '');
			setEditNotes(loan.notes ?? '');
		}
		setEditDialogOpen(open);
	}

	async function onSubmitRepayment(values: RepaymentFormValues) {
		try {
			await LoanRepaymentRepository.create(key, {
				loanId: loan.id,
				amount: parseMoneyOrZero(values.amount),
				date: values.date,
				accountId: values.accountId
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not log repayment.');
			return;
		}
		setRepayDialogOpen(false);
		toast.success('Repayment logged');
		await onChanged();
	}

	async function onSettle() {
		try {
			await LoanRepaymentRepository.settle(key, {
				loanId: loan.id,
				date: settleDate,
				accountId: settleAccountId
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not settle this loan.');
			return;
		}
		setSettleDialogOpen(false);
		toast.success(
			isLent ? `${personName} has paid you back in full` : `Paid back ${personName} in full`
		);
		await onChanged();
	}

	async function onSaveEdit() {
		try {
			await PersonLoanRepository.update(key, loan.id, {
				dueDate: editDueDate || null,
				notes: editNotes.trim() || null
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save changes.');
			return;
		}
		setEditDialogOpen(false);
		toast.success('Loan updated');
		await onChanged();
	}

	async function onUndoRepayment(repaymentId: string) {
		await LoanRepaymentRepository.softDelete(key, repaymentId);
		toast.success('Repayment undone');
		await onChanged();
	}

	async function onRemoveLoan() {
		if (
			!(await confirm({
				message: `Remove this loan? It, its repayments and the money movement behind them go to Trash, and the account balance goes back to what it was before. Use this to fix a loan recorded with the wrong amount, date or account.`,
				confirmLabel: 'Remove loan',
				destructive: true
			}))
		) {
			return;
		}
		let removedRepaymentIds: string[];
		try {
			({ removedRepaymentIds } = await PersonLoanRepository.remove(key, loan.id));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not remove this loan.');
			return;
		}
		toast.success('Loan removed', {
			action: {
				label: 'Undo',
				// Brings back the loan AND the repayments that were removed with it; otherwise the loan
				// reappears as if nothing had ever been paid back.
				onClick: () => {
					void (async () => {
						await PersonLoanRepository.restore(key, loan.id);
						for (const repaymentId of removedRepaymentIds) {
							await LoanRepaymentRepository.restore(key, repaymentId);
						}
					})()
						.then(onChanged)
						.catch((err: unknown) =>
							toast.error(err instanceof Error ? err.message : 'Could not undo.')
						);
				}
			}
		});
		await onChanged();
	}

	async function onWriteOff() {
		// Writing off is a one-way decision (no "undo write-off" exists) — once written off,
		// the loan is settled and this action disappears entirely.
		if (
			!(await confirm({
				message: `Write off the remaining ${formatMoney(pendingBalance)} on this loan? This forgives the debt and cannot be undone.`,
				confirmLabel: 'Write off',
				destructive: true
			}))
		) {
			return;
		}
		try {
			await PersonLoanRepository.writeOff(key, loan.id);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not write off this loan.');
			return;
		}
		toast.success('Loan written off');
		await onChanged();
	}

	const accountPicker = (value: string, onChange: (v: string) => void, id: string) => (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger id={id} className="w-full">
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
	);

	return (
		<div className="flex flex-col gap-1 border-t pt-3 first:border-t-0 first:pt-0">
			<div className="flex items-center justify-between text-sm">
				<span>
					{isLent ? 'Lent' : 'Borrowed'}
					<span className="ml-1.5 text-xs text-muted-foreground">on {loan.date}</span>
				</span>
				<div className="flex items-center gap-2">
					{status === 'open' && <Badge variant="secondary">Open</Badge>}
					{status === 'settled-by-repayment' && <Badge>Settled</Badge>}
					{status === 'settled-by-writeoff' && <Badge variant="outline">Written off</Badge>}
				</div>
			</div>
			<div className="flex items-baseline justify-between text-sm">
				<span className="font-mono">{formatMoney(pendingBalance)}</span>
				<span className="text-muted-foreground">of {formatMoney(loan.principalAmount)}</span>
			</div>
			{loan.dueDate && (
				<p className="text-xs text-muted-foreground">
					Due {loan.dueDate}
					{isLoanOverdue({ dueDate: loan.dueDate, pendingBalance }, new Date()) && (
						<span className="ml-1 text-destructive">(overdue)</span>
					)}
				</p>
			)}
			{loan.notes && <p className="text-xs text-muted-foreground">{loan.notes}</p>}

			{repayments.length > 0 && (
				<ul className="flex flex-col gap-1">
					{repayments
						.slice()
						.sort((a, b) => (a.date < b.date ? 1 : -1))
						.map((r) => (
							<li
								key={r.id}
								className="flex items-center justify-between text-xs text-muted-foreground"
							>
								<span>
									{r.date} · {formatMoney(r.amount)} {isLent ? 'received' : 'paid back'}
								</span>
								<Button
									variant="link"
									size="sm"
									className="h-auto p-0 text-xs"
									onClick={() => void onUndoRepayment(r.id)}
								>
									Undo
								</Button>
							</li>
						))}
				</ul>
			)}

			{status === 'open' && (
				<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
					<Button
						variant="outline"
						size="sm"
						className="h-7"
						onClick={() => openSettleDialog(true)}
					>
						Settle in full
					</Button>

					<Dialog open={settleDialogOpen} onOpenChange={openSettleDialog}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>
									{isLent
										? `Collect ${formatMoney(pendingBalance)} from ${personName}`
										: `Pay back ${formatMoney(pendingBalance)} to ${personName}`}
								</DialogTitle>
							</DialogHeader>
							<div className="flex flex-col gap-4">
								<p className="text-sm text-muted-foreground">
									{isLent
										? `Records that ${personName} paid back everything still owed (${formatMoney(pendingBalance)}). The money is added to the account below and the loan is marked settled.`
										: `Records that you paid ${personName} back everything still owed (${formatMoney(pendingBalance)}). The money is taken from the account below and the loan is marked settled.`}
								</p>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor={`settle-account-${loan.id}`}>
										{isLent ? 'Received into' : 'Paid from'}
									</Label>
									{accountPicker(settleAccountId, setSettleAccountId, `settle-account-${loan.id}`)}
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor={`settle-date-${loan.id}`}>Date</Label>
									<Input
										id={`settle-date-${loan.id}`}
										type="date"
										value={settleDate}
										onChange={(e) => setSettleDate(e.target.value)}
									/>
								</div>
							</div>
							<DialogFooter>
								<Button onClick={() => void onSettle()} disabled={!settleAccountId}>
									Settle loan
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>

					<Dialog open={repayDialogOpen} onOpenChange={openRepayDialog}>
						<DialogTrigger asChild>
							<Button variant="link" size="sm" className="h-auto w-fit p-0">
								Log repayment
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Log a repayment</DialogTitle>
							</DialogHeader>
							<form
								className="flex flex-col gap-4"
								onSubmit={repayForm.handleSubmit(onSubmitRepayment)}
							>
								<p className="text-sm text-muted-foreground">
									{isLent
										? `Part of what ${personName} owes you. ${formatMoney(pendingBalance)} is still outstanding.`
										: `Part of what you owe ${personName}. ${formatMoney(pendingBalance)} is still outstanding.`}
								</p>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor={`repay-amount-${loan.id}`}>Amount</Label>
									<Input
										id={`repay-amount-${loan.id}`}
										type="number"
										step="0.01"
										{...repayForm.register('amount')}
									/>
									{repayForm.formState.errors.amount && (
										<p className="text-sm text-destructive">
											{repayForm.formState.errors.amount.message}
										</p>
									)}
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor={`repay-date-${loan.id}`}>Date</Label>
									<Input id={`repay-date-${loan.id}`} type="date" {...repayForm.register('date')} />
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor={`repay-account-${loan.id}`}>
										{isLent ? 'Received into' : 'Paid from'}
									</Label>
									<Controller
										control={repayForm.control}
										name="accountId"
										render={({ field }) =>
											accountPicker(field.value, field.onChange, `repay-account-${loan.id}`)
										}
									/>
								</div>
								<DialogFooter>
									<Button type="submit">Log repayment</Button>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>

					<Dialog open={editDialogOpen} onOpenChange={openEditDialog}>
						<DialogTrigger asChild>
							<Button variant="link" size="sm" className="h-auto w-fit p-0 text-muted-foreground">
								Edit details
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Edit loan details</DialogTitle>
							</DialogHeader>
							<div className="flex flex-col gap-4">
								<p className="text-xs text-muted-foreground">
									The amount, date, account and direction can't be edited once the money has moved.
									To fix one of those, remove this loan (below) and record it again.
								</p>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor={`edit-due-${loan.id}`}>Due date (optional)</Label>
									<Input
										id={`edit-due-${loan.id}`}
										type="date"
										value={editDueDate}
										onChange={(e) => setEditDueDate(e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor={`edit-notes-${loan.id}`}>Notes (optional)</Label>
									<Input
										id={`edit-notes-${loan.id}`}
										value={editNotes}
										onChange={(e) => setEditNotes(e.target.value)}
									/>
								</div>
							</div>
							<DialogFooter>
								<Button onClick={() => void onSaveEdit()}>Save</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>

					<Button
						variant="link"
						size="sm"
						className="h-auto w-fit p-0 text-muted-foreground"
						onClick={onWriteOff}
					>
						Write off
					</Button>
					<Button
						variant="link"
						size="sm"
						className="h-auto w-fit p-0 text-muted-foreground"
						onClick={() => void onRemoveLoan()}
					>
						Remove loan
					</Button>
				</div>
			)}
			{status !== 'open' && (
				<div className="mt-1">
					<Button
						variant="link"
						size="sm"
						className="h-auto w-fit p-0 text-muted-foreground"
						onClick={() => void onRemoveLoan()}
					>
						Remove loan
					</Button>
				</div>
			)}
		</div>
	);
}
