import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useSession } from '../context/SessionContext';
import { recordLiabilityPayment } from '../domain/wealth/wealthEngine';
import { formatMinorUnits, isPositiveMoney, parseMoneyOrZero, formatMoney } from '../domain/shared/money';
import { todayLocalISO } from '../domain/shared/dateMath';
import type { Account, Category, Liability } from '../domain/entities';
import { categoryOptions } from '../domain/categories/categoryHierarchy';

const NO_CATEGORY = '__none__';

/**
 * "I paid this month's EMI." One action: the money leaves the chosen account AND the amount still
 * owed comes down — see `recordLiabilityPayment`. Replaces entering the payment as an expense by
 * hand and then separately remembering to edit the loan's balance.
 */
export function LiabilityPaymentDialog({
	liability,
	accounts,
	categories,
	onOpenChange,
	onRecorded
}: {
	liability: Liability;
	/** Accounts the payment can come from — never a credit card. */
	accounts: Account[];
	categories: Category[];
	onOpenChange: (open: boolean) => void;
	onRecorded: () => void;
}) {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	// An EMI is the usual payment, so start from it — but never from more than is owed.
	const suggested =
		liability.emiAmount !== null && liability.emiAmount > 0
			? Math.min(liability.emiAmount, liability.outstandingBalance)
			: liability.outstandingBalance;
	const [amount, setAmount] = useState(formatMinorUnits(suggested));
	const [date, setDate] = useState(todayLocalISO());
	const [accountId, setAccountId] = useState('');
	const [categoryId, setCategoryId] = useState(NO_CATEGORY);
	const [saving, setSaving] = useState(false);

	async function submit() {
		if (!isPositiveMoney(amount)) return toast.error('Enter a positive amount.');
		if (!accountId) return toast.error('Choose the account you paid from.');
		setSaving(true);
		try {
			await recordLiabilityPayment(key, {
				liabilityId: liability.id,
				amount: parseMoneyOrZero(amount),
				date,
				accountId,
				categoryId: categoryId === NO_CATEGORY ? null : categoryId
			});
			toast.success(`Payment recorded — ${liability.name} updated`);
			onOpenChange(false);
			onRecorded();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not record the payment.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Record a payment — {liability.name}</DialogTitle>
					<DialogDescription>
						{formatMoney(liability.outstandingBalance)} is still owed. The payment is taken from the
						account you choose and the amount owed goes down by the same amount.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						void submit();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="liability-pay-amount">Amount paid</Label>
						<Input
							id="liability-pay-amount"
							type="number"
							step="0.01"
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							<button
								type="button"
								className="underline underline-offset-2"
								onClick={() => setAmount(formatMinorUnits(liability.outstandingBalance))}
							>
								Pay the full balance
							</button>
						</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="liability-pay-date">Date</Label>
						<Input
							id="liability-pay-date"
							type="date"
							value={date}
							onChange={(e) => setDate(e.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="liability-pay-account">Paid from</Label>
						<Select value={accountId} onValueChange={setAccountId}>
							<SelectTrigger id="liability-pay-account" className="w-full">
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
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="liability-pay-category">Category (optional)</Label>
						<Select value={categoryId} onValueChange={setCategoryId}>
							<SelectTrigger id="liability-pay-category" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={NO_CATEGORY}>None</SelectItem>
								{categoryOptions(categories).map(({ id, label }) => (
									<SelectItem key={id} value={id}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving || accounts.length === 0}>
							{saving ? 'Recording…' : 'Record payment'}
						</Button>
					</DialogFooter>
					{accounts.length === 0 && (
						<p className="text-xs text-muted-foreground">
							Add a bank, cash or wallet account first — a payment has to come from one.
						</p>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
