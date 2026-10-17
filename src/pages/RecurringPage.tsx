import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarClock, Pencil, Plus, Repeat, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Switch } from '../components/ui/switch';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '../components/ui/dialog';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { CategoryPicker } from '../components/CategoryPicker';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { RecurringRepository } from '../data/dexie/recurringRepository';
import { MerchantRepository } from '../data/dexie/merchantRepository';
import {
	canTrack,
	detectSubscriptions,
	excludeTracked,
	ruleFromDetected,
	toMonthlyCost,
	type DetectedSubscription,
	type SubscriptionCadence
} from '../domain/recurring/subscriptionDetectionEngine';
import type { Account, Category, RecurringFrequency, RecurringRule } from '../domain/entities';
import {
	formatMinorUnits,
	isPositiveMoney,
	parseMoneyOrZero,
	formatMoney
} from '../domain/shared/money';
import { buildCategoryLabels } from '../domain/categories/categoryHierarchy';
// The valid `dayOfPeriod` range per frequency lives with the engine's other recurring rules, so
// this page and the Review screen's "Mark as recurring" dialog cannot disagree about it.
import { DAY_RANGE } from '../domain/recurring/recurringDay';
import { deleteRecurringRule, updateRecurringRule } from '../domain/recurring/recurringEngine';
import { useConfirm } from '../lib/confirm';

const ruleSchema = z
	.object({
		accountId: z.string().min(1, 'Choose an account.'),
		categoryId: z.string().min(1, 'Choose a category.'),
		frequency: z.enum(['weekly', 'monthly', 'yearly']),
		dayOfPeriod: z.string(),
		amount: z.string().refine((v) => isPositiveMoney(v), 'Enter a positive amount.'),
		direction: z.enum(['expense', 'income']),
		isSubscription: z.boolean(),
		label: z.string()
	})
	.superRefine((values, ctx) => {
		const { min, max, hint } = DAY_RANGE[values.frequency];
		const raw = values.dayOfPeriod.trim();
		const day = Number(raw);
		if (!/^\d+$/.test(raw) || day < min || day > max) {
			ctx.addIssue({ code: 'custom', message: hint, path: ['dayOfPeriod'] });
		}
	});
type RuleFormValues = z.infer<typeof ruleSchema>;

const NEW_RULE_VALUES: RuleFormValues = {
	accountId: '',
	categoryId: '',
	frequency: 'monthly',
	dayOfPeriod: '1',
	amount: '0',
	direction: 'expense',
	isSubscription: false,
	label: ''
};

/** What the rule dialog shows when an existing rule is opened for editing. */
function valuesFor(rule: RecurringRule): RuleFormValues {
	return {
		accountId: rule.accountId,
		categoryId: rule.categoryId,
		frequency: rule.frequency,
		dayOfPeriod: String(rule.dayOfPeriod),
		amount: formatMinorUnits(Math.abs(rule.amount)),
		direction: rule.amount < 0 ? 'expense' : 'income',
		isSubscription: !!rule.isSubscription,
		label: rule.label ?? ''
	};
}

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
	weekly: 'Weekly',
	monthly: 'Monthly',
	yearly: 'Yearly'
};

const CADENCE_LABELS: Record<SubscriptionCadence, string> = {
	weekly: 'Weekly',
	monthly: 'Monthly',
	quarterly: 'Quarterly',
	yearly: 'Yearly'
};

type RuleFilter = 'all' | 'bills' | 'income' | 'subscriptions';
const FILTER_LABELS: Record<RuleFilter, string> = {
	all: 'All',
	bills: 'Bills',
	income: 'Income',
	subscriptions: 'Subscriptions'
};

function ruleKind(rule: RecurringRule): Exclude<RuleFilter, 'all'> {
	if (rule.isSubscription) return 'subscriptions';
	return rule.amount < 0 ? 'bills' : 'income';
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}

// User Story 6 (P6): recurring rules for predictable income/expenses (FR-028).
export function RecurringPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [rules, setRules] = useState<RecurringRule[]>([]);
	// Repeating charges found in the transaction history that no rule tracks yet.
	const [detected, setDetected] = useState<DetectedSubscription[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);
	// The rule open in the dialog, or null when it is adding a new one.
	const [editing, setEditing] = useState<RecurringRule | null>(null);
	const confirm = useConfirm();
	// The old Subscriptions page redirects here with ?filter=subscriptions.
	const [searchParams, setSearchParams] = useSearchParams();
	const requestedFilter = searchParams.get('filter');
	const filter: RuleFilter =
		requestedFilter === 'bills' ||
		requestedFilter === 'income' ||
		requestedFilter === 'subscriptions'
			? requestedFilter
			: 'all';
	function chooseFilter(next: RuleFilter) {
		setSearchParams(next === 'all' ? {} : { filter: next }, { replace: true });
	}

	const form = useForm<RuleFormValues>({
		resolver: zodResolver(ruleSchema),
		defaultValues: NEW_RULE_VALUES
	});

	async function refresh() {
		setLoading(true);
		try {
			const [accts, cats, ruleList, found] = await Promise.all([
				AccountRepository.list(key, false),
				CategoryRepository.list(key),
				RecurringRepository.list(key),
				detectSubscriptions(key)
			]);
			setAccounts(accts);
			setCategories(cats);
			setRules(ruleList);
			setDetected(excludeTracked(found, ruleList));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load this page.');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function accountName(id: string): string {
		return accounts.find((a) => a.id === id)?.name ?? id;
	}
	const categoryLabels = buildCategoryLabels(categories);
	function categoryName(id: string): string {
		return categoryLabels.get(id) ?? id;
	}

	async function onSubmit(values: RuleFormValues) {
		// Recurring rules follow the same sign convention as Transaction.amount (negative =
		// expense, positive = income) so matching against real transactions works by exact
		// value, not just magnitude — see recurringEngine.matchTransaction.
		const magnitude = parseMoneyOrZero(values.amount);
		const signedAmount =
			values.direction === 'expense' ? -Math.abs(magnitude) : Math.abs(magnitude);
		// Only spending can be a subscription.
		const isSubscription = values.direction === 'expense' && values.isSubscription;
		const label = values.label.trim() || undefined;
		try {
			if (editing) {
				await updateRecurringRule(key, editing.id, {
					accountId: values.accountId,
					categoryId: values.categoryId,
					amount: signedAmount,
					frequency: values.frequency,
					dayOfPeriod: parseInt(values.dayOfPeriod, 10),
					label,
					isSubscription: isSubscription || undefined
				});
			} else {
				await RecurringRepository.create(key, {
					accountId: values.accountId,
					categoryId: values.categoryId,
					amount: signedAmount,
					frequency: values.frequency,
					dayOfPeriod: parseInt(values.dayOfPeriod, 10),
					label,
					isSubscription
				});
			}
			toast.success(editing ? 'Recurring rule saved' : 'Recurring rule added');
			closeRuleDialog();
			await refresh();
		} catch (err) {
			toast.error(
				err instanceof Error
					? err.message
					: editing
						? 'Could not save recurring rule.'
						: 'Could not create recurring rule.'
			);
		}
	}

	/** Opens the rule dialog empty (a new rule) or filled with `rule` (to edit it). */
	function openRuleDialog(rule: RecurringRule | null) {
		setEditing(rule);
		form.reset(rule ? valuesFor(rule) : NEW_RULE_VALUES);
		setDialogOpen(true);
	}

	function closeRuleDialog() {
		setDialogOpen(false);
		setEditing(null);
		form.reset(NEW_RULE_VALUES);
	}

	async function removeRule(rule: RecurringRule) {
		const name = rule.label || categoryName(rule.categoryId);
		const confirmed = await confirm({
			message: `Delete the ${name} rule? Its reminders go too. Transactions you already recorded stay as they are. This cannot be undone.`,
			confirmLabel: 'Delete rule',
			destructive: true
		});
		if (!confirmed) return;
		try {
			await deleteRecurringRule(key, rule.id);
			toast.success(`${name} deleted`);
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete recurring rule.');
		}
	}

	async function toggleActive(rule: RecurringRule) {
		try {
			// Through the engine, so pausing also drops the reminders still waiting for this rule.
			await updateRecurringRule(key, rule.id, { isActive: !rule.isActive });
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update recurring rule.');
		}
	}

	async function track(subscription: DetectedSubscription) {
		if (!canTrack(subscription)) return;
		try {
			await RecurringRepository.create(key, ruleFromDetected(subscription));
			toast.success(`Tracking ${subscription.merchantName}`);
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not track this charge.');
		}
	}

	async function dismiss(subscription: DetectedSubscription) {
		if (subscription.merchantId.startsWith('text:')) {
			// No resolved Merchant to attach the dismissal flag to — remove it from this view only.
			setDetected((prev) => prev.filter((s) => s !== subscription));
			return;
		}
		try {
			await MerchantRepository.setSubscriptionDismissed(key, subscription.merchantId, true);
			await refresh();
			toast.success(`${subscription.merchantName} dismissed`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not dismiss subscription.');
		}
	}

	const kindsPresent = new Set(rules.map(ruleKind));
	const showFilters = kindsPresent.size > 1;
	const visibleRules = filter === 'all' ? rules : rules.filter((r) => ruleKind(r) === filter);
	const subscriptionRules = rules.filter((r) => r.isSubscription && r.isActive);
	const subscriptionsPerMonth = subscriptionRules.reduce(
		(sum, r) => sum + toMonthlyCost(Math.abs(r.amount), r.frequency),
		0
	);
	const detectedPerMonth = detected.reduce((sum, d) => sum + d.monthlyCostMinor, 0);

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Recurring Finances</h1>
				<div className="flex gap-2">
					<Button variant="outline" asChild>
						<Link to="/recurring/upcoming">
							<CalendarClock /> Upcoming
						</Link>
					</Button>
					<Button onClick={() => openRuleDialog(null)}>
						<Plus /> Add rule
					</Button>
					<Dialog
						open={dialogOpen}
						onOpenChange={(open) => (open ? setDialogOpen(true) : closeRuleDialog())}
					>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{editing ? 'Edit recurring rule' : 'New recurring rule'}</DialogTitle>
							</DialogHeader>
							<form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
								<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="rule-account">Account</Label>
										<Controller
											control={form.control}
											name="accountId"
											render={({ field }) => (
												<Select value={field.value} onValueChange={field.onChange}>
													<SelectTrigger id="rule-account" className="w-full">
														<SelectValue placeholder="Choose…" />
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
									</div>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="rule-category">Category</Label>
										<Controller
											control={form.control}
											name="categoryId"
											render={({ field }) => (
												<CategoryPicker
													id="rule-category"
													value={field.value}
													onChange={field.onChange}
													categories={categories}
													placeholder="Choose…"
												/>
											)}
										/>
									</div>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="rule-direction">Type</Label>
									<Controller
										control={form.control}
										name="direction"
										render={({ field }) => (
											<Select
												value={field.value}
												onValueChange={(v) => field.onChange(v as 'expense' | 'income')}
											>
												<SelectTrigger id="rule-direction" className="w-full">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="expense">Expense</SelectItem>
													<SelectItem value="income">Income</SelectItem>
												</SelectContent>
											</Select>
										)}
									/>
								</div>
								<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="rule-frequency">Frequency</Label>
										<Controller
											control={form.control}
											name="frequency"
											render={({ field }) => (
												<Select
													value={field.value}
													onValueChange={(v) => field.onChange(v as RecurringFrequency)}
												>
													<SelectTrigger id="rule-frequency" className="w-full">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="weekly">Weekly</SelectItem>
														<SelectItem value="monthly">Monthly</SelectItem>
														<SelectItem value="yearly">Yearly</SelectItem>
													</SelectContent>
												</Select>
											)}
										/>
									</div>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="rule-day">Day</Label>
										<Input id="rule-day" type="number" {...form.register('dayOfPeriod')} />
										<p className="text-xs text-muted-foreground">
											{DAY_RANGE[form.watch('frequency')].hint}
										</p>
										{form.formState.errors.dayOfPeriod && (
											<p role="alert" className="text-xs text-destructive">
												{form.formState.errors.dayOfPeriod.message}
											</p>
										)}
									</div>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor="rule-amount">Amount</Label>
										<Input
											id="rule-amount"
											type="number"
											step="0.01"
											{...form.register('amount')}
										/>
									</div>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="rule-label">Label (optional)</Label>
									<Input id="rule-label" placeholder="e.g. Netflix" {...form.register('label')} />
								</div>
								{form.watch('direction') === 'expense' && (
									<div className="flex items-center justify-between gap-3 rounded-lg border p-3">
										<div className="flex flex-col gap-0.5">
											<Label htmlFor="rule-subscription">This is a subscription</Label>
											<p className="text-xs text-muted-foreground">
												Streaming, software or a membership. It is counted in your monthly
												subscription total.
											</p>
										</div>
										<Controller
											control={form.control}
											name="isSubscription"
											render={({ field }) => (
												<Switch
													id="rule-subscription"
													checked={field.value}
													onCheckedChange={field.onChange}
												/>
											)}
										/>
									</div>
								)}
								<DialogFooter>
									<Button type="submit">{editing ? 'Save changes' : 'Add rule'}</Button>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>
				</div>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : (
				<div className="flex flex-col gap-8">
					<section className="flex flex-col gap-3">
						{showFilters && (
							<div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-1.5">
								{(['all', 'bills', 'income', 'subscriptions'] as RuleFilter[])
									.filter((f) => f === 'all' || kindsPresent.has(f))
									.map((f) => (
										<Button
											key={f}
											type="button"
											role="radio"
											aria-checked={filter === f}
											size="sm"
											variant={filter === f ? 'secondary' : 'ghost'}
											onClick={() => chooseFilter(f)}
										>
											{FILTER_LABELS[f]}
										</Button>
									))}
							</div>
						)}

						{subscriptionRules.length > 0 && (filter === 'all' || filter === 'subscriptions') && (
							<Card>
								<CardContent className="flex items-center justify-between py-4">
									<span className="text-sm text-muted-foreground">
										Subscriptions you track, per month
									</span>
									<span className="font-mono text-lg font-semibold">
										{formatMoney(subscriptionsPerMonth)}
									</span>
								</CardContent>
							</Card>
						)}

						{rules.length === 0 ? (
							<Card className="border-dashed">
								<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
									<CalendarClock className="size-8 text-muted-foreground" />
									<p className="text-sm text-muted-foreground">No recurring rules yet.</p>
								</CardContent>
							</Card>
						) : visibleRules.length === 0 ? (
							<p className="text-sm text-muted-foreground">Nothing under this filter yet.</p>
						) : (
							<div className="flex flex-col gap-2">
								{visibleRules.map((rule) => (
									<Card key={rule.id} className={!rule.isActive ? 'opacity-60' : undefined}>
										<CardContent className="flex items-center justify-between pt-6">
											<div className="min-w-0">
												<div className="flex flex-wrap items-center gap-2">
													<p className="text-sm font-medium">
														{rule.label || categoryName(rule.categoryId)}
													</p>
													{rule.isSubscription && <Badge variant="outline">Subscription</Badge>}
												</div>
												<p className="text-xs text-muted-foreground">
													{accountName(rule.accountId)}
													{rule.label ? ` · ${categoryName(rule.categoryId)}` : ''} ·{' '}
													{FREQUENCY_LABELS[rule.frequency]} · day {rule.dayOfPeriod}
												</p>
											</div>
											<div className="flex items-center gap-3">
												<div className="text-right">
													<span
														className={
															rule.amount < 0
																? 'text-sm font-medium text-destructive'
																: 'text-sm font-medium text-emerald-600'
														}
													>
														{rule.amount < 0 ? '-' : '+'}
														{formatMoney(Math.abs(rule.amount))}
													</span>
													{rule.isSubscription && rule.frequency !== 'monthly' && (
														<p className="text-xs text-muted-foreground">
															≈ {formatMoney(toMonthlyCost(Math.abs(rule.amount), rule.frequency))}{' '}
															a month
														</p>
													)}
												</div>
												<Badge variant={rule.isActive ? 'secondary' : 'outline'}>
													{rule.isActive ? 'Active' : 'Paused'}
												</Badge>
												<Button variant="ghost" size="sm" onClick={() => toggleActive(rule)}>
													{rule.isActive ? 'Pause' : 'Resume'}
												</Button>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Edit ${rule.label || categoryName(rule.categoryId)}`}
													onClick={() => openRuleDialog(rule)}
												>
													<Pencil className="text-muted-foreground" />
												</Button>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Delete ${rule.label || categoryName(rule.categoryId)}`}
													onClick={() => void removeRule(rule)}
												>
													<Trash2 className="text-muted-foreground" />
												</Button>
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						)}
					</section>

					<section className="flex flex-col gap-3" aria-labelledby="found-in-history">
						<div>
							<h2 id="found-in-history" className="text-lg font-semibold tracking-tight">
								Found in your history
							</h2>
							<p className="text-sm text-muted-foreground">
								Charges that repeat on their own rhythm. Track one to get reminders and have it
								counted in your forecast.
							</p>
						</div>

						{detected.length === 0 ? (
							<Card className="border-dashed">
								<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
									<Repeat className="size-8 text-muted-foreground" />
									<p className="text-sm text-muted-foreground">
										No repeating charges detected yet — subscriptions appear here automatically once
										a merchant is charged a similar amount at least twice.
									</p>
								</CardContent>
							</Card>
						) : (
							<div className="flex flex-col gap-4">
								<Card>
									<CardContent className="flex items-center justify-between py-4">
										<span className="text-sm text-muted-foreground">
											Total detected monthly cost
										</span>
										<span className="font-mono text-lg font-semibold">
											{formatMoney(detectedPerMonth)}
										</span>
									</CardContent>
								</Card>

								{detected.map((subscription) => (
									<Card key={subscription.merchantId}>
										<CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
											<div className="flex items-center gap-2">
												<CardTitle className="text-base">{subscription.merchantName}</CardTitle>
												{subscription.isLapsed && (
													<Badge variant="destructive">Possibly lapsed</Badge>
												)}
											</div>
											<div className="flex items-center gap-1">
												{canTrack(subscription) && (
													<Button
														variant="outline"
														size="sm"
														aria-label={`Track ${subscription.merchantName}`}
														onClick={() => void track(subscription)}
													>
														Track
													</Button>
												)}
												<Button
													variant="ghost"
													size="icon"
													onClick={() => void dismiss(subscription)}
													aria-label={`Dismiss ${subscription.merchantName}`}
												>
													<X className="size-4" />
												</Button>
											</div>
										</CardHeader>
										<CardContent className="flex flex-col gap-1 text-sm">
											<div className="flex items-baseline justify-between">
												<span className="font-mono text-base font-semibold">
													{formatMoney(subscription.monthlyCostMinor)} / mo
												</span>
												<Badge variant="secondary">{CADENCE_LABELS[subscription.cadence]}</Badge>
											</div>
											<p className="text-muted-foreground">
												{formatMoney(subscription.averageAmountMinor)} per charge · last charged{' '}
												{formatDate(subscription.lastChargedDate)} · {subscription.chargeCount}{' '}
												charges seen
											</p>
											{!canTrack(subscription) && (
												<p className="text-xs text-muted-foreground">
													Quarterly charges can be dismissed but not tracked yet.
												</p>
											)}
										</CardContent>
									</Card>
								))}
							</div>
						)}
					</section>
				</div>
			)}
		</div>
	);
}
