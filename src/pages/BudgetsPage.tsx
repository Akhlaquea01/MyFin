import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronLeft, ChevronRight, MoreVertical, PiggyBank, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '../components/ui/dropdown-menu';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { BudgetProgressCard } from '../components/BudgetProgressCard';
import { useSession } from '../context/SessionContext';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { BudgetRepository } from '../data/dexie/budgetRepository';
import {
	ensureBudgetItemForPeriod,
	hasActiveBudgetForCategory
} from '../domain/budgets/budgetEngine';
import type { Budget, BudgetItem, BudgetPeriodType, Category } from '../domain/entities';
import { isPositiveMoney, parseMoneyOrZero } from '../domain/shared/money';

const budgetSchema = z.object({
	categoryId: z.string().min(1, 'Choose a category.'),
	periodType: z.enum(['monthly', 'yearly']),
	amount: z.string().refine((v) => isPositiveMoney(v), 'Enter a positive amount.'),
	rolloverEnabled: z.boolean(),
	isSinkingFund: z.boolean()
});
type BudgetFormValues = z.infer<typeof budgetSchema>;

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

// User Story 5 (P5): budgeting per category with optional rollover/sinking funds.
// Spec 016 adds month-wise history navigation (FR-011).
export function BudgetsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [categories, setCategories] = useState<Category[]>([]);
	const [budgets, setBudgets] = useState<Budget[]>([]);
	const [items, setItems] = useState<Record<string, BudgetItem>>({});
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [selectedMonth, setSelectedMonth] = useState(() => new Date());
	const [editTarget, setEditTarget] = useState<Budget | null>(null);

	const form = useForm<BudgetFormValues>({
		resolver: zodResolver(budgetSchema),
		defaultValues: {
			categoryId: '',
			periodType: 'monthly',
			amount: '0',
			rolloverEnabled: false,
			isSinkingFund: false
		}
	});

	const editForm = useForm<BudgetFormValues>({
		resolver: zodResolver(budgetSchema),
		defaultValues: {
			categoryId: '',
			periodType: 'monthly',
			amount: '0',
			rolloverEnabled: false,
			isSinkingFund: false
		}
	});

	const isCurrentMonth =
		selectedMonth.getFullYear() === new Date().getFullYear() &&
		selectedMonth.getMonth() === new Date().getMonth();

	function prevMonth() {
		setSelectedMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
	}

	function nextMonth() {
		setSelectedMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
	}

	function goToCurrentMonth() {
		setSelectedMonth(new Date());
	}

	async function refresh() {
		setLoading(true);
		try {
			const [cats, budgetList] = await Promise.all([
				CategoryRepository.list(key),
				BudgetRepository.list(key)
			]);
			setCategories(cats);
			setBudgets(budgetList);
			const currentItems = await Promise.all(
				budgetList.map((b) => ensureBudgetItemForPeriod(key, b, selectedMonth))
			);
			setItems(Object.fromEntries(budgetList.map((b, i) => [b.id, currentItems[i]])));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load this page.');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedMonth]);

	function categoryName(id: string): string {
		return categories.find((c) => c.id === id)?.name ?? id;
	}

	async function onSubmit(values: BudgetFormValues) {
		try {
			// FR-015: two active budgets for the same category would double-count its actuals.
			if (await hasActiveBudgetForCategory(key, values.categoryId)) {
				toast.error(
					`${categoryName(values.categoryId)} already has an active budget. Edit that one instead of creating another.`
				);
				return;
			}
			await BudgetRepository.create(key, {
				categoryId: values.categoryId,
				periodType: values.periodType,
				amount: parseMoneyOrZero(values.amount),
				rolloverEnabled: values.rolloverEnabled,
				isSinkingFund: values.isSinkingFund
			});
			form.reset();
			setDialogOpen(false);
			toast.success('Budget created');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not create budget.');
		}
	}

	function openEditDialog(budget: Budget) {
		setEditTarget(budget);
		editForm.reset({
			categoryId: budget.categoryId,
			periodType: budget.periodType,
			amount: String(budget.amount / 100),
			rolloverEnabled: budget.rolloverEnabled,
			isSinkingFund: budget.isSinkingFund
		});
	}

	async function onEditSubmit(values: BudgetFormValues) {
		if (!editTarget) return;
		try {
			// FR-015: also enforced on edit — changing a budget's category to one that already
			// has its own active budget would create the same double-count.
			if (await hasActiveBudgetForCategory(key, values.categoryId, editTarget.id)) {
				toast.error(
					`${categoryName(values.categoryId)} already has an active budget. Choose a different category, or merge them manually.`
				);
				return;
			}
			await BudgetRepository.update(key, editTarget.id, {
				categoryId: values.categoryId,
				periodType: values.periodType,
				amount: parseMoneyOrZero(values.amount),
				rolloverEnabled: values.rolloverEnabled,
				isSinkingFund: values.isSinkingFund
			});
			setEditTarget(null);
			toast.success('Budget updated');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update budget.');
		}
	}

	async function deleteBudget(budget: Budget) {
		// FR-013: a confirmation step, separate from the undo window below.
		const confirmed = window.confirm(
			`Remove the ${categoryName(budget.categoryId)} budget? You can undo this right after.`
		);
		if (!confirmed) return;
		try {
			await BudgetRepository.softDelete(key, budget.id);
			toast.success(`${categoryName(budget.categoryId)} budget deleted`, {
				action: {
					label: 'Undo',
					onClick: () => {
						void BudgetRepository.restore(key, budget.id).then(refresh);
					}
				}
			});
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete budget.');
		}
	}

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-semibold tracking-tight">Budgets</h1>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogTrigger asChild>
						<Button>
							<Plus /> Add budget
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>New budget</DialogTitle>
						</DialogHeader>
						<form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="budget-category">Category</Label>
								<Controller
									control={form.control}
									name="categoryId"
									render={({ field }) => (
										<Select value={field.value} onValueChange={field.onChange}>
											<SelectTrigger id="budget-category" className="w-full">
												<SelectValue placeholder="Choose category…" />
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
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="budget-period">Period</Label>
									<Controller
										control={form.control}
										name="periodType"
										render={({ field }) => (
											<Select
												value={field.value}
												onValueChange={(v) => field.onChange(v as BudgetPeriodType)}
											>
												<SelectTrigger id="budget-period" className="w-full">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="monthly">Monthly</SelectItem>
													<SelectItem value="yearly">Yearly</SelectItem>
												</SelectContent>
											</Select>
										)}
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="budget-amount">Amount</Label>
									<Input
										id="budget-amount"
										type="number"
										step="0.01"
										{...form.register('amount')}
									/>
								</div>
							</div>
							<div className="flex items-center justify-between">
								<Label htmlFor="rollover">Roll over unused amount</Label>
								<Controller
									control={form.control}
									name="rolloverEnabled"
									render={({ field }) => (
										<Switch id="rollover" checked={field.value} onCheckedChange={field.onChange} />
									)}
								/>
							</div>
							<div className="flex items-center justify-between">
								<Label htmlFor="sinking">Sinking fund (savings goal)</Label>
								<Controller
									control={form.control}
									name="isSinkingFund"
									render={({ field }) => (
										<Switch id="sinking" checked={field.value} onCheckedChange={field.onChange} />
									)}
								/>
							</div>
							<DialogFooter>
								<Button type="submit">Add budget</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			{/* Month selector (spec 016, FR-011) */}
			<div className="mb-4 flex items-center justify-center gap-2">
				<Button variant="ghost" size="icon-sm" onClick={prevMonth} aria-label="Previous month">
					<ChevronLeft className="size-4" />
				</Button>
				<button
					type="button"
					className="min-w-[160px] text-center text-sm font-medium"
					onClick={goToCurrentMonth}
					title="Click to go to current month"
				>
					{MONTH_NAMES[selectedMonth.getMonth()]} {selectedMonth.getFullYear()}
				</button>
				<Button variant="ghost" size="icon-sm" onClick={nextMonth} aria-label="Next month">
					<ChevronRight className="size-4" />
				</Button>
				{!isCurrentMonth && (
					<Button variant="outline" size="sm" onClick={goToCurrentMonth} className="ml-2">
						Today
					</Button>
				)}
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : budgets.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<PiggyBank className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No budgets yet.</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					{budgets.map((budget) => {
						const item = items[budget.id];
						const actions = (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`${categoryName(budget.categoryId)} budget actions`}
									>
										<MoreVertical />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onSelect={() => openEditDialog(budget)}>Edit</DropdownMenuItem>
									<DropdownMenuItem variant="destructive" onSelect={() => deleteBudget(budget)}>
										Delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						);
						if (!item) {
							// No BudgetItem for this category/month — distinguished from a budget
							// set to zero per FR-012 / spec 016 edge case.
							return (
								<Card key={budget.id} className="opacity-50">
									<CardContent className="flex flex-col gap-1 pt-6">
										<div className="flex items-start justify-between">
											<p className="text-sm font-medium">{categoryName(budget.categoryId)}</p>
											{actions}
										</div>
										<p className="text-xs text-muted-foreground italic">
											No budget set for this month
										</p>
									</CardContent>
								</Card>
							);
						}
						return (
							<BudgetProgressCard
								key={budget.id}
								categoryName={categoryName(budget.categoryId)}
								item={item}
								actions={actions}
							/>
						);
					})}
				</div>
			)}

			<Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit budget</DialogTitle>
					</DialogHeader>
					<form className="flex flex-col gap-4" onSubmit={editForm.handleSubmit(onEditSubmit)}>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="edit-budget-category">Category</Label>
							<Controller
								control={editForm.control}
								name="categoryId"
								render={({ field }) => (
									<Select value={field.value} onValueChange={field.onChange}>
										<SelectTrigger id="edit-budget-category" className="w-full">
											<SelectValue placeholder="Choose category…" />
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
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="edit-budget-period">Period</Label>
								<Controller
									control={editForm.control}
									name="periodType"
									render={({ field }) => (
										<Select
											value={field.value}
											onValueChange={(v) => field.onChange(v as BudgetPeriodType)}
										>
											<SelectTrigger id="edit-budget-period" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="monthly">Monthly</SelectItem>
												<SelectItem value="yearly">Yearly</SelectItem>
											</SelectContent>
										</Select>
									)}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="edit-budget-amount">Amount</Label>
								<Input
									id="edit-budget-amount"
									type="number"
									step="0.01"
									{...editForm.register('amount')}
								/>
							</div>
						</div>
						<div className="flex items-center justify-between">
							<Label htmlFor="edit-rollover">Roll over unused amount</Label>
							<Controller
								control={editForm.control}
								name="rolloverEnabled"
								render={({ field }) => (
									<Switch
										id="edit-rollover"
										checked={field.value}
										onCheckedChange={field.onChange}
									/>
								)}
							/>
						</div>
						<div className="flex items-center justify-between">
							<Label htmlFor="edit-sinking">Sinking fund (savings goal)</Label>
							<Controller
								control={editForm.control}
								name="isSinkingFund"
								render={({ field }) => (
									<Switch
										id="edit-sinking"
										checked={field.value}
										onCheckedChange={field.onChange}
									/>
								)}
							/>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={editForm.formState.isSubmitting}>
								Save changes
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
