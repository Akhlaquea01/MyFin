import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { findCardMatches, type CardMatch } from '../domain/parser/cardIdentifierMatcher';
import type { Account, TransactionType } from '../domain/entities';
import { formatMinorUnits, parseMoneyToMinorUnits } from '../domain/shared/money';

// User Story 4 (P4): paste a payment-notification-style text and get a proposed,
// reviewable transaction (FR-018). Low-confidence text still routes here for manual
// completion (FR-021) rather than being silently dropped.
export function QuickAddPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const navigate = useNavigate();
	const location = useLocation();

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
	const [cardMatchReason, setCardMatchReason] = useState<CardMatch | null>(null);
	const [cardDisambiguation, setCardDisambiguation] = useState<CardMatch[] | null>(null);

	// Spec 008, User Story 1 (FR-002): text shared in via the OS share sheet arrives here as
	// router state from ShareTargetLandingPage and must parse identically to manual paste — so
	// it's seeded into the same `rawText` state and run through the same `parseText` call the
	// "Parse" button uses, rather than a separate/duplicated parse path. It's parsed only once
	// the account list has actually loaded (passed explicitly, not read from state) so spec 018's
	// card auto-match below isn't racing this mount-time effect against the async account fetch.
	useEffect(() => {
		void AccountRepository.list(key, false).then((loaded) => {
			setAccounts(loaded);
			const sharedText = (location.state as { sharedText?: string } | null)?.sharedText;
			if (sharedText) {
				setRawText(sharedText);
				parseText(sharedText, loaded);
			}
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Spec 018, User Story 1 (FR-001-FR-006): reuses `findCardMatches` (spec 017) already relied
	// on by ImportPage/BulkTextImportPage — a single tagged-card match pre-selects that account
	// (with the reason shown); more than one never guesses, it prompts; zero matches leaves the
	// account field exactly as it behaves today. `accountsList` defaults to current state so
	// `handleParse` (button click, accounts already loaded well before then) doesn't need to pass
	// it explicitly.
	function parseText(text: string, accountsList: Account[] = accounts) {
		const candidate = parseQuickAddText(text);
		setParsed(true);
		setConfident(isConfident(candidate));
		if (candidate.amount !== null) setAmountInput(formatMinorUnits(candidate.amount));
		if (candidate.type) setType(candidate.type);
		if (candidate.merchantText) setMerchantName(candidate.merchantText);

		setCardMatchReason(null);
		setCardDisambiguation(null);
		const matches = findCardMatches(text, accountsList);
		const distinctIds = [...new Set(matches.map((m) => m.accountId))];
		if (distinctIds.length === 1) {
			setAccountId(distinctIds[0]);
			setCardMatchReason(matches.find((m) => m.accountId === distinctIds[0]) ?? null);
		} else if (distinctIds.length > 1) {
			setCardDisambiguation(distinctIds.map((id) => matches.find((m) => m.accountId === id)!));
		}
	}

	function handleParse() {
		parseText(rawText);
	}

	async function handleConfirm() {
		if (!accountId || !amountInput) {
			toast.error('Choose an account and enter an amount.');
			return;
		}
		setSubmitting(true);
		try {
			const amount = parseMoneyToMinorUnits(amountInput);
			if (amount === null || amount <= 0) {
				toast.error('Enter a valid positive amount, e.g. 1234.56');
				return;
			}
			const signedAmount = type === 'expense' ? -amount : amount;
			const resolved = merchantName.trim() ? await resolveMerchant(key, merchantName.trim()) : null;
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
						{cardMatchReason && (
							<p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-muted-foreground">
								Matched by {cardMatchReason.matchType === 'last4' ? 'card ending' : 'nickname'} "
								{cardMatchReason.matchedIdentifier}" — the Account field below was pre-selected. You
								can still choose a different account.
							</p>
						)}
						{cardDisambiguation && (
							<div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
								<p className="text-xs text-muted-foreground">
									This matches more than one tagged card — pick which one:
								</p>
								<div className="flex flex-wrap gap-2">
									{cardDisambiguation.map((match) => (
										<Button
											key={match.accountId}
											type="button"
											variant={accountId === match.accountId ? 'default' : 'outline'}
											size="sm"
											className="h-auto py-1"
											onClick={() => setAccountId(match.accountId)}
										>
											{match.accountName} (ending {match.matchedIdentifier})
										</Button>
									))}
								</div>
							</div>
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
