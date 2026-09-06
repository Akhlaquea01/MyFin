import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
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
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import { resolveMerchant } from '../domain/parser/merchantResolver';
import { parseQuickAddText, isConfident } from '../domain/parser/quickAddParser';
import type { Account, TransactionType } from '../domain/entities';

// User Story 4 (P4): paste a payment-notification-style text and get a proposed,
// reviewable transaction (FR-018). Low-confidence text still routes here for manual
// completion (FR-021) rather than being silently dropped.
export function QuickAddPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const navigate = useNavigate();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [rawText, setRawText] = useState('');
	const [parsed, setParsed] = useState(false);
	const [confident, setConfident] = useState(true);
	const [accountId, setAccountId] = useState('');
	const [type, setType] = useState<TransactionType>('expense');
	const [amountInput, setAmountInput] = useState('');
	const [merchantName, setMerchantName] = useState('');
	const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		void AccountRepository.list(key, false).then(setAccounts);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function handleParse() {
		const candidate = parseQuickAddText(rawText);
		setParsed(true);
		setConfident(isConfident(candidate));
		if (candidate.amount !== null) setAmountInput((candidate.amount / 100).toString());
		if (candidate.type) setType(candidate.type);
		if (candidate.merchantText) setMerchantName(candidate.merchantText);
	}

	async function handleConfirm() {
		if (!accountId || !amountInput) {
			toast.error('Choose an account and enter an amount.');
			return;
		}
		setSubmitting(true);
		try {
			const amount = Math.round(parseFloat(amountInput) * 100);
			const signedAmount = type === 'expense' ? -amount : amount;
			const resolved = merchantName.trim()
				? await resolveMerchant(key, merchantName.trim())
				: null;
			await TransactionEngine.recordTransaction(key, {
				accountId,
				date,
				amount: signedAmount,
				type,
				merchantId: resolved?.merchantId ?? null,
				merchantAliasId: resolved?.aliasId ?? null,
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			});
			toast.success('Transaction added to your review queue');
			navigate('/review');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save transaction.');
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Quick Add</h1>

			<Card className="mb-6">
				<CardContent className="flex flex-col gap-3 pt-6">
					<Label htmlFor="raw-text">Paste a payment notification</Label>
					<Textarea
						id="raw-text"
						rows={3}
						placeholder="e.g. Rs.500.00 debited from A/c XX1234 to AMAZON"
						value={rawText}
						onChange={(e) => setRawText(e.target.value)}
					/>
					<Button type="button" onClick={handleParse} disabled={!rawText.trim()}>
						<Sparkles /> Parse
					</Button>
				</CardContent>
			</Card>

			{parsed && (
				<Card>
					<CardContent className="flex flex-col gap-4 pt-6">
						{!confident && (
							<p className="text-sm text-amber-600 dark:text-amber-400">
								Couldn't confidently read that message — please fill in the details below.
							</p>
						)}
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="qa-account">Account</Label>
								<Select value={accountId} onValueChange={setAccountId}>
									<SelectTrigger id="qa-account" className="w-full">
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
								<Label htmlFor="qa-type">Type</Label>
								<Select value={type} onValueChange={(v) => setType(v as TransactionType)}>
									<SelectTrigger id="qa-type" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="expense">Expense</SelectItem>
										<SelectItem value="income">Income</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="qa-amount">Amount</Label>
								<Input
									id="qa-amount"
									type="number"
									step="0.01"
									value={amountInput}
									onChange={(e) => setAmountInput(e.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="qa-date">Date</Label>
								<Input
									id="qa-date"
									type="date"
									value={date}
									onChange={(e) => setDate(e.target.value)}
								/>
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="qa-merchant">Merchant</Label>
							<Input
								id="qa-merchant"
								value={merchantName}
								onChange={(e) => setMerchantName(e.target.value)}
							/>
						</div>
						<Button onClick={handleConfirm} disabled={submitting}>
							{submitting ? 'Saving…' : 'Confirm & add to review queue'}
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
