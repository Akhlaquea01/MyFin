import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '../components/ui/dialog';
import { useSession } from '../context/SessionContext';
import {
	SavingsGoalRepository,
	GoalContributionRepository
} from '../data/dexie/savingsGoalRepository';
import { computeGoalProgress } from '../domain/savingsGoals/goalProgress';
import type { SavingsGoal, GoalContribution } from '../domain/entities';

const goalSchema = z.object({
	name: z.string().trim().min(1, 'Name is required.'),
	targetAmount: z.string().refine((v) => parseFloat(v || '0') > 0, 'Enter a positive amount.'),
	targetDate: z.string() // '' means no target date
});
type GoalFormValues = z.infer<typeof goalSchema>;

const contributionSchema = z.object({
	amount: z.string().refine((v) => parseFloat(v || '0') !== 0, 'Enter a non-zero amount.'),
	date: z.string().min(1)
});
type ContributionFormValues = z.infer<typeof contributionSchema>;

function formatMoney(paise: number): string {
	return (paise / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

// User Story 1 (P1): create a goal, log contributions, see progress and achieved status.
export function SavingsGoalsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [goals, setGoals] = useState<SavingsGoal[]>([]);
	const [contributionsByGoal, setContributionsByGoal] = useState<
		Record<string, GoalContribution[]>
	>({});
	const [loading, setLoading] = useState(true);
	const [goalDialogOpen, setGoalDialogOpen] = useState(false);
	const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);

	const goalForm = useForm<GoalFormValues>({
		resolver: zodResolver(goalSchema),
		defaultValues: { name: '', targetAmount: '0', targetDate: '' }
	});

	async function refresh() {
		setLoading(true);
		const list = await SavingsGoalRepository.list(key);
		setGoals(list);
		const entries = await Promise.all(
			list.map(
				async (g) => [g.id, await GoalContributionRepository.listForGoal(key, g.id)] as const
			)
		);
		setContributionsByGoal(Object.fromEntries(entries));
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function openCreateDialog() {
		setEditingGoal(null);
		goalForm.reset({ name: '', targetAmount: '0', targetDate: '' });
		setGoalDialogOpen(true);
	}

	function openEditDialog(goal: SavingsGoal) {
		setEditingGoal(goal);
		goalForm.reset({
			name: goal.name,
			targetAmount: String(goal.targetAmount / 100),
			targetDate: goal.targetDate ?? ''
		});
		setGoalDialogOpen(true);
	}

	async function onSubmitGoal(values: GoalFormValues) {
		const targetAmount = Math.round(parseFloat(values.targetAmount) * 100);
		const targetDate = values.targetDate || null;
		if (editingGoal) {
			await SavingsGoalRepository.update(key, editingGoal.id, {
				name: values.name,
				targetAmount,
				targetDate
			});
		} else {
			await SavingsGoalRepository.create(key, { name: values.name, targetAmount, targetDate });
		}
		setGoalDialogOpen(false);
		toast.success(editingGoal ? 'Goal updated' : 'Goal created');
		await refresh();
	}

	async function deleteGoal(goal: SavingsGoal) {
		await SavingsGoalRepository.softDelete(key, goal.id);
		await refresh();
	}

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			<div className="mb-6 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Target className="size-6 text-primary" />
					<h1 className="text-2xl font-semibold tracking-tight">Savings Goals</h1>
				</div>
				<Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
					<DialogTrigger asChild>
						<Button onClick={openCreateDialog}>
							<Plus /> Add goal
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{editingGoal ? 'Edit goal' : 'New goal'}</DialogTitle>
						</DialogHeader>
						<form className="flex flex-col gap-4" onSubmit={goalForm.handleSubmit(onSubmitGoal)}>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="goal-name">Name</Label>
								<Input id="goal-name" {...goalForm.register('name')} />
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="goal-target">Target amount</Label>
								<Input
									id="goal-target"
									type="number"
									step="0.01"
									{...goalForm.register('targetAmount')}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="goal-date">Target date (optional)</Label>
								<Input id="goal-date" type="date" {...goalForm.register('targetDate')} />
							</div>
							<DialogFooter>
								<Button type="submit">{editingGoal ? 'Save changes' : 'Add goal'}</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : goals.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<Target className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No savings goals yet.</p>
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-4">
					<Card>
						<CardContent className="flex items-center justify-between py-4">
							<span className="text-sm text-muted-foreground">Total saved across goals</span>
							<span className="font-mono text-lg font-semibold">
								{formatMoney(
									Object.values(contributionsByGoal)
										.flat()
										.reduce((sum, c) => sum + c.amount, 0)
								)}
							</span>
						</CardContent>
					</Card>

					{goals.map((goal) => (
						<GoalCard
							key={goal.id}
							goal={goal}
							contributions={contributionsByGoal[goal.id] ?? []}
							onEdit={() => openEditDialog(goal)}
							onDelete={() => deleteGoal(goal)}
							onContributionsChanged={refresh}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function GoalCard({
	goal,
	contributions,
	onEdit,
	onDelete,
	onContributionsChanged
}: {
	goal: SavingsGoal;
	contributions: GoalContribution[];
	onEdit: () => void;
	onDelete: () => void;
	onContributionsChanged: () => Promise<void>;
}) {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const [contribDialogOpen, setContribDialogOpen] = useState(false);

	const contribForm = useForm<ContributionFormValues>({
		resolver: zodResolver(contributionSchema),
		defaultValues: { amount: '0', date: todayISO() }
	});

	const progress = computeGoalProgress({
		goal: { id: goal.id, targetAmount: goal.targetAmount, targetDate: goal.targetDate },
		contributions: contributions.map((c) => ({ amount: c.amount, date: c.date })),
		asOfDate: new Date()
	});
	const barPercent = Math.min(100, Math.max(0, progress.progressPercent));

	async function onSubmitContribution(values: ContributionFormValues) {
		try {
			await GoalContributionRepository.create(key, {
				goalId: goal.id,
				amount: Math.round(parseFloat(values.amount) * 100),
				date: values.date
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not log contribution.');
			return;
		}
		contribForm.reset({ amount: '0', date: todayISO() });
		setContribDialogOpen(false);
		await onContributionsChanged();
	}

	async function removeContribution(id: string) {
		await GoalContributionRepository.remove(key, id);
		await onContributionsChanged();
	}

	return (
		<Card>
			<CardHeader className="flex items-start justify-between space-y-0 pb-2">
				<CardTitle className="text-base">{goal.name}</CardTitle>
				<div className="flex items-center gap-1">
					{progress.achieved && <Badge>Achieved</Badge>}
					<Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit goal">
						<Pencil className="size-4" />
					</Button>
					<Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete goal">
						<Trash2 className="size-4" />
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				<div className="mb-2 flex items-baseline justify-between text-sm">
					<span className="font-mono">{formatMoney(progress.savedAmount)}</span>
					<span className="text-muted-foreground">
						of {formatMoney(goal.targetAmount)} ({progress.progressPercent}%)
					</span>
				</div>
				<Progress value={barPercent} />

				{!progress.achieved && (
					<div className="mt-2 flex items-center gap-2 text-sm">
						{progress.status === 'insufficient-data' || !progress.projectedCompletionDate ? (
							<span className="text-muted-foreground">
								Log more contributions to see a projection.
							</span>
						) : (
							<>
								<span className="text-muted-foreground">
									Projected: {formatDate(progress.projectedCompletionDate)}
								</span>
								<Badge variant={progress.status === 'behind' ? 'destructive' : 'secondary'}>
									{progress.status === 'behind' ? 'Behind schedule' : 'On track'}
								</Badge>
							</>
						)}
					</div>
				)}

				<Dialog open={contribDialogOpen} onOpenChange={setContribDialogOpen}>
					<DialogTrigger asChild>
						<Button variant="link" size="sm" className="mt-2 h-auto p-0">
							Add contribution
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Log a contribution</DialogTitle>
						</DialogHeader>
						<form
							className="flex flex-col gap-4"
							onSubmit={contribForm.handleSubmit(onSubmitContribution)}
						>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor={`contrib-amount-${goal.id}`}>Amount</Label>
								<Input
									id={`contrib-amount-${goal.id}`}
									type="number"
									step="0.01"
									{...contribForm.register('amount')}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor={`contrib-date-${goal.id}`}>Date</Label>
								<Input
									id={`contrib-date-${goal.id}`}
									type="date"
									max={todayISO()}
									{...contribForm.register('date')}
								/>
							</div>
							<DialogFooter>
								<Button type="submit">Log contribution</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>

				{contributions.length > 0 && (
					<ul className="mt-3 flex flex-col gap-1">
						{contributions
							.slice()
							.sort((a, b) => (a.date < b.date ? 1 : -1))
							.map((c) => (
								<li
									key={c.id}
									className="flex items-center justify-between text-sm text-muted-foreground"
								>
									<span>
										{c.date} · {formatMoney(c.amount)}
									</span>
									<Button
										variant="link"
										size="sm"
										className="h-auto p-0"
										onClick={() => removeContribution(c.id)}
									>
										Remove
									</Button>
								</li>
							))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
