import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button';
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
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import { formatTransactionLabel } from '../domain/transactions/transactionLabel';
import type { Account, Merchant, Transaction } from '../domain/entities';
import { formatMoney } from '../domain/shared/money';

const CREATE_NEW = '__create__';

/**
 * "This is really a movement between my own accounts" — turns an income/expense entry (typically
 * a credit-card bill payment that arrived via import, SMS or Quick Add as a plain expense) into
 * one leg of a linked transfer. Offers to LINK to the matching entry already on the other account
 * (found by amount + date) before offering to create it, so importing both the bank and the card
 * statement never ends up counting one payment twice.
 */
export function ConvertToTransferDialog({
	transaction,
	accounts,
	merchants,
	suggestedAccountId,
	onOpenChange,
	onConverted
}: {
	transaction: Transaction | null;
	accounts: Account[];
	merchants: Merchant[];
	/** An account worth pre-selecting for "create the matching entry in…" (e.g. the card whose
	 *  number appeared in the message). Never applied silently — the user still presses Convert. */
	suggestedAccountId?: string | null;
	onOpenChange: (open: boolean) => void;
	onConverted: () => void;
}) {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [candidates, setCandidates] = useState<Transaction[]>([]);
	const [loading, setLoading] = useState(false);
	const [choice, setChoice] = useState<string>(CREATE_NEW);
	const [accountId, setAccountId] = useState('');
	const [saving, setSaving] = useState(false);

	const txId = transaction?.id ?? null;
	useEffect(() => {
		if (!txId) return;
		let cancelled = false;
		setLoading(true);
		setChoice(CREATE_NEW);
		setAccountId(suggestedAccountId ?? '');
		TransactionEngine.findTransferCandidates(key, txId)
			.then((found) => {
				if (cancelled) return;
				setCandidates(found);
				// An existing matching entry is by far the likelier intent — pre-select it.
				if (found.length > 0) setChoice(found[0].id);
			})
			.catch(() => {
				if (!cancelled) setCandidates([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [txId]);

	if (!transaction) return null;

	const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Unknown account';
	const otherAccounts = accounts.filter((a) => a.id !== transaction.accountId);
	const leaving = transaction.amount < 0;
	const canSubmit = choice !== CREATE_NEW || accountId !== '';

	async function submit() {
		if (!transaction) return;
		setSaving(true);
		try {
			await TransactionEngine.convertToTransfer(
				key,
				transaction.id,
				choice === CREATE_NEW ? { accountId } : { transactionId: choice }
			);
			toast.success('Recorded as a transfer');
			onOpenChange(false);
			onConverted();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not convert this transaction.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Record as a transfer</DialogTitle>
					<DialogDescription>
						{leaving
							? `${formatMoney(-transaction.amount)} left ${accountName(transaction.accountId)}. If it went to another one of your own accounts — a credit card bill, a savings account — record it as a transfer so it isn't counted as spending and the other account's balance updates too.`
							: `${formatMoney(transaction.amount)} arrived in ${accountName(transaction.accountId)}. If it came from another one of your own accounts, record it as a transfer so it isn't counted as income and the other account's balance updates too.`}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					{loading ? (
						<p className="text-sm text-muted-foreground">Looking for a matching entry…</p>
					) : (
						candidates.length > 0 && (
							<fieldset className="flex flex-col gap-1.5">
								<legend className="mb-1 text-xs text-muted-foreground">
									Already recorded on another account — link to it:
								</legend>
								{candidates.map((candidate) => (
									<label
										key={candidate.id}
										className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
									>
										<input
											type="radio"
											name="transfer-target"
											className="mt-1"
											checked={choice === candidate.id}
											onChange={() => setChoice(candidate.id)}
										/>
										<span>
											{accountName(candidate.accountId)} · {candidate.date} ·{' '}
											{formatMoney(candidate.amount)}
											<span className="block text-xs text-muted-foreground">
												{formatTransactionLabel(candidate, merchants)}
											</span>
										</span>
									</label>
								))}
							</fieldset>
						)
					)}

					<label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
						<input
							type="radio"
							name="transfer-target"
							className="mt-1"
							checked={choice === CREATE_NEW}
							onChange={() => setChoice(CREATE_NEW)}
						/>
						<span className="flex-1">
							{candidates.length > 0
								? 'Not any of those — create the matching entry in:'
								: leaving
									? 'Create the matching entry — money went to:'
									: 'Create the matching entry — money came from:'}
						</span>
					</label>
					{choice === CREATE_NEW && (
						<div className="flex flex-col gap-1.5 pl-6">
							<Label htmlFor="transfer-counterpart">Other account</Label>
							<Select value={accountId} onValueChange={setAccountId}>
								<SelectTrigger id="transfer-counterpart" className="w-full">
									<SelectValue placeholder="Choose account…" />
								</SelectTrigger>
								<SelectContent>
									{otherAccounts.map((a) => (
										<SelectItem key={a.id} value={a.id}>
											{a.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => void submit()} disabled={!canSubmit || saving}>
						{saving ? 'Converting…' : 'Record as transfer'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
