import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PiggyBank, Plus } from 'lucide-react';
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
import { ensureCurrentBudgetItem } from '../domain/budgets/budgetEngine';
import type { Budget, BudgetItem, BudgetPeriodType, Category } from '../domain/entities';

const budgetSchema = z.object({
	categoryId: z.string().min(1, 'Choose a category.'),
	periodType: z.enum(['monthly', 'yearly']),
	amount: z.string().refine((v) => parseFloat(v || '0') > 0, 'Enter a positive amount.'),
	rolloverEnabled: z.boolean(),
	isSinkingFund: z.boolean()
});
type BudgetFormValues = z.infer<typeof budgetSchema>;

// User Story 5 (P5): budgeting per category with optional rollover/sinking funds.
export function BudgetsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [categories, setCategories] = useState<Category[]>([]);
	const [budgets, setBudgets] = useState<Budget[]>([]);
	const [items, setItems] = useState<Record<string, BudgetItem>>({});
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);

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

	async function refresh() {
		setLoading(true);
		const [cats, budgetList] = await Promise.all([
			CategoryRepository.list(key),
			BudgetRepository.list(key)
		]);
		setCategories(cats);
		setBudgets(budgetList);
		const currentItems = await Promise.all(budgetList.map((b) => ensureCurrentBudgetItem(key, b)));
		setItems(Object.fromEntries(budgetList.map((b, i) => [b.id, currentItems[i]])));
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function categoryName(id: string): string {
		return categories.find((c) => c.id === id)?.name ?? id;
	}

	async function onSubmit(values: BudgetFormValues) {
		await BudgetRepository.create(key, {
			categoryId: values.categoryId,
			periodType: values.periodType,
			amount: Math.round(parseFloat(values.amount) * 100),
			rolloverEnabled: values.rolloverEnabled,
			isSinkingFund: values.isSinkingFund
		});
		form.reset();
		setDialogOpen(false);
		toast.success('Budget created');
		await refresh();
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
						if (!item) return null;
						return (
							<BudgetProgressCard
								key={budget.id}
								categoryName={categoryName(budget.categoryId)}
								item={item}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}
