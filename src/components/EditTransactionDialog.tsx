import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
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
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID,
	type SplitInput,
	type TransactionLink
} from '../data/dexie/transactionRepository';
import { TagRepository, TransactionTagRepository } from '../data/dexie/tagRepository';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import { linkedTransactionNotice } from '../domain/transactions/linkedTransactionNotice';
import { resolveMerchant } from '../domain/parser/merchantResolver';
import { recordConfirmation } from '../domain/categorization/resolveCategorization';
import { formatMinorUnits, isPositiveMoney, parseMoneyOrZero } from '../domain/shared/money';
import type {
	Account,
	Category,
	Merchant,
	Transaction,
	TransactionSplit
} from '../domain/entities';
import { categoryOptions } from '../domain/categories/categoryHierarchy';

type Kind = 'loading' | 'regular' | 'transfer' | 'loan';

/**
 * Edit an existing transaction. Until this existed the only things a user could do to a wrong
 * entry were delete it and type it again — there was no way to fix a category, a date, a merchant
 * or a typo in an amount in place, and no way at all to correct what auto-categorization got
 * wrong. Three kinds of entry are handled differently on purpose:
 *
 *  - an ordinary income/expense: every field is editable;
 *  - one leg of a transfer: date, amount and notes only, applied to BOTH legs together (editing a
 *    single leg would silently unbalance the two accounts);
 *  - the ledger movement behind a person loan or repayment: read-only here, because changing it
 *    would make the loan's pending balance disagree with the ledger — it is managed from People.
 */
export function EditTransactionDialog({
	transaction,
	accounts,
	categories,
	merchants,
	onOpenChange,
	onSaved,
	onRecordAsTransfer
}: {
	transaction: Transaction;
	accounts: Account[];
	categories: Category[];
	merchants: Merchant[];
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
	onRecordAsTransfer: (transaction: Transaction) => void;
}) {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [kind, setKind] = useState<Kind>('loading');
	const [link, setLink] = useState<TransactionLink | null>(null);
	const [originalSplits, setOriginalSplits] = useState<TransactionSplit[]>([]);
	const [originalTagNames, setOriginalTagNames] = useState('');
	const [saving, setSaving] = useState(false);

	const currentMerchantName = transaction.merchantId
		? (merchants.find((m) => m.id === transaction.merchantId)?.name ?? '')
		: '';

	const [accountId, setAccountId] = useState(transaction.accountId);
	const [type, setType] = useState<'expense' | 'income'>(
		transaction.amount < 0 ? 'expense' : 'income'
	);
	const [amount, setAmount] = useState(formatMinorUnits(Math.abs(transaction.amount)));
	const [date, setDate] = useState(transaction.date);
	const [merchantText, setMerchantText] = useState(currentMerchantName);
	const [categoryId, setCategoryId] = useState(UNCATEGORIZED_CATEGORY_ID);
	const [tagsText, setTagsText] = useState('');
	const [notes, setNotes] = useState(transaction.notes ?? '');

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const [loanLink, splits, tagIds, allTags] = await Promise.all([
					TransactionRepository.getLoanLink(key, transaction.id),
					TransactionRepository.getSplits(key, transaction.id),
					TransactionTagRepository.getTagIds(transaction.id),
					TagRepository.list(key)
				]);
				if (cancelled) return;
				setOriginalSplits(splits);
				const names = tagIds
					.map((id) => allTags.find((t) => t.id === id)?.name)
					.filter((name): name is string => Boolean(name))
					.join(', ');
				setOriginalTagNames(names);
				setTagsText(names);
				setCategoryId(splits[0]?.categoryId ?? UNCATEGORIZED_CATEGORY_ID);
				setLink(loanLink);
				if (loanLink) setKind('loan');
				else if (transaction.type === 'transfer' && transaction.transferPairId) setKind('transfer');
				else setKind('regular');
			} catch (err) {
				if (!cancelled) {
					toast.error(err instanceof Error ? err.message : 'Could not load this transaction.');
					onOpenChange(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [transaction.id]);

	const isSplit = originalSplits.length > 1;
	const amountValid = isPositiveMoney(amount);

	async function save() {
		if (!amountValid) {
			toast.error('Enter a positive amount.');
			return;
		}
		setSaving(true);
		try {
			if (kind === 'transfer') {
				await TransactionEngine.editTransferPair(key, transaction.id, {
					date,
					amount: parseMoneyOrZero(amount),
					notes: notes.trim() || null
				});
			} else {
				const magnitude = parseMoneyOrZero(amount);
				const signed = type === 'expense' ? -magnitude : magnitude;

				// Only look the merchant up again if the user actually changed the text.
				let merchantId = transaction.merchantId;
				if (merchantText.trim() !== currentMerchantName) {
					merchantId = merchantText.trim()
						? (await resolveMerchant(key, merchantText.trim())).merchantId
						: null;
				}

				const categoryChanged =
					categoryId !== (originalSplits[0]?.categoryId ?? UNCATEGORIZED_CATEGORY_ID);
				let splits: SplitInput[] | undefined;
				if (!isSplit) {
					splits = [
						{
							categoryId,
							amount: signed,
							categorizationSource: categoryChanged
								? undefined
								: originalSplits[0]?.categorizationSource
						}
					];
				} else if (signed !== transaction.amount) {
					throw new Error(
						"This transaction is split across several categories, so its amount can't be changed here. Edit the other fields, or delete it and enter it again."
					);
				}

				await TransactionEngine.editTransaction(
					key,
					transaction.id,
					{ accountId, date, amount: signed, type, merchantId, notes: notes.trim() || null },
					splits
				);

				if (tagsText.trim() !== originalTagNames.trim()) {
					const names = tagsText
						.split(',')
						.map((t) => t.trim())
						.filter(Boolean);
					const tags = await Promise.all(names.map((n) => TagRepository.getOrCreate(key, n)));
					await TransactionTagRepository.setTags(
						transaction.id,
						tags.map((t) => t.id)
					);
				}

				// Correcting a category by hand is the strongest learning signal there is.
				if (!isSplit && categoryChanged && categoryId !== UNCATEGORIZED_CATEGORY_ID && merchantId) {
					await recordConfirmation(key, merchantId, categoryId);
				}
			}
			toast.success('Transaction updated');
			onOpenChange(false);
			onSaved();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save changes.');
		} finally {
			setSaving(false);
		}
	}

	const selectableAccounts = accounts.filter(
		(a) => !a.isArchived || a.id === transaction.accountId
	);

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Edit transaction</DialogTitle>
					<DialogDescription>
						{kind === 'transfer'
							? 'This is one side of a transfer. Changes apply to both sides together.'
							: kind === 'loan'
								? 'This entry belongs to a loan or liability record.'
								: 'Changes update the account balance and reports straight away.'}
					</DialogDescription>
				</DialogHeader>

				{kind === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}

				{kind === 'loan' && link && (
					<div className="flex flex-col gap-3 text-sm">
						<p>
							{link.kind === 'liability-payment'
								? "A payment toward a loan or card is tracked on the Liabilities page, and its amount and date can't be edited here without the balance owed no longer matching your accounts."
								: "Money lent, borrowed or paid back is tracked on the People page, and its amount and date can't be edited here without the loan's balance no longer matching your accounts."}
						</p>
						<p className="text-muted-foreground">
							{link.kind === 'liability-payment' ? (
								<>
									To fix it, open Liabilities and use <strong>Undo</strong> on the payment, then
									record it again.
								</>
							) : (
								<>
									To fix it, open People and use <strong>Remove loan</strong> (or{' '}
									<strong>Undo</strong> on a repayment), then record it again.
								</>
							)}
						</p>
						<DialogFooter>
							<Button asChild>
								<Link to={linkedTransactionNotice(link).to}>
									{linkedTransactionNotice(link).linkLabel}
								</Link>
							</Button>
						</DialogFooter>
					</div>
				)}

				{(kind === 'regular' || kind === 'transfer') && (
					<form
						className="flex flex-col gap-4"
						onSubmit={(e) => {
							e.preventDefault();
							void save();
						}}
					>
						{kind === 'regular' && (
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="edit-tx-account">Account</Label>
									<Select value={accountId} onValueChange={setAccountId}>
										<SelectTrigger id="edit-tx-account" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{selectableAccounts.map((a) => (
												<SelectItem key={a.id} value={a.id}>
													{a.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="edit-tx-type">Type</Label>
									<Select value={type} onValueChange={(v) => setType(v as 'expense' | 'income')}>
										<SelectTrigger id="edit-tx-type" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="expense">Expense</SelectItem>
											<SelectItem value="income">Income</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
						)}

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="edit-tx-amount">Amount</Label>
								<Input
									id="edit-tx-amount"
									type="number"
									step="0.01"
									value={amount}
									disabled={kind === 'regular' && isSplit}
									onChange={(e) => setAmount(e.target.value)}
								/>
								{kind === 'regular' && isSplit && (
									<p className="text-xs text-muted-foreground">
										Split across {originalSplits.length} categories — the amount can't be changed
										here.
									</p>
								)}
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="edit-tx-date">Date</Label>
								<Input
									id="edit-tx-date"
									type="date"
									value={date}
									onChange={(e) => setDate(e.target.value)}
								/>
							</div>
						</div>

						{kind === 'regular' && (
							<>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="edit-tx-category">Category</Label>
									<Select value={categoryId} onValueChange={setCategoryId} disabled={isSplit}>
										<SelectTrigger id="edit-tx-category" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={UNCATEGORIZED_CATEGORY_ID}>Uncategorized</SelectItem>
											{categoryOptions(categories).map(({ id, label }) => (
												<SelectItem key={id} value={id}>
													{label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									{isSplit && (
										<p className="text-xs text-muted-foreground">
											This entry is split across several categories.
										</p>
									)}
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="edit-tx-merchant">Merchant</Label>
									<Input
										id="edit-tx-merchant"
										value={merchantText}
										onChange={(e) => setMerchantText(e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="edit-tx-tags">Tags (comma-separated)</Label>
									<Input
										id="edit-tx-tags"
										value={tagsText}
										onChange={(e) => setTagsText(e.target.value)}
									/>
								</div>
							</>
						)}

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="edit-tx-notes">Notes</Label>
							<Textarea
								id="edit-tx-notes"
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
							/>
						</div>

						<DialogFooter className="sm:justify-between">
							{kind === 'regular' ? (
								<Button
									type="button"
									variant="ghost"
									onClick={() => {
										onOpenChange(false);
										onRecordAsTransfer(transaction);
									}}
								>
									<ArrowRightLeft /> Record as transfer instead
								</Button>
							) : (
								<span />
							)}
							<div className="flex gap-2">
								<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
									Cancel
								</Button>
								<Button type="submit" disabled={saving || !amountValid}>
									{saving ? 'Saving…' : 'Save changes'}
								</Button>
							</div>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
