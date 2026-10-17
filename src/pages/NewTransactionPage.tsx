import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Sparkles, Trash2, X } from 'lucide-react';
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
	SelectSeparator,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { CategoryPicker } from '../components/CategoryPicker';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { MerchantAliasRepository } from '../data/dexie/merchantRepository';
import { resolveMerchant } from '../domain/parser/merchantResolver';
import { resolveCategorization } from '../domain/categorization/resolveCategorization';
import { TagRepository, TransactionTagRepository } from '../data/dexie/tagRepository';
import { TransactionEngine } from '../domain/transactions/transactionEngine';
import { AttachmentRepository } from '../data/dexie/attachmentRepository';
import { validateAttachmentFile, compressImage } from '../lib/imageAttachment';
import type { Account, Category, TransactionPurpose } from '../domain/entities';
import { PurposeField } from '../components/PurposeField';
import { purposeIncomplete } from '../domain/transactions/purposeEngine';
import { isPositiveMoney, parseMoneyOrZero, formatMoney } from '../domain/shared/money';
import { allocatedMinor, analyzeSplits } from '../domain/transactions/splitInput';
import { isValidIsoDate, todayLocalISO } from '../domain/shared/dateMath';
import { buildCategoryLabels } from '../domain/categories/categoryHierarchy';
import { useUnsavedChanges } from '../lib/unsavedChanges';

const formSchema = z.object({
	accountId: z.string().min(1, 'Choose an account.'),
	type: z.enum(['expense', 'income']),
	amount: z.string().refine((v) => isPositiveMoney(v), 'Enter a positive amount.'),
	date: z.string().refine(isValidIsoDate, 'Enter a valid date.'),
	merchantName: z.string(),
	notes: z.string(),
	tagsInput: z.string(),
	splits: z.array(z.object({ categoryId: z.string(), amountInput: z.string() }))
});
type FormValues = z.infer<typeof formSchema>;

function toPaise(rupees: number | string): number {
	return parseMoneyOrZero(rupees);
}

// Entries in the "Type" picker that are not an expense or income at all. Recording one of these
// as an expense or income is the single most common ledger mistake — a card bill payment entered
// as an expense is counted as spending and never reduces the card's balance — so they sit in the
// same picker, where the user is already looking, and hand off to the screen built for them.
const ROUTED_TYPES = {
	__transfer__: { path: '/transactions/transfer', state: undefined },
	__card_bill__: { path: '/transactions/transfer', state: { mode: 'pay-bill' } },
	__person__: { path: '/people', state: undefined }
} as const;
type RoutedType = keyof typeof ROUTED_TYPES;

function isRoutedType(value: string): value is RoutedType {
	return value in ROUTED_TYPES;
}

// User Story 2 (P2): transaction entry, with optional multi-category splits (FR-008, FR-009).
export function NewTransactionPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const navigate = useNavigate();
	const location = useLocation();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [accountsLoaded, setAccountsLoaded] = useState(false);
	const [categories, setCategories] = useState<Category[]>([]);
	// What the money was for (debt, savings, investment, bills); only meaningful for an expense.
	const [purpose, setPurpose] = useState<TransactionPurpose | null>(null);
	const [purposeError, setPurposeError] = useState<string | null>(null);
	// Why the category rows cannot be saved, shown under them after a failed save and cleared as
	// soon as they or the total change.
	const [splitError, setSplitError] = useState<string | null>(null);
	// Spec 008, User Story 2 (FR-004): set only when this page is reached via a share
	// carrying an image (ShareTargetLandingPage's router state) — the ordinary manual
	// "add a new transaction" flow never sets this and is otherwise unchanged.
	const [sharedFile, setSharedFile] = useState<File | null>(null);
	const [sharedFilePreviewUrl, setSharedFilePreviewUrl] = useState<string | null>(null);
	// What auto-categorization will do for the typed merchant, shown before saving so the user
	// can see (and override) it rather than discover the result afterwards.
	const [autoCategoryHint, setAutoCategoryHint] = useState<{
		categoryName: string;
		source: 'rule' | 'suggestion';
	} | null>(null);

	useEffect(() => {
		const file = (location.state as { sharedFile?: File } | null)?.sharedFile;
		if (file) {
			setSharedFile(file);
			setSharedFilePreviewUrl(URL.createObjectURL(file));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		return () => {
			if (sharedFilePreviewUrl) URL.revokeObjectURL(sharedFilePreviewUrl);
		};
	}, [sharedFilePreviewUrl]);

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		// No account is pre-selected: with more than one account, silently guessing "the
		// first one" is ambiguous and risks recording money against the wrong account.
		// The user always picks explicitly (validated by the "Choose an account." error).
		defaultValues: {
			accountId: '',
			type: 'expense',
			// Empty rather than "0": a pre-filled zero has to be deleted before typing, and an
			// untouched one fails validation anyway.
			amount: '',
			date: todayLocalISO(),
			merchantName: '',
			notes: '',
			tagsInput: '',
			splits: [{ categoryId: '', amountInput: '' }]
		}
	});
	const { fields, append, remove } = useFieldArray({ control: form.control, name: 'splits' });
	// A share from another app must not silently replace what has been typed here.
	useUnsavedChanges(form.formState.isDirty && !form.formState.isSubmitting);

	useEffect(() => {
		void Promise.all([AccountRepository.list(key, false), CategoryRepository.list(key)]).then(
			([accts, cats]) => {
				setAccounts(accts);
				setCategories(cats);
				setAccountsLoaded(true);
			}
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const merchantNameValue = form.watch('merchantName');
	const notesValue = form.watch('notes');
	const watchedSplits = form.watch('splits');
	const watchedAmount = form.watch('amount');
	const hasExplicitCategory = watchedSplits.some((s) => s.categoryId);
	const splitsSignature = JSON.stringify(watchedSplits) + '|' + watchedAmount;
	useEffect(() => {
		setSplitError(null);
	}, [splitsSignature]);
	const totalMinor = isPositiveMoney(watchedAmount) ? parseMoneyOrZero(watchedAmount) : 0;
	const allocated = allocatedMinor(watchedSplits);
	useEffect(() => {
		const name = merchantNameValue.trim();
		const notes = notesValue.trim();
		// A merchant OR a description is enough: a keyword rule can match either.
		if ((!name && !notes) || hasExplicitCategory) {
			setAutoCategoryHint(null);
			return;
		}
		let cancelled = false;
		// Debounced: this runs against encrypted IndexedDB, and the user is still typing.
		const handle = setTimeout(() => {
			void (async () => {
				const alias = name ? await MerchantAliasRepository.findByAliasText(key, name) : null;
				const result = await resolveCategorization(
					key,
					alias?.merchantId ?? null,
					alias?.id ?? null,
					{ notes, merchantName: name }
				);
				if (!result) return null;
				const label = buildCategoryLabels(categories).get(result.categoryId);
				return label ? { categoryName: label, source: result.source } : null;
			})()
				.then((hint) => {
					if (!cancelled) setAutoCategoryHint(hint);
				})
				.catch(() => {
					if (!cancelled) setAutoCategoryHint(null);
				});
		}, 350);
		return () => {
			cancelled = true;
			clearTimeout(handle);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [merchantNameValue, notesValue, hasExplicitCategory, categories]);

	async function onSubmit(values: FormValues) {
		const total = toPaise(values.amount);
		const sign = values.type === 'expense' ? -1 : 1;
		const signedTotal = sign * total;
		// A category picked without an amount is honoured (it gets the whole total) rather than
		// silently dropped, and totals that do not match are explained here in rupees instead of
		// failing later in the storage layer.
		const analysis = analyzeSplits(values.splits, total);
		if (!analysis.ok) {
			setSplitError(analysis.message);
			return;
		}
		const splitInputs = analysis.splits.map((s) => ({
			categoryId: s.categoryId,
			amount: sign * s.amount
		}));
		const chosenPurpose = values.type === 'expense' ? purpose : null;
		const incompletePurpose = purposeIncomplete(chosenPurpose);
		if (incompletePurpose) {
			setPurposeError(incompletePurpose);
			return;
		}
		setPurposeError(null);
		let purposeEffect: string | null = null;

		let tx: Awaited<ReturnType<typeof TransactionEngine.recordTransaction>>;
		try {
			// Reuse the merchant if this name (or a known alias of it) has been seen before. This used
			// to create a brand-new Merchant row on EVERY save, so "Swiggy" typed twice produced two
			// unrelated merchants: no rule could ever match, no category streak could ever form, and
			// the Auto-Categorize merchant list filled with duplicates.
			let merchantId: string | null = null;
			let merchantAliasId: string | null = null;
			if (values.merchantName.trim()) {
				const resolved = await resolveMerchant(key, values.merchantName.trim());
				merchantId = resolved.merchantId;
				merchantAliasId = resolved.aliasId;
			}

			tx = await TransactionEngine.recordTransaction(
				key,
				{
					accountId: values.accountId,
					date: values.date,
					amount: signedTotal,
					type: values.type,
					merchantId,
					merchantAliasId,
					notes: values.notes.trim() || null,
					purpose: chosenPurpose
				},
				splitInputs,
				{ onPurposeEffect: (message) => (purposeEffect = message) }
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save transaction.');
			return;
		}

		// The transaction now exists. Anything that goes wrong from here is reported as exactly
		// that — "saved, but…" — and the page moves on, because staying on the form invites a
		// second submit and a duplicate.
		const incomplete: string[] = [];

		const tagNames = values.tagsInput
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		if (tagNames.length > 0) {
			try {
				const tags = await Promise.all(tagNames.map((n) => TagRepository.getOrCreate(key, n)));
				await TransactionTagRepository.setTags(
					tx.id,
					tags.map((t) => t.id)
				);
			} catch {
				incomplete.push('the tags');
			}
		}

		// Spec 008, User Story 2 (FR-004): a shared image is attached only after the
		// transaction itself saves successfully, reusing spec 005's exact validation/
		// compression/storage path — an unsupported/oversized shared image does not
		// block the save; it only fails to attach, with its own explanation.
		if (sharedFile) {
			const validation = validateAttachmentFile(sharedFile);
			if (validation.ok) {
				try {
					const compressed = await compressImage(sharedFile);
					await AttachmentRepository.create(key, { transactionId: tx.id, ...compressed });
				} catch {
					incomplete.push('the shared photo');
				}
			} else {
				toast.error(
					`Transaction saved, but the shared image couldn't be attached: ${validation.reason}`
				);
			}
		}

		if (incomplete.length > 0) {
			toast.warning(
				`Transaction saved, but ${incomplete.join(' and ')} could not be added. Open the transaction to add ${incomplete.length > 1 ? 'them' : 'it'} again.`
			);
		} else {
			toast.success('Transaction saved');
		}
		// What marking it as debt, savings or a bill did, as its own message.
		if (purposeEffect) toast.success(purposeEffect);
		navigate('/transactions');
	}

	function removeSharedFile() {
		setSharedFile(null);
		setSharedFilePreviewUrl(null);
	}

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">New Transaction</h1>

			{sharedFile && sharedFilePreviewUrl && (
				<Card className="mb-6">
					<CardContent className="flex items-center gap-3 pt-6">
						<img
							src={sharedFilePreviewUrl}
							alt="Shared photo preview"
							className="size-16 rounded-md object-cover"
						/>
						<div className="min-w-0 flex-1 text-sm">
							<p className="font-medium">Shared photo</p>
							<p className="truncate text-muted-foreground">{sharedFile.name}</p>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Remove shared image"
							onClick={removeSharedFile}
						>
							<Trash2 />
						</Button>
					</CardContent>
				</Card>
			)}

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
								<Label htmlFor="type">Type</Label>
								<Controller
									control={form.control}
									name="type"
									render={({ field }) => (
										<Select
											value={field.value}
											onValueChange={(value) => {
												if (isRoutedType(value)) {
													const route = ROUTED_TYPES[value];
													// Carry over what was already typed so switching screens does not
													// throw it away.
													const typed = form.getValues();
													const carried =
														route.path === '/transactions/transfer'
															? {
																	...route.state,
																	...(isPositiveMoney(typed.amount)
																		? { amount: typed.amount }
																		: {}),
																	...(typed.notes.trim() ? { notes: typed.notes.trim() } : {})
																}
															: route.state;
													navigate(route.path, carried ? { state: carried } : undefined);
													return;
												}
												field.onChange(value);
											}}
										>
											<SelectTrigger id="type" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="expense">Expense</SelectItem>
												<SelectItem value="income">Income</SelectItem>
												<SelectSeparator />
												<SelectItem value="__transfer__">Transfer between accounts…</SelectItem>
												<SelectItem value="__card_bill__">Pay a credit card bill…</SelectItem>
												<SelectItem value="__person__">Lend, borrow or repay someone…</SelectItem>
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
								{form.formState.errors.date && (
									<p className="text-sm text-destructive">{form.formState.errors.date.message}</p>
								)}
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
											<CategoryPicker
												value={selectField.value}
												onChange={selectField.onChange}
												categories={categories}
												placeholder="Category…"
												className="min-w-0 flex-1"
											/>
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
								Choose one category to file the whole amount under it, or split it across several.
								Leave blank to record it uncategorized.
							</p>
							{allocated > 0 && totalMinor > 0 && (
								<p className="mt-1 text-xs text-muted-foreground">
									Allocated {formatMoney(allocated)} of {formatMoney(totalMinor)}
								</p>
							)}
							{splitError && (
								<p role="alert" className="mt-1 text-sm text-destructive">
									{splitError}
								</p>
							)}
						</fieldset>

						{form.watch('type') === 'expense' && (
							<div className="flex flex-col gap-1.5">
								<PurposeField
									value={purpose}
									onChange={(next) => {
										setPurpose(next);
										setPurposeError(null);
									}}
									disabled={form.formState.isSubmitting}
									hintText={`${merchantNameValue} ${notesValue}`}
								/>
								{purposeError && (
									<p role="alert" className="text-sm text-destructive">
										{purposeError}
									</p>
								)}
							</div>
						)}

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="merchant">Merchant</Label>
							<Input id="merchant" {...form.register('merchantName')} />
							{autoCategoryHint && (
								<p className="flex items-center gap-1 text-xs text-muted-foreground">
									<Sparkles className="size-3" />
									Will be filed under <strong>{autoCategoryHint.categoryName}</strong>{' '}
									{autoCategoryHint.source === 'rule'
										? '(your rule)'
										: '(learned from past entries)'}{' '}
									unless you pick a category above.
								</p>
							)}
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="tags">Tags (comma-separated)</Label>
							<Input id="tags" {...form.register('tagsInput')} />
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="notes">Notes</Label>
							<Textarea id="notes" {...form.register('notes')} />
						</div>

						<div className="flex flex-wrap items-center gap-3">
							<Button type="submit" disabled={form.formState.isSubmitting}>
								{form.formState.isSubmitting ? 'Saving…' : 'Save transaction'}
							</Button>
							<Button
								type="button"
								variant="ghost"
								disabled={form.formState.isSubmitting}
								onClick={() => navigate('/transactions')}
							>
								Cancel
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
