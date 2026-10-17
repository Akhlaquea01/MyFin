import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { SegmentedBar, type BarSegment } from '../components/charts/SegmentedBar';
import { CategoryEditor, type CategoryEditorValues } from '../components/categories/CategoryEditor';
import { CategoryRemoveDialog } from '../components/categories/CategoryRemoveDialog';
import {
	CategoryRowCard,
	ChangeNote,
	type BudgetFigures,
	type CategoryRowActions
} from '../components/categories/CategoryRowCard';
import { useSession } from '../context/SessionContext';
import { BudgetRepository } from '../data/dexie/budgetRepository';
import { CategoryRepository } from '../data/dexie/categoryRepository';
import { addStarterCategories } from '../data/io/starterCategories';
import { categoryActivity, type CategoryActivityItem } from '../domain/analytics/analyticsEngine';
import { ensureBudgetItemForPeriod } from '../domain/budgets/budgetEngine';
import { buildCategoryColors, NEUTRAL_CATEGORY_COLOR } from '../domain/categories/categoryColor';
import {
	countCategoryReferences,
	moveAndRemoveCategory,
	type CategoryReferenceCounts
} from '../domain/categories/categoryEngine';
import { buildCategoryLabels, filterCategoryOptions } from '../domain/categories/categoryHierarchy';
import {
	buildCategoryOverview,
	idsMatching,
	sortCategoryRows,
	type CategoryRow
} from '../domain/categories/categoryOverview';
import { todayLocalISO } from '../domain/shared/dateMath';
import { formatMoney } from '../domain/shared/money';
import type { Category, CategoryKind } from '../domain/entities';
import { useConfirm } from '../lib/confirm';

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

/** The most categories named separately in the summary bar; the rest are grouped as "Other". */
const SUMMARY_SEGMENTS = 5;

function monthRange(month: Date): { from: string; to: string } {
	return {
		from: todayLocalISO(new Date(month.getFullYear(), month.getMonth(), 1)),
		to: todayLocalISO(new Date(month.getFullYear(), month.getMonth() + 1, 0))
	};
}

function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

type EditorState = { category?: Category; parentId?: string | null } | null;
type RemoveState = {
	category: Category;
	mode: 'delete' | 'merge';
	references: CategoryReferenceCounts;
} | null;

// Where the money goes, by category: the month's total and how it moved, each category with its
// subcategories folded in, its budget when it has one, and everything needed to keep the list tidy
// (rename, recolour, move, merge, delete) a tap away. Categories are still a tree; this page just
// stopped being a bare list of names.
export function CategoriesPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const confirm = useConfirm();

	const [categories, setCategories] = useState<Category[]>([]);
	const [loading, setLoading] = useState(true);
	const [kind, setKind] = useState<CategoryKind>('expense');
	const [month, setMonth] = useState(() => startOfMonth(new Date()));
	const [activity, setActivity] = useState<CategoryActivityItem[]>([]);
	const [previous, setPrevious] = useState<CategoryActivityItem[]>([]);
	const [budgets, setBudgets] = useState<Map<string, BudgetFigures>>(new Map());
	const [sort, setSort] = useState<'amount' | 'name'>('amount');
	const [query, setQuery] = useState('');
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [editor, setEditor] = useState<EditorState>(null);
	const [removal, setRemoval] = useState<RemoveState>(null);

	const load = useCallback(async () => {
		const previousMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
		const now = monthRange(month);
		const before = monthRange(previousMonth);
		try {
			const [cats, current, prior, budgetList] = await Promise.all([
				CategoryRepository.list(key),
				categoryActivity(key, now.from, now.to),
				categoryActivity(key, before.from, before.to),
				BudgetRepository.list(key)
			]);
			// A budget's figures for the month on screen. Only budgeted categories are looked at.
			const figures = new Map<string, BudgetFigures>();
			for (const budget of budgetList) {
				const item = await ensureBudgetItemForPeriod(key, budget, month);
				figures.set(budget.categoryId, { planned: item.plannedAmount, actual: item.actualAmount });
			}
			setCategories(cats);
			setActivity(current);
			setPrevious(prior);
			setBudgets(figures);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not load categories.');
		} finally {
			setLoading(false);
		}
	}, [key, month]);

	useEffect(() => {
		void load();
	}, [load]);

	const overview = useMemo(
		() => buildCategoryOverview({ categories, activity, previous, kind }),
		[categories, activity, previous, kind]
	);
	const colors = useMemo(() => buildCategoryColors(categories), [categories]);
	const labels = useMemo(() => buildCategoryLabels(categories), [categories]);

	const searching = query.trim() !== '';
	const match = useMemo(() => {
		if (!searching) return null;
		return idsMatching(
			overview.rows,
			labels,
			(label) => filterCategoryOptions([{ label }], query).length > 0
		);
	}, [searching, overview.rows, labels, query]);

	const rows = useMemo(() => {
		const visible = match
			? overview.rows.filter((r) => match.visible.has(r.category.id))
			: overview.rows;
		return sortCategoryRows(visible, sort);
	}, [overview.rows, match, sort]);

	// Each visible row, once, for the summary bar and the counts.
	const monthName = MONTH_NAMES[month.getMonth()];
	const previousMonthName = MONTH_NAMES[(month.getMonth() + 11) % 12];
	const isCurrentMonth = startOfMonth(new Date()).getTime() === month.getTime();
	const transactionCount =
		overview.rows.reduce((sum, r) => sum + r.totalCount, 0) + overview.uncategorized.count;

	const summarySegments: BarSegment[] = useMemo(() => {
		const ranked = [...overview.rows]
			.filter((r) => r.totalAmount > 0)
			.sort((a, b) => b.totalAmount - a.totalAmount);
		const top = ranked.slice(0, SUMMARY_SEGMENTS).map((r) => ({
			label: r.category.name,
			value: r.totalAmount,
			color: colors.get(r.category.id) ?? NEUTRAL_CATEGORY_COLOR
		}));
		const rest = ranked.slice(SUMMARY_SEGMENTS).reduce((sum, r) => sum + r.totalAmount, 0);
		return [
			...top,
			...(rest > 0 ? [{ label: 'Other', value: rest, color: NEUTRAL_CATEGORY_COLOR }] : []),
			...(overview.uncategorized.amount > 0
				? [
						{
							label: 'Uncategorized',
							value: overview.uncategorized.amount,
							color: 'var(--border)'
						}
					]
				: [])
		];
	}, [overview, colors]);

	function stepMonth(delta: number) {
		setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
	}

	async function saveCategory(values: CategoryEditorValues) {
		const editing = editor?.category;
		if (editing) {
			await CategoryRepository.update(key, editing.id, {
				name: values.name,
				parentId: values.parentId,
				icon: values.icon,
				color: values.color,
				// Only a top-level category says which list it is in; a subcategory follows its parent.
				kind: values.parentId ? undefined : values.kind
			});
			toast.success(`${values.name} saved`);
		} else {
			await CategoryRepository.create(key, {
				name: values.name,
				parentId: values.parentId,
				icon: values.icon,
				color: values.color,
				kind: values.parentId ? undefined : values.kind
			});
			toast.success(`${values.name} added`);
			// A new category lands in the list it was made for.
			if (!values.parentId) setKind(values.kind);
		}
		setEditor(null);
		await load();
	}

	async function requestDelete(row: CategoryRow) {
		const category = row.category;
		// A parent with subcategories can't be deleted out from under them: they would vanish from this
		// page (children are only listed under a visible parent) yet stay in every picker. Say what is
		// in the way; "Merge into…" is the way to move them.
		const subcategories = categories.filter((c) => c.parentId === category.id);
		if (subcategories.length > 0) {
			toast.error(
				`${category.name} still has ${subcategories.length} ${
					subcategories.length === 1 ? 'subcategory' : 'subcategories'
				} (${subcategories.map((c) => c.name).join(', ')}). Delete ${
					subcategories.length === 1 ? 'it' : 'them'
				} first.`
			);
			return;
		}
		const references = await countCategoryReferences(key, category.id);
		const attached =
			references.splits + references.budgets + references.recurring + references.rules;
		if (attached > 0) {
			setRemoval({ category, mode: 'delete', references });
			return;
		}
		const confirmed = await confirm({
			message: `Remove the ${category.name} category? This cannot be undone.`,
			confirmLabel: 'Remove category',
			destructive: true
		});
		if (!confirmed) return;
		try {
			await moveAndRemoveCategory(key, category.id, null);
			toast.success(`${category.name} deleted`);
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete category.');
		}
	}

	async function requestMerge(row: CategoryRow) {
		const references = await countCategoryReferences(key, row.category.id);
		setRemoval({ category: row.category, mode: 'merge', references });
	}

	async function finishRemoval(destinationId: string | null) {
		if (!removal) return;
		const { category, mode } = removal;
		const moved = await moveAndRemoveCategory(key, category.id, destinationId, {
			moveSubcategories: mode === 'merge'
		});
		const target = destinationId ? categories.find((c) => c.id === destinationId) : null;
		toast.success(
			mode === 'merge'
				? `${category.name} merged into ${target?.name ?? 'Uncategorized'}`
				: moved.transactions > 0
					? `${category.name} deleted. ${moved.transactions} ${
							moved.transactions === 1 ? 'transaction' : 'transactions'
						} moved to ${target?.name ?? 'Uncategorized'}.`
					: `${category.name} deleted`
		);
		setRemoval(null);
		await load();
	}

	const actions: CategoryRowActions = {
		onEdit: (row) => setEditor({ category: row.category }),
		onDelete: (row) => void requestDelete(row),
		onAddSubcategory: (row) => setEditor({ parentId: row.category.id }),
		onMerge: (row) => void requestMerge(row),
		onToggle: (row) =>
			setCollapsed((prev) => {
				const next = new Set(prev);
				if (!next.delete(row.category.id)) next.add(row.category.id);
				return next;
			})
	};

	async function addCommon() {
		try {
			const added = await addStarterCategories(key);
			toast.success(added > 0 ? `${added} categories added` : 'You already have these');
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not add categories.');
		}
	}

	const editorTarget = editor;
	const spendingList = kind === 'expense';

	return (
		<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
			<div className="mb-5 flex items-center justify-between gap-3">
				<h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
				<Button onClick={() => setEditor({})}>
					<Plus /> Add category
				</Button>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : categories.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="flex flex-col items-center gap-3 py-10 text-center">
						<Tags className="size-8 text-muted-foreground" />
						<div>
							<p className="font-medium">No categories yet</p>
							<p className="text-sm text-muted-foreground">
								Categories show where your money goes. Start with a few common ones, or make your
								own.
							</p>
						</div>
						<div className="flex flex-wrap justify-center gap-2">
							<Button onClick={() => void addCommon()}>Start with the common ones</Button>
							<Button variant="outline" onClick={() => setEditor({})}>
								Add your own
							</Button>
						</div>
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div role="radiogroup" aria-label="Show" className="flex gap-1.5">
							{(['expense', 'income'] as CategoryKind[]).map((option) => (
								<Button
									key={option}
									type="button"
									role="radio"
									aria-checked={kind === option}
									size="sm"
									variant={kind === option ? 'secondary' : 'ghost'}
									onClick={() => setKind(option)}
								>
									{option === 'expense' ? 'Spending' : 'Income'}
								</Button>
							))}
						</div>
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Previous month"
								onClick={() => stepMonth(-1)}
							>
								<ChevronLeft />
							</Button>
							<button
								type="button"
								className="min-w-32 text-center text-sm font-medium"
								title={isCurrentMonth ? undefined : 'Back to this month'}
								onClick={() => setMonth(startOfMonth(new Date()))}
							>
								{monthName} {month.getFullYear()}
							</button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Next month"
								onClick={() => stepMonth(1)}
							>
								<ChevronRight />
							</Button>
						</div>
					</div>

					<Card className="bg-gradient-to-br from-primary/15 via-card to-card">
						<CardContent className="flex flex-col gap-3">
							<div className="flex items-end justify-between gap-3">
								<div>
									<p className="text-sm text-muted-foreground">
										{spendingList ? 'Spent' : 'Received'} in {monthName}
									</p>
									<p className="font-mono text-3xl leading-tight font-semibold">
										{formatMoney(overview.total)}
									</p>
								</div>
								<ChangeNote
									current={overview.total}
									previous={overview.previousTotal}
									kind={kind}
									previousMonthName={previousMonthName}
									emptyLabel={`Nothing recorded in ${previousMonthName}`}
									className="pb-1.5 text-right"
								/>
							</div>
							{summarySegments.length > 0 ? (
								<SegmentedBar segments={summarySegments} format={formatMoney} />
							) : (
								<p className="text-xs text-muted-foreground">
									Nothing {spendingList ? 'spent' : 'received'} in {monthName} yet.
								</p>
							)}
							<p className="text-xs text-muted-foreground">
								{transactionCount} {transactionCount === 1 ? 'transaction' : 'transactions'}
								{overview.uncategorized.count > 0 &&
									` · ${overview.uncategorized.count} with no category`}
							</p>
						</CardContent>
					</Card>

					<div className="flex flex-wrap items-center gap-2">
						<div className="relative min-w-40 flex-1">
							<Search
								className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
								aria-hidden
							/>
							<Input
								type="search"
								aria-label="Search your list"
								placeholder="Search"
								className="pl-8"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
							/>
						</div>
						<div role="radiogroup" aria-label="Order" className="flex gap-1.5">
							{(
								[
									['amount', 'Biggest'],
									['name', 'A–Z']
								] as const
							).map(([value, label]) => (
								<Button
									key={value}
									type="button"
									role="radio"
									aria-checked={sort === value}
									size="sm"
									variant={sort === value ? 'secondary' : 'ghost'}
									onClick={() => setSort(value)}
								>
									{label}
								</Button>
							))}
						</div>
					</div>

					{rows.length === 0 ? (
						<Card className="border-dashed">
							<CardContent className="py-8 text-center text-sm text-muted-foreground">
								{searching
									? `Nothing matches “${query.trim()}”.`
									: spendingList
										? 'No spending categories yet. Add one with the button above.'
										: 'No income categories yet. Add one, and choose Income under “Used for”.'}
							</CardContent>
						</Card>
					) : (
						<div className="flex flex-col gap-3">
							{rows.map((row) => (
								<CategoryRowCard
									key={row.category.id}
									row={row}
									kind={kind}
									colors={colors}
									budgets={budgets}
									budgetKind={spendingList}
									collapsed={collapsed.has(row.category.id)}
									forceExpanded={searching}
									dimmed={(id) => !!match && !match.direct.has(id)}
									previousMonthName={previousMonthName}
									actions={actions}
								/>
							))}
							{!searching && overview.uncategorized.amount > 0 && (
								<Card size="sm" className="border-dashed">
									<CardContent className="flex items-center justify-between gap-3">
										<div>
											<p className="text-sm font-medium">Uncategorized</p>
											<p className="text-xs text-muted-foreground">
												{overview.uncategorized.count}{' '}
												{overview.uncategorized.count === 1 ? 'transaction' : 'transactions'} to
												sort
											</p>
										</div>
										<span className="font-mono text-base font-semibold">
											{formatMoney(overview.uncategorized.amount)}
										</span>
									</CardContent>
								</Card>
							)}
						</div>
					)}
				</div>
			)}

			<CategoryEditor
				open={editorTarget !== null}
				onOpenChange={(open) => {
					if (!open) setEditor(null);
				}}
				category={editorTarget?.category}
				defaultParentId={editorTarget?.parentId}
				defaultKind={kind}
				categories={categories}
				onSubmit={saveCategory}
			/>

			{removal && (
				<CategoryRemoveDialog
					category={removal.category}
					mode={removal.mode}
					categories={categories}
					references={removal.references}
					onOpenChange={(open) => {
						if (!open) setRemoval(null);
					}}
					onConfirm={finishRemoval}
				/>
			)}
		</div>
	);
}
