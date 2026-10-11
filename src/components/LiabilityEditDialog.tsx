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
import { useSession } from '../context/SessionContext';
import { LiabilityRepository } from '../data/dexie/wealthRepository';
import {
	formatMinorUnits,
	isNonNegativeMoney,
	parseMoneyOrZero,
	parseMoneyToMinorUnits
} from '../domain/shared/money';
import type { Liability } from '../domain/entities';

/** A blank optional money field is "not set"; anything else must be a valid non-negative amount. */
function optionalMoney(raw: string): number | null | 'invalid' {
	if (!raw.trim()) return null;
	return isNonNegativeMoney(raw) ? parseMoneyOrZero(raw) : 'invalid';
}

/**
 * Edit a liability after it has been created. Until now the only way to change a loan's balance,
 * EMI or rate was to delete it and add it again — and nothing else could keep the balance in step
 * with what is actually still owed. (Recording a payment is the better way to bring the balance
 * down, because it also moves the money; this is for correcting the details themselves.)
 */
export function LiabilityEditDialog({
	liability,
	onOpenChange,
	onSaved
}: {
	liability: Liability;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}) {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [name, setName] = useState(liability.name);
	const [balance, setBalance] = useState(formatMinorUnits(liability.outstandingBalance));
	const [emi, setEmi] = useState(
		liability.emiAmount !== null ? formatMinorUnits(liability.emiAmount) : ''
	);
	const [dueDay, setDueDay] = useState(
		liability.emiDueDay !== null ? String(liability.emiDueDay) : ''
	);
	// Stored in basis points (1850 = 18.50%), shown as a percentage — the same convention the
	// Debt Payoff Planner uses for the same field.
	const [rate, setRate] = useState(
		liability.interestRate !== null ? formatMinorUnits(liability.interestRate) : ''
	);
	const [minimum, setMinimum] = useState(
		liability.minimumPayment !== null ? formatMinorUnits(liability.minimumPayment) : ''
	);
	const [saving, setSaving] = useState(false);

	async function save() {
		const trimmedName = name.trim();
		if (!trimmedName) return toast.error('Name is required.');
		if (!isNonNegativeMoney(balance || '0')) return toast.error('Enter a valid balance.');
		const emiAmount = optionalMoney(emi);
		const minimumPayment = optionalMoney(minimum);
		if (emiAmount === 'invalid') return toast.error('Enter a valid EMI amount, or leave it blank.');
		if (minimumPayment === 'invalid') {
			return toast.error('Enter a valid minimum payment, or leave it blank.');
		}
		let emiDueDay: number | null = null;
		if (dueDay.trim()) {
			const day = Number(dueDay);
			if (!Number.isInteger(day) || day < 1 || day > 31) {
				return toast.error('The EMI due day must be between 1 and 31.');
			}
			emiDueDay = day;
		}
		let interestRate: number | null = null;
		if (rate.trim()) {
			const basisPoints = parseMoneyToMinorUnits(rate);
			if (basisPoints === null || basisPoints < 0) {
				return toast.error('Enter the interest rate as a percentage, e.g. 8.5.');
			}
			interestRate = basisPoints;
		}

		setSaving(true);
		try {
			await LiabilityRepository.update(key, liability.id, {
				name: trimmedName,
				outstandingBalance: parseMoneyOrZero(balance || '0'),
				emiAmount,
				emiDueDay,
				interestRate,
				minimumPayment
			});
			toast.success(`${trimmedName} updated`);
			onOpenChange(false);
			onSaved();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save changes.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Edit {liability.type === 'loan' ? 'loan' : 'card'} details</DialogTitle>
					<DialogDescription>
						To record money you have paid toward this, use <strong>Record payment</strong> instead —
						it also takes the money out of your account.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="liability-edit-name">Name</Label>
						<Input
							id="liability-edit-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="liability-edit-balance">Amount still owed</Label>
							<Input
								id="liability-edit-balance"
								type="number"
								step="0.01"
								value={balance}
								onChange={(e) => setBalance(e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="liability-edit-rate">Interest rate % per year (optional)</Label>
							<Input
								id="liability-edit-rate"
								type="number"
								step="0.01"
								placeholder="e.g. 8.5"
								value={rate}
								onChange={(e) => setRate(e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="liability-edit-emi">EMI amount (optional)</Label>
							<Input
								id="liability-edit-emi"
								type="number"
								step="0.01"
								value={emi}
								onChange={(e) => setEmi(e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="liability-edit-due-day">EMI due day of month (optional)</Label>
							<Input
								id="liability-edit-due-day"
								type="number"
								min={1}
								max={31}
								value={dueDay}
								onChange={(e) => setDueDay(e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="liability-edit-minimum">Minimum payment (optional)</Label>
							<Input
								id="liability-edit-minimum"
								type="number"
								step="0.01"
								value={minimum}
								onChange={(e) => setMinimum(e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving…' : 'Save changes'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
