import { Link } from 'react-router-dom';
import {
	AlertTriangle,
	ArrowDownRight,
	ArrowUpRight,
	ChevronDown,
	MoreVertical,
	Pencil,
	Trash2
} from 'lucide-react';
import { cn } from 'cn';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '../ui/dropdown-menu';
import { ProgressBar } from '../charts/ProgressBar';
import { meterTone } from '../charts/meterTone';
import { categoryColorOf } from '../../domain/categories/categoryColor';
import type { CategoryRow } from '../../domain/categories/categoryOverview';
import type { CategoryKind } from '../../domain/entities';
import { formatMoney } from '../../domain/shared/money';
import { CategoryGlyph } from './categoryIcons';

export interface BudgetFigures {
	planned: number;
	actual: number;
}

export interface CategoryRowActions {
	onEdit: (row: CategoryRow) => void;
	onDelete: (row: CategoryRow) => void;
	onAddSubcategory: (row: CategoryRow) => void;
	onMerge: (row: CategoryRow) => void;
	onToggle: (row: CategoryRow) => void;
}

/** "12% more than September" / "8% less than September", coloured by whether that is good news. */
export function ChangeNote({
	current,
	previous,
	kind,
	previousMonthName,
	emptyLabel,
	className
}: {
	current: number;
	previous: number;
	kind: CategoryKind;
	previousMonthName: string;
	/** What to say when the month before had nothing to compare with; nothing is shown if omitted. */
	emptyLabel?: string;
	className?: string;
}) {
	if (current === 0 && previous === 0) return null;
	if (previous === 0) {
		return emptyLabel ? (
			<span className={cn('text-xs text-muted-foreground', className)}>{emptyLabel}</span>
		) : null;
	}
	if (current === previous) {
		return (
			<span className={cn('text-xs text-muted-foreground', className)}>
				Same as {previousMonthName}
			</span>
		);
	}
	const up = current > previous;
	const percent = Math.round((Math.abs(current - previous) / previous) * 100);
	// More spending is bad news, more income is good news.
	const good = kind === 'income' ? up : !up;
	const Arrow = up ? ArrowUpRight : ArrowDownRight;
	return (
		<span
			className={cn(
				'inline-flex items-center gap-0.5 text-xs',
				good ? 'text-income' : 'text-expense',
				className
			)}
		>
			<Arrow className="size-3.5" aria-hidden />
			{percent}% {up ? 'more' : 'less'} than {previousMonthName}
		</span>
	);
}

function RowButtons({
	row,
	actions,
	canAddSubcategory
}: {
	row: CategoryRow;
	actions: CategoryRowActions;
	canAddSubcategory: boolean;
}) {
	const name = row.category.name;
	return (
		<div className="flex shrink-0 items-center">
			<Button
				variant="ghost"
				size="icon"
				className="size-10 md:size-8"
				aria-label={`Edit ${name}`}
				onClick={() => actions.onEdit(row)}
			>
				<Pencil className="text-muted-foreground" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				className="size-10 md:size-8"
				aria-label={`Delete ${name}`}
				onClick={() => actions.onDelete(row)}
			>
				<Trash2 className="text-muted-foreground" />
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="size-10 md:size-8"
						aria-label={`More actions for ${name}`}
					>
						<MoreVertical className="text-muted-foreground" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{canAddSubcategory && (
						<DropdownMenuItem onSelect={() => actions.onAddSubcategory(row)}>
							Add subcategory
						</DropdownMenuItem>
					)}
					<DropdownMenuItem onSelect={() => actions.onMerge(row)}>Merge into…</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function BudgetMeter({ name, budget }: { name: string; budget: BudgetFigures }) {
	const left = budget.planned - budget.actual;
	const tone = meterTone(budget.actual, budget.planned);
	return (
		<div className="flex flex-col gap-1">
			<ProgressBar value={budget.actual} max={budget.planned} label={`${name} budget used`} />
			<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
				{tone === 'danger' ? (
					<>
						<AlertTriangle className="size-3.5 text-expense" aria-hidden /> Over by{' '}
						{formatMoney(-left)} of {formatMoney(budget.planned)}
					</>
				) : tone === 'warning' ? (
					<>
						<AlertTriangle className="size-3.5 text-warning" aria-hidden /> Close to the limit ·{' '}
						{formatMoney(left)} left of {formatMoney(budget.planned)}
					</>
				) : (
					<>
						{formatMoney(left)} left of {formatMoney(budget.planned)}
					</>
				)}
			</p>
		</div>
	);
}

/**
 * One top-level category: its mark, name, this month's total with how it changed, its budget
 * meter when it has one, and — expanded by default — its subcategories as quiet rows beneath.
 * Edit and Delete are always one tap away; the less common moves live in the menu.
 */
export function CategoryRowCard({
	row,
	kind,
	colors,
	budgets,
	budgetKind,
	collapsed,
	forceExpanded,
	dimmed,
	previousMonthName,
	actions
}: {
	row: CategoryRow;
	kind: CategoryKind;
	colors: Map<string, string>;
	budgets: Map<string, BudgetFigures>;
	/** Budgets only describe spending, so none are drawn on the income list. */
	budgetKind: boolean;
	collapsed: boolean;
	/** True while searching: matches inside a collapsed category are shown anyway. */
	forceExpanded: boolean;
	/** While searching, rows that are only shown to reach a match. */
	dimmed: (id: string) => boolean;
	previousMonthName: string;
	actions: CategoryRowActions;
}) {
	const color = categoryColorOf(colors, row.category.id);
	const budget = budgetKind ? budgets.get(row.category.id) : undefined;
	const showChildren = row.children.length > 0 && (!collapsed || forceExpanded);

	return (
		<Card size="sm" className={cn(dimmed(row.category.id) && 'opacity-60')}>
			<div className="flex flex-col gap-3 px-4">
				<div className="flex items-start gap-3">
					<CategoryGlyph icon={row.category.icon} color={color} />
					<div className="min-w-0 flex-1">
						<p className="truncate text-base leading-tight font-medium">{row.category.name}</p>
						<p className="text-xs text-muted-foreground">
							{row.totalCount} {row.totalCount === 1 ? 'transaction' : 'transactions'}
							{row.children.length > 0 &&
								` · ${row.children.length} ${row.children.length === 1 ? 'subcategory' : 'subcategories'}`}
						</p>
					</div>
					<RowButtons row={row} actions={actions} canAddSubcategory />
				</div>

				<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
					{row.totalAmount > 0 ? (
						<span className="font-mono text-xl font-semibold">{formatMoney(row.totalAmount)}</span>
					) : (
						<span className="text-sm text-muted-foreground">
							Nothing {kind === 'income' ? 'received' : 'spent'} this month
						</span>
					)}
					<ChangeNote
						current={row.totalAmount}
						previous={row.previousTotal}
						kind={kind}
						previousMonthName={previousMonthName}
					/>
				</div>

				{budget ? (
					<BudgetMeter name={row.category.name} budget={budget} />
				) : (
					budgetKind &&
					row.totalAmount > 0 && (
						<Link
							to="/budgets"
							className="w-fit text-xs text-muted-foreground underline underline-offset-2"
						>
							Set a budget
						</Link>
					)
				)}

				{row.children.length > 0 && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="-mx-2 w-fit text-muted-foreground"
						aria-expanded={showChildren}
						aria-label={`${showChildren ? 'Hide' : 'Show'} subcategories of ${row.category.name}`}
						onClick={() => actions.onToggle(row)}
					>
						<ChevronDown
							className={cn('transition-transform', showChildren && 'rotate-180')}
							aria-hidden
						/>
						{showChildren ? 'Hide subcategories' : 'Show subcategories'}
					</Button>
				)}
			</div>

			{showChildren && (
				<ul className="flex flex-col border-t">
					{row.children.map((child) => (
						<SubcategoryRow
							key={child.category.id}
							row={child}
							color={color}
							budget={budgetKind ? budgets.get(child.category.id) : undefined}
							dimmed={dimmed(child.category.id)}
							actions={actions}
						/>
					))}
				</ul>
			)}
		</Card>
	);
}

function SubcategoryRow({
	row,
	color,
	budget,
	dimmed,
	actions
}: {
	row: CategoryRow;
	color: string;
	budget: BudgetFigures | undefined;
	dimmed: boolean;
	actions: CategoryRowActions;
}) {
	return (
		<li
			className={cn(
				'flex flex-col gap-2 border-b px-4 py-2 last:border-b-0',
				dimmed && 'opacity-60'
			)}
		>
			<div className="flex items-center gap-3">
				<CategoryGlyph icon={row.category.icon} color={color} size="sm" />
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium">{row.category.name}</p>
					<p className="text-xs text-muted-foreground">
						{row.totalAmount > 0 ? (
							<>
								<span className="font-mono text-foreground">{formatMoney(row.totalAmount)}</span> ·{' '}
								{row.totalCount} {row.totalCount === 1 ? 'transaction' : 'transactions'}
							</>
						) : (
							'Nothing this month'
						)}
					</p>
				</div>
				<RowButtons row={row} actions={actions} canAddSubcategory={false} />
			</div>
			{budget && <BudgetMeter name={row.category.name} budget={budget} />}
		</li>
	);
}
