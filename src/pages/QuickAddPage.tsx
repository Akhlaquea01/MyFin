import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, HandCoins, Sparkles } from 'lucide-react';
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
import { MerchantAliasRepository, MerchantRepository } from '../data/dexie/merchantRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { CategoryPicker } from '../components/CategoryPicker';
import { UNCATEGORIZED_CATEGORY_ID } from '../data/dexie/transactionRepository';
import { resolveCategorization } from '../domain/categorization/resolveCategorization';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import { findDuplicateCandidates } from '../domain/transactions/duplicateCandidates';
import { formatTransactionLabel } from '../domain/transactions/transactionLabel';
import { resolveMerchant } from '../domain/parser/merchantResolver';
import { parseQuickAddText, isConfident } from '../domain/parser/quickAddParser';
import {
	describeMatchType,
	findCardMatches,
	type CardMatch
} from '../domain/parser/cardIdentifierMatcher';
import { findAccountMatches } from '../domain/capture/accountMatcher';
import { detectCardPayment } from '../domain/parser/cardPaymentDetector';
import type { TransferLocationState } from './TransferPage';
import type { Account, Category, Merchant, Transaction, TransactionType } from '../domain/entities';
import { formatMinorUnits, parseMoneyToMinorUnits, formatMoney } from '../domain/shared/money';
import { isValidIsoDate, todayLocalISO } from '../domain/shared/dateMath';
import { useUnsavedChanges } from '../lib/unsavedChanges';

// User Story 4 (P4): paste a payment-notification-style text and get a proposed,
// reviewable transaction (FR-018). Low-confidence text still routes here for manual
// completion (FR-021) rather than being silently dropped.
export function QuickAddPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const navigate = useNavigate();
	const location = useLocation();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [accountsLoaded, setAccountsLoaded] = useState(false);
	// Whether the date field was filled from the message itself, so the form can say so.
	const [dateFromMessage, setDateFromMessage] = useState(false);
	const [rawText, setRawText] = useState('');
	const [parsed, setParsed] = useState(false);
	const [confident, setConfident] = useState(true);
	const [accountId, setAccountId] = useState('');
	const [type, setType] = useState<TransactionType>('expense');
	const [amountInput, setAmountInput] = useState('');
	const [merchantName, setMerchantName] = useState('');
	const [date, setDate] = useState(todayLocalISO());
	const [submitting, setSubmitting] = useState(false);
	const [cardMatchReason, setCardMatchReason] = useState<CardMatch | null>(null);
	const [cardDisambiguation, setCardDisambiguation] = useState<CardMatch[] | null>(null);
	// Set when the pasted text reads like paying a credit card bill rather than spending on one.
	const [cardPayment, setCardPayment] = useState<{ cardAccountId: string | null } | null>(null);
	// Existing entries this one would plausibly duplicate, found when the user pressed Confirm. Tied to
	// the exact account/amount/date they were found for (`for`): change any of them and the warning
	// no longer applies, so it disappears instead of nagging about something that is no longer true.
	const [duplicateWarning, setDuplicateWarning] = useState<{
		for: string;
		matches: Transaction[];
	} | null>(null);
	const [merchants, setMerchants] = useState<Merchant[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	// null until the user picks one: then the category your rules suggest for this merchant is used.
	const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
	const [suggestedCategoryId, setSuggestedCategoryId] = useState<string | null>(null);
	// A share from another app must not silently replace what has been typed here.
	useUnsavedChanges(!submitting && (rawText.trim() !== '' || amountInput !== ''));

	/** Identifies what a duplicate check was run against; null while the amount is not yet valid. */
	function duplicateKeyFor(): string | null {
		const amount = amountInput ? parseMoneyToMinorUnits(amountInput) : null;
		if (!accountId || amount === null || amount <= 0) return null;
		return `${accountId}|${type === 'expense' ? -amount : amount}|${date}`;
	}
	const activeDuplicateWarning =
		duplicateWarning && duplicateWarning.for === duplicateKeyFor() ? duplicateWarning : null;

	// Spec 008, User Story 1 (FR-002): text shared in via the OS share sheet arrives here as
	// router state from ShareTargetLandingPage and must parse identically to manual paste — so
	// it's seeded into the same `rawText` state and run through the same `parseText` call the
	// "Parse" button uses, rather than a separate/duplicated parse path. It's parsed only once
	// the account list has actually loaded (passed explicitly, not read from state) so spec 018's
	// card auto-match below isn't racing this mount-time effect against the async account fetch.
	useEffect(() => {
		void MerchantRepository.list(key).then(setMerchants);
		void CategoryRepository.list(key).then(setCategories);
		void AccountRepository.list(key, false).then((loaded) => {
			setAccounts(loaded);
			setAccountsLoaded(true);
			const sharedText = (location.state as { sharedText?: string } | null)?.sharedText;
			if (sharedText) {
				setRawText(sharedText);
				parseText(sharedText, loaded);
			}
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// What your rules (or past choices for this merchant) would file the entry under, so the
	// category field starts on it. Debounced: this reads encrypted storage while the user types.
	useEffect(() => {
		const name = merchantName.trim();
		if (!parsed || !name) {
			setSuggestedCategoryId(null);
			return;
		}
		let cancelled = false;
		const handle = setTimeout(() => {
			void (async () => {
				const alias = await MerchantAliasRepository.findByAliasText(key, name);
				const result = await resolveCategorization(
					key,
					alias?.merchantId ?? null,
					alias?.id ?? null,
					{
						notes: rawText,
						merchantName: name
					}
				);
				if (!cancelled) setSuggestedCategoryId(result?.categoryId ?? null);
			})().catch(() => {
				if (!cancelled) setSuggestedCategoryId(null);
			});
		}, 350);
		return () => {
			cancelled = true;
			clearTimeout(handle);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [parsed, merchantName, rawText]);
	const effectiveCategoryId = categoryChoice ?? suggestedCategoryId ?? UNCATEGORIZED_CATEGORY_ID;

	// Spec 018, User Story 1 (FR-001-FR-006): reuses `findCardMatches` (spec 017) already relied
	// on by ImportPage/BulkTextImportPage, plus the digits saved on bank accounts — a single
	// tagged match pre-selects that account (with the reason shown); more than one never
	// guesses, it prompts; zero matches leaves the
	// account field exactly as it behaves today. `accountsList` defaults to current state so
	// `handleParse` (button click, accounts already loaded well before then) doesn't need to pass
	// it explicitly.
	function parseText(text: string, accountsList: Account[] = accounts) {
		const candidate = parseQuickAddText(text);
		setParsed(true);
		setConfident(isConfident(candidate));
		// Every field is set from THIS message, including to empty: keeping the previous parse's
		// amount, merchant or type when the new text has none put values from a different message
		// into the form without a word.
		setAmountInput(candidate.amount !== null ? formatMinorUnits(candidate.amount) : '');
		setType(candidate.type ?? 'expense');
		setMerchantName(candidate.merchantText ?? '');
		setDate(candidate.date ?? todayLocalISO());
		setDateFromMessage(candidate.date !== null);
		setDuplicateWarning(null);
		setCategoryChoice(null);

		setCardMatchReason(null);
		setCardDisambiguation(null);
		setCardPayment(null);
		// "Payment of Rs.5,000 received on your card ending 1234" / "Rs.5000 debited ... towards
		// credit card 1234" is a MOVEMENT between the user's own accounts. Pre-selecting the card
		// and recording it as an expense (the old behaviour) put the money on the wrong side of the
		// card — the debt went UP by the amount just paid — so the card is deliberately not
		// pre-selected here; the transfer shortcut below handles it correctly instead. Only cards
		// (not "A/c XX1234" bank digits) can be that destination.
		if (detectCardPayment(text)) {
			const cardIds = [...new Set(findCardMatches(text, accountsList).map((m) => m.accountId))];
			setCardPayment({ cardAccountId: cardIds.length === 1 ? cardIds[0] : null });
			return;
		}
		const matches = findAccountMatches(text, accountsList);
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

	/** Hands a recognised card payment to the transfer screen, with everything the message told us
	 *  (the card, the amount) pre-filled; the paying account is left for the user to choose. */
	function recordAsCardPayment() {
		const parsedAmount = amountInput ? parseMoneyToMinorUnits(amountInput) : null;
		const state: TransferLocationState = {
			mode: 'pay-bill',
			toAccountId: cardPayment?.cardAccountId ?? undefined,
			lockDestination: false,
			amount: parsedAmount && parsedAmount > 0 ? formatMinorUnits(parsedAmount) : undefined
		};
		navigate('/transactions/transfer', { state });
	}

	async function handleConfirm() {
		if (!accountId || !amountInput) {
			toast.error('Choose an account and enter an amount.');
			return;
		}
		if (!isValidIsoDate(date)) {
			toast.error('Enter a valid date.');
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

			// Pasting the same bank SMS twice (or one for something already entered by hand) used to
			// save a second copy without a word — file and bulk import both flag exactly this. The
			// first Confirm only checks and warns; confirming again, with nothing changed, adds it
			// anyway (flagged, like an import) because two same-amount entries can be genuine.
			const checkKey = `${accountId}|${signedAmount}|${date}`;
			let duplicateOfId: string | null = null;
			if (activeDuplicateWarning) {
				duplicateOfId = activeDuplicateWarning.matches[0]?.id ?? null;
			} else {
				const matches = await findDuplicateCandidates(
					key,
					{ accountId, amount: signedAmount, date },
					{ merchantName, merchants }
				);
				if (matches.length > 0) {
					setDuplicateWarning({ for: checkKey, matches });
					return;
				}
			}

			const resolved = merchantName.trim() ? await resolveMerchant(key, merchantName.trim()) : null;
			await TransactionEngine.recordTransaction(
				key,
				{
					accountId,
					date,
					amount: signedAmount,
					type,
					merchantId: resolved?.merchantId ?? null,
					merchantAliasId: resolved?.aliasId ?? null,
					// A recognised card payment keeps the message it came from: Review uses it to offer
					// "Record as transfer" later, and it is the only record of what the entry was.
					notes: cardPayment ? rawText.trim().slice(0, 200) : null,
					source: 'quick_add',
					reviewStatus: 'unreviewed',
					duplicateOfId
				},
				// Only a category the user picked is sent: otherwise the usual rules fill it in and the
				// entry says so in Review ("Auto: rule" / "Suggested").
				categoryChoice && categoryChoice !== UNCATEGORIZED_CATEGORY_ID
					? [{ categoryId: categoryChoice, amount: signedAmount }]
					: []
			);
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
					{parsed && (
						<p className="text-xs text-muted-foreground">
							Changed the text? Press Parse again — it re-reads the message and replaces the fields
							below.
						</p>
					)}
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
						{cardPayment && (
							<div className="flex flex-col gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-3">
								<p className="text-sm font-medium">This looks like a credit card bill payment.</p>
								<p className="text-xs text-muted-foreground">
									Saved as an ordinary {type === 'income' ? 'income' : 'expense'}, it would be
									counted as {type === 'income' ? 'earnings' : 'spending'} and the card's balance
									would not go down. Record it as a payment instead and both accounts update
									together.
								</p>
								<div>
									<Button type="button" size="sm" onClick={recordAsCardPayment}>
										<HandCoins /> Record as card bill payment
									</Button>
								</div>
							</div>
						)}
						{cardMatchReason && (
							<p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-muted-foreground">
								Matched by {describeMatchType(cardMatchReason)} "{cardMatchReason.matchedIdentifier}
								" — the Account field below was pre-selected. You can still choose a different
								account.
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
								{accountsLoaded && accounts.length === 0 && (
									<p className="text-xs text-muted-foreground">
										You have no accounts yet.{' '}
										<Link to="/accounts" className="underline underline-offset-2">
											Add an account
										</Link>{' '}
										first.
									</p>
								)}
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
									onChange={(e) => {
										setDate(e.target.value);
										setDateFromMessage(false);
									}}
								/>
								{dateFromMessage && (
									<p className="text-xs text-muted-foreground">Date read from the message.</p>
								)}
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
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="qa-category">Category</Label>
							<CategoryPicker
								id="qa-category"
								value={effectiveCategoryId}
								onChange={setCategoryChoice}
								categories={categories}
								noneOption={{ value: UNCATEGORIZED_CATEGORY_ID, label: 'Uncategorized' }}
								suggestedIds={suggestedCategoryId ? [suggestedCategoryId] : undefined}
								className="h-10 md:h-8"
							/>
						</div>
						{activeDuplicateWarning && (
							<div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
								<p className="flex items-center gap-1.5 text-sm font-medium">
									<AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
									This looks like something you already have.
								</p>
								<ul className="flex flex-col gap-1 text-xs text-muted-foreground">
									{activeDuplicateWarning.matches.map((match) => (
										<li key={match.id}>
											{match.date} · {formatMoney(Math.abs(match.amount))} ·{' '}
											{formatTransactionLabel(match, merchants)}
											{match.reviewStatus === 'unreviewed' && ' (waiting in Review)'}
										</li>
									))}
								</ul>
								<p className="text-xs text-muted-foreground">
									Same account, same amount, within a day. If it's a separate purchase, add it
									anyway — it will be marked as a possible duplicate in Review so you can compare.
								</p>
							</div>
						)}
						<Button onClick={handleConfirm} disabled={submitting}>
							{submitting
								? 'Saving…'
								: activeDuplicateWarning
									? 'Add anyway'
									: cardPayment
										? 'Add as an ordinary transaction anyway'
										: 'Add to review queue'}
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
