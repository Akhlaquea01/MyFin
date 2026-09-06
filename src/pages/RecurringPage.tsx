import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarClock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '../components/ui/dialog';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { useSession } from '../context/SessionContext';
import { AccountRepository } from '../data/dexie/accountRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { RecurringRepository } from '../data/dexie/recurringRepository';
import type { Account, Category, RecurringFrequency, RecurringRule } from '../domain/entities';

const ruleSchema = z.object({
	accountId: z.string().min(1, 'Choose an account.'),
	categoryId: z.string().min(1, 'Choose a category.'),
	frequency: z.enum(['weekly', 'monthly', 'yearly']),
	dayOfPeriod: z.string().refine((v) => Number.isInteger(parseFloat(v)) && parseFloat(v) > 0),
	amount: z.string().refine((v) => parseFloat(v || '0') > 0, 'Enter a positive amount.')
});
type RuleFormValues = z.infer<typeof ruleSchema>;

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
	weekly: 'Weekly',
	monthly: 'Monthly',
	yearly: 'Yearly'
};

// User Story 6 (P6): recurring rules for predictable income/expenses (FR-028).
export function RecurringPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [accounts, setAccounts] = useState<Account[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [rules, setRules] = useState<RecurringRule[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);

	const form = useForm<RuleFormValues>({
		resolver: zodResolver(ruleSchema),
		defaultValues: {
			accountId: '',
			categoryId: '',
			frequency: 'monthly',
			dayOfPeriod: '1',
			amount: '0'
		}
	});

	async function refresh() {
		setLoading(true);
		const [accts, cats, ruleList] = await Promise.all([
			AccountRepository.list(key, false),
			CategoryRepository.list(key),
			RecurringRepository.list(key)
		]);
		setAccounts(accts);
		setCategories(cats);
		setRules(ruleList);
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function accountName(id: string): string {
		return accounts.find((a) => a.id === id)?.name ?? id;
	}
	function categoryName(id: string): string {
		return categories.find((c) => c.id === id)?.name ?? id;
	}

	async function onSubmit(values: RuleFormValues) {
		await RecurringRepository.create(key, {
			accountId: values.accountId,
			categoryId: values.categoryId,
			amount: Math.round(parseFloat(values.amount) * 100),
			frequency: values.frequency,
			dayOfPeriod: parseInt(values.dayOfPeriod, 10)
		});
		form.reset();
		setDialogOpen(false);
		toast.success('Recurring rule added');
		await refresh();
	}

	async function toggleActive(rule: RecurringRule) {
		await RecurringRepository.update(key, rule.id, { isActive: !rule.isActive });
		await refresh();
	}

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
					<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
						<DialogTrigger asChild>
							<Button>
								<Plus /> Add rule
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>New recurring rule</DialogTitle>
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
												<Select value={field.value} onValueChange={field.onChange}>
													<SelectTrigger id="rule-category" className="w-full">
														<SelectValue placeholder="Choose…" />
													</SelectTrigger>
													<SelectContent>
														{categories.map((c) => (
															<SelectItem key={c.id} value={c.id}>
																{c.name}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											)}
										/>
									</div>
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
								<DialogFooter>
									<Button type="submit">Add rule</Button>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>
				</div>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : rules.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<CalendarClock className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No recurring rules yet.</p>
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-2">
					{rules.map((rule) => (
						<Card key={rule.id} className={!rule.isActive ? 'opacity-60' : undefined}>
							<CardContent className="flex items-center justify-between pt-6">
								<div>
									<p className="text-sm font-medium">{categoryName(rule.categoryId)}</p>
									<p className="text-xs text-muted-foreground">
										{accountName(rule.accountId)} · {FREQUENCY_LABELS[rule.frequency]} · day{' '}
										{rule.dayOfPeriod}
									</p>
								</div>
								<div className="flex items-center gap-3">
									<Badge variant={rule.isActive ? 'secondary' : 'outline'}>
										{rule.isActive ? 'Active' : 'Paused'}
									</Badge>
									<Button variant="ghost" size="sm" onClick={() => toggleActive(rule)}>
										{rule.isActive ? 'Pause' : 'Resume'}
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
